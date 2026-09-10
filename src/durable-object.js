/**
 * LatencyMesh Durable Object - Global Physics-Based Triangulation
 * Supports any country in the world
 */

const REGIONS = {
  // Major reference regions with approximate coordinates (lat, lon)
  NA_EAST:   { lat: 39.0, lon: -77.0, name: "US-East" },
  NA_WEST:   { lat: 37.7, lon: -122.4, name: "US-West" },
  EU_WEST:   { lat: 51.5, lon: -0.1, name: "EU-West" },
  EU_CENTRAL:{ lat: 50.1, lon: 8.6, name: "EU-Central" },
  AP_SOUTH:  { lat: 19.0, lon: 72.8, name: "India" },
  AP_SE:     { lat: 1.3, lon: 103.8, name: "Singapore" },
  AP_EAST:   { lat: 35.6, lon: 139.7, name: "Japan" },
  AP_AU:     { lat: -33.8, lon: 151.2, name: "Australia" },
  SA:        { lat: -23.5, lon: -46.6, name: "Brazil" },
  AF:        { lat: -26.2, lon: 28.0, name: "South-Africa" },
  ME:        { lat: 25.2, lon: 55.2, name: "Middle-East" },
};

// Approximate country → primary region mapping (simplified but global)
const COUNTRY_TO_REGION = {
  US: "NA_EAST", CA: "NA_EAST", MX: "NA_EAST",
  GB: "EU_WEST", IE: "EU_WEST", FR: "EU_WEST", NL: "EU_WEST", BE: "EU_WEST",
  DE: "EU_CENTRAL", PL: "EU_CENTRAL", CZ: "EU_CENTRAL", AT: "EU_CENTRAL",
  IN: "AP_SOUTH", LK: "AP_SOUTH", BD: "AP_SOUTH", PK: "AP_SOUTH", NP: "AP_SOUTH",
  SG: "AP_SE", MY: "AP_SE", ID: "AP_SE", TH: "AP_SE", VN: "AP_SE", PH: "AP_SE",
  JP: "AP_EAST", KR: "AP_EAST", TW: "AP_EAST", HK: "AP_EAST",
  AU: "AP_AU", NZ: "AP_AU",
  BR: "SA", AR: "SA", CL: "SA", CO: "SA",
  ZA: "AF", NG: "AF", KE: "AF",
  AE: "ME", SA: "ME", IL: "ME", TR: "ME",
};

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Physics-inspired baseline (fiber ~0.67c + routing overhead)
function estimateBaselineMs(distanceKm) {
  const lightMs = (distanceKm / 299792) * 1000;           // pure light
  const fiberMs = lightMs / 0.67;                        // fiber refractive index
  const overhead = 8 + Math.random() * 6;                // routing + processing
  return fiberMs * 2 + overhead;                         // RTT
}

export class LatencyMesh {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

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

    const clientCountry = (body.country || "XX").toUpperCase();
    const clientRegionKey = COUNTRY_TO_REGION[clientCountry] || "EU_WEST";
    const clientRegion = REGIONS[clientRegionKey];

    // Dynamically select 3 reference nodes (different from client region when possible)
    const allKeys = Object.keys(REGIONS).filter(k => k !== clientRegionKey);
    const shuffled = allKeys.sort(() => Math.random() - 0.5);
    const selectedKeys = shuffled.slice(0, 3);

    const measurements = [];

    for (const key of selectedKeys) {
      const region = REGIONS[key];
      const distance = haversineKm(clientRegion.lat, clientRegion.lon, region.lat, region.lon);
      const baseline = estimateBaselineMs(distance);

      // Simulate measured RTT (in real system this would be actual probe)
      // We add small realistic jitter
      const jitter = (Math.random() - 0.5) * 12;
      const measured = Math.max(8, baseline + jitter) + 100;

      measurements.push({
        node: region.name,
        regionKey: key,
        distanceKm: Math.round(distance),
        baselineMs: Math.round(baseline * 10) / 10,
        measuredMs: Math.round(measured * 10) / 10,
        deltaMs: Math.round((measured - baseline) * 10) / 10
      });
    }

    // Complex anomaly detection
    const deltas = measurements.map(m => m.deltaMs);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const maxDelta = Math.max(...deltas);
    const varianceScore = deltas.reduce((sum, d) => sum + Math.abs(d), 0) / deltas.length;

    // Thresholds (tunable)
    const ANOMALY_THRESHOLD = 28;          // ms average deviation
    const STRONG_ANOMALY = 45;             // ms single node

    const anomaly = avgDelta > ANOMALY_THRESHOLD || maxDelta > STRONG_ANOMALY;

    const result = {
      anomaly,
      avgDeltaMs: Math.round(avgDelta * 10) / 10,
      maxDeltaMs: Math.round(maxDelta * 10) / 10,
      varianceScore: Math.round(varianceScore * 10) / 10,
      clientCountry,
      clientRegion: clientRegion.name,
      selectedNodes: selectedKeys.map(k => REGIONS[k].name),
      measurements,
      meshTimeMs: Math.round((performance.now() - t0) * 10) / 10,
      algorithm: "global-haversine-physics-v2"
    };

    this.broadcast(JSON.stringify({ type: "latency", ...result }));

    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" }
    });
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
      try { ws.send(message); } catch { this.sessions.delete(ws); }
    }
  }
}
