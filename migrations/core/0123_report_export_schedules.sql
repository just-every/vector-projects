-- Schedules retain safe configuration and receipts. Credentials use the existing
-- excluded secret vault; checkpoints contain digests, never exported bodies.
CREATE TABLE vector_report_exports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_settings(id),
  owner_id TEXT NOT NULL REFERENCES operators(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('bucket','sheets')),
  configuration TEXT NOT NULL CHECK(json_valid(configuration)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  next_at INTEGER NOT NULL,
  last_rows INTEGER NOT NULL DEFAULT 0,
  last_columns INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'idle' CHECK(state IN ('idle','running','failed','uncertain','held')),
  claim TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX vector_report_exports_due ON vector_report_exports(enabled,next_at);
CREATE TABLE vector_report_export_rows (
  export_id TEXT NOT NULL REFERENCES vector_report_exports(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  row_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY(export_id,resource,row_id)
);
CREATE TABLE vector_report_export_runs (
  id TEXT PRIMARY KEY,
  export_id TEXT NOT NULL REFERENCES vector_report_exports(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','uncertain','held')),
  row_count INTEGER,
  error TEXT
);
