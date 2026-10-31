-- Native templates are portable content. Applying one creates independent issues.
CREATE TABLE issue_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace_settings(id),
  team_id TEXT REFERENCES teams(id),
  name TEXT NOT NULL,
  defaults_json TEXT NOT NULL CHECK(json_valid(defaults_json)),
  subissues_json TEXT NOT NULL CHECK(json_valid(subissues_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX issue_templates_workspace_idx ON issue_templates(workspace_id,team_id,name,id);
