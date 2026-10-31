-- Account-private comment drafts; consumed identities fence delayed devices.
CREATE TABLE comment_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_settings(id) ON DELETE CASCADE,
  author_operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  parent_comment_id TEXT REFERENCES issue_comments(id) ON DELETE CASCADE,
  anchor_json TEXT,
  body TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','submitted','discarded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (anchor_json IS NULL OR (parent_comment_id IS NULL AND json_valid(anchor_json))),
  CHECK ((state='open' AND body IS NOT NULL) OR (state<>'open' AND body IS NULL AND anchor_json IS NULL))
);
CREATE UNIQUE INDEX comment_drafts_composer ON comment_drafts(author_operator_id,issue_id,coalesce(parent_comment_id,''),anchor_json IS NOT NULL) WHERE state='open';
CREATE INDEX comment_drafts_author ON comment_drafts(author_operator_id,state,updated_at);
