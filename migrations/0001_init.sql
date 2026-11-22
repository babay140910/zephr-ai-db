CREATE TABLE IF NOT EXISTS research_reports (
  report_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  topic TEXT NOT NULL,
  report_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ip_daily_usage (
  usage_date TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, ip_hash)
);
CREATE TABLE IF NOT EXISTS global_daily_usage (
  usage_date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS minute_usage (
  minute_key TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (minute_key, ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_research_date ON research_reports(report_date DESC);
