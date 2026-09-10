/**
 * Quantum-Safe Optical Latency SDK - Main Ingress Worker
 * High-resolution latency triangulation for MITM detection
 * Cloudflare Workers + Durable Objects + D1
 */

export { LatencyMesh } from "./durable-object.js";

const PHYSICAL_BASELINES = {
  // Rough fiber + edge baselines in ms (prototype values – calibrate later)
  "LK-SG": 18,
  "LK-US": 210,
  "SG-US": 195,
  // Add more pairs as needed
};

const ANOMALY_BUFFER_MS = 12; // tolerance for normal variance

export default {
  async fetch(request, env, ctx) {
    const start = performance.now();
    const url = new URL(request.url);

    // Health / simple status
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", ts: Date.now() }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Only process API path for the portal
    if (url.pathname !== "/api/check" && url.pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const cf = request.cf || {};
      const clientIP = request.headers.get("cf-connecting-ip") || "unknown";
      const country = cf.country || "XX";
      const colo = cf.colo || "unknown";

      // Get a Durable Object stub for the mesh coordinator
      const id = env.LATENCY_MESH.idFromName("global-mesh");
      const mesh = env.LATENCY_MESH.get(id);

      // Fire high-resolution triangulation
      const triangulation = await mesh.fetch(new Request("https://mesh/internal/triangulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientIP,
          country,
          colo,
          originTs: performance.now(),
        }),
      }));

      const result = await triangulation.json();

      const end = performance.now();
      const totalWorkerTime = end - start;

      // Build final verdict
      const verdict = result.anomaly ? "HACKER_DETECTED_MITM" : "SAFE_HUMAN";

      // Async log to D1 (never block the response)
      ctx.waitUntil(
        logToD1(env.DB, {
          timestamp: new Date().toISOString(),
          client_ip: clientIP,
          country,
          colo,
          measured_rtt_ms: result.measuredRtt,
          baseline_ms: result.baseline,
          variance_ms: result.variance,
          verdict,
          worker_time_ms: totalWorkerTime,
          details: JSON.stringify(result),
        })
      );

      // Secure response headers for the portal
      const headers = {
        "content-type": "application/json",
        "x-latency-verdict": verdict,
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
      };

      return new Response(
        JSON.stringify({
          verdict,
          measuredRttMs: result.measuredRtt,
          baselineMs: result.baseline,
          varianceMs: result.variance,
          colo,
          country,
          processingMs: Math.round(totalWorkerTime * 100) / 100,
        }),
        { status: 200, headers }
      );
    } catch (err) {
      console.error("Worker error:", err);
      return new Response(
        JSON.stringify({ error: "internal", message: "Latency check failed" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  },
};

async function logToD1(db, row) {
  try {
    await db
      .prepare(
        `INSERT INTO latency_checks 
         (timestamp, client_ip, country, colo, measured_rtt_ms, baseline_ms, variance_ms, verdict, worker_time_ms, details)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.timestamp,
        row.client_ip,
        row.country,
        row.colo,
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