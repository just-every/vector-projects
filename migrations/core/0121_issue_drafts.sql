-- Private account drafts retain content-free tombstones to fence delayed devices.
CREATE TABLE issue_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_settings(id) ON DELETE CASCADE,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  body_json TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','submitted','discarded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((state = 'open' AND body_json IS NOT NULL AND json_valid(body_json)) OR (state <> 'open' AND body_json IS NULL))
);
CREATE INDEX issue_drafts_author ON issue_drafts(author_operator_id, state, updated_at);
