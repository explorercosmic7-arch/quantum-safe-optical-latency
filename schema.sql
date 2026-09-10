DROP TABLE IF EXISTS latency_checks;

CREATE TABLE latency_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  client_ip TEXT,
  country TEXT,
  colo TEXT,
  asn INTEGER,
  as_org TEXT,
  measured_rtt_ms REAL,
  baseline_ms REAL,
  variance_ms REAL,
  verdict TEXT,
  worker_time_ms REAL,
  details TEXT
);

CREATE INDEX idx_timestamp ON latency_checks(timestamp);
CREATE INDEX idx_verdict ON latency_checks(verdict);
CREATE INDEX idx_client_ip ON latency_checks(client_ip);
CREATE INDEX idx_country ON latency_checks(country);
