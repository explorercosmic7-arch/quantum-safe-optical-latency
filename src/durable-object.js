/**
 * LatencyMesh Durable Object
 * Central coordination + high-res RTT triangulation
 * Supports WebSocket for live dashboard later
 */

export class LatencyMesh {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set(); // for future WebSocket fan-out
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket upgrade path (for live portal later)
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    if (url.pathname === "/internal/triangulate" && request.method === "POST") {
      return this.handleTriangulate(request);
    }

    return new Response("Mesh endpoint not found", { status: 404 });
  }

  async handleTriangulate(request) {
    const body = await request.json();
    const t0 = performance.now();

    // Simulate 3-node mesh measurements
    // In a real multi-region setup you would fetch other Worker endpoints
    // or use multiple Durable Object names (e.g. "node-sg", "node-us")
    // Here we do controlled high-res local + synthetic regional RTTs
    // for a clean prototype that still exercises the detection logic.

    const measurements = await Promise.all([
      this.measureNode("SG"),
      this.measureNode("US"),
      this.measureNode("LK"),
    ]);

    const measuredRtt = Math.max(...measurements.map((m) => m.rtt));
    const pairKey = this.guessPair(body.country, body.colo);
    const baseline = PHYSICAL_BASELINES[pairKey] || 80;
    const variance = measuredRtt - baseline;
    const anomaly = variance > ANOMALY_BUFFER_MS;

    const result = {
      measuredRtt: Math.round(measuredRtt * 100) / 100,
      baseline,
      variance: Math.round(variance * 100) / 100,
      anomaly,
      measurements,
      pairKey,
      meshTimeMs: performance.now() - t0,
    };

    // Optional: broadcast to connected WebSocket clients
    this.broadcast(JSON.stringify({ type: "latency", ...result }));

    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  }

  async measureNode(nodeId) {
    const start = performance.now();
    // Tiny deterministic work + small artificial delay to simulate cross-region
    // Replace later with real fetch() to other edge locations if you deploy multiple Workers
    await new Promise((r) => setTimeout(r, 0.4 + Math.random() * 1.8));
    const rtt = performance.now() - start + (nodeId === "US" ? 90 : nodeId === "SG" ? 12 : 4);
    return { node: nodeId, rtt };
  }

  guessPair(country, colo) {
    // Extremely simplified mapping – expand with real colo → region map
    if (country === "LK" || colo?.startsWith("CMB")) return "LK-SG";
    if (country === "SG" || colo?.startsWith("SIN")) return "SG-US";
    return "LK-US";
  }

  async handleWebSocket(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.sessions.add(server);

    server.addEventListener("close", () => this.sessions.delete(server));
    server.addEventListener("error", () => this.sessions.delete(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message) {
    for (const ws of this.sessions) {
      try {
        ws.send(message);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }
}

// Shared constants (kept in DO for simplicity)
const PHYSICAL_BASELINES = {
  "LK-SG": 18,
  "LK-US": 210,
  "SG-US": 195,
};
const ANOMALY_BUFFER_MS = 12;
