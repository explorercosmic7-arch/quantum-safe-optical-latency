/**
 * Quantum-Safe Optical Latency SDK - Main Ingress Worker
 * Global version – works for any country
 * Fixed CORS + hardened security headers
 */
export { LatencyMesh } from "./durable-object.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...securityHeaders,
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders, ...securityHeaders },
      });
    }

    const start = performance.now();
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health") {
      return json({
        status: "ok",
        version: "global-v2",
        ts: Date.now(),
      });
    }

    // Only allow /api/check and /
    if (url.pathname !== "/api/check" && url.pathname !== "/") {
      return json({ error: "not_found" }, 404);
    }

    try {
      const cf = request.cf || {};
      const clientIP = request.headers.get("cf-connecting-ip") || "unknown";
      const country = cf.country || "XX";
      const colo = cf.colo || "unknown";
      const asn = cf.asn || null;
      const asOrganization = cf.asOrganization || null;

      // Call Durable Object
      const id = env.LATENCY_MESH.idFromName("global-mesh-v2");
      const mesh = env.LATENCY_MESH.get(id);

      const triangulation = await mesh.fetch(
        new Request("https://mesh/internal/triangulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientIP,
            country,
            colo,
            asn,
            originTs: performance.now(),
          }),
        })
      );

      const result = await triangulation.json();
      const end = performance.now();
      const totalWorkerTime = end - start;
      const verdict = result.anomaly ? "HACKER_DETECTED_MITM" : "SAFE_HUMAN";

      // Async log to D1 (does not block response)
      ctx.waitUntil(
        logToD1(env.DB, {
          timestamp: new Date().toISOString(),
          client_ip: clientIP,
          country,
          colo,
          asn,
          as_org: asOrganization,
          measured_rtt_ms: result.avgDeltaMs,
          baseline_ms: result.measurements?.[0]?.baselineMs || null,
          variance_ms: result.varianceScore,
          verdict,
          worker_time_ms: totalWorkerTime,
          details: JSON.stringify(result),
        })
      );

      // Success response
      return json(
        {
          verdict,
          confidence: result.anomaly ? "high" : "normal",
          avgDeltaMs: result.avgDeltaMs,
          maxDeltaMs: result.maxDeltaMs,
          varianceScore: result.varianceScore,
          clientCountry: country,
          clientRegion: result.clientRegion,
          selectedNodes: result.selectedNodes,
          measurements: result.measurements,
          colo,
          asn,
          asOrganization,
          processingMs: Math.round(totalWorkerTime * 10) / 10,
          algorithm: result.algorithm,
        },
        200,
        { "x-latency-verdict": verdict }
      );
    } catch (err) {
      console.error("Worker error:", err);
      return json(
        { error: "internal", message: "Latency check failed" },
        500
      );
    }
  },
};

async function logToD1(db, row) {
  try {
    await db
      .prepare(
        `INSERT INTO latency_checks 
         (timestamp, client_ip, country, colo, asn, as_org, measured_rtt_ms, baseline_ms, variance_ms, verdict, worker_time_ms, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.timestamp,
        row.client_ip,
        row.country,
        row.colo,
        row.asn,
        row.as_org,
        row.measured_rtt_ms,
        row.baseline_ms,
        row.variance_ms,
        row.verdict,
        row.worker_time_ms,
        row.details
      )
      .run();
  } catch (e) {
    console.error("D1 log failed:", e);
  }
}
