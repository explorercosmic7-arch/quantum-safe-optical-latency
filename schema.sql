CREATE TABLE IF NOT EXISTS latency_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  client_ip TEXT,
  country TEXT,
  colo TEXT,
  measured_rtt_ms REAL,
  baseline_ms REAL,
  variance_ms REAL,
  verdict TEXT,
  worker_time_ms REAL,
  details TEXT
);

CREATE INDEX IF NOT EXISTS idx_timestamp ON latency_checks(timestamp);
CREATE INDEX IF NOT EXISTS idx_verdict ON latency_checks(verdict);
CREATE INDEX IF NOT EXISTS idx_client_ip ON latency_checks(client_ip);