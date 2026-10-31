-- Personal navigation stores stable identities only; titles are always projected live.
CREATE TABLE member_favorites (
  operator_id TEXT PRIMARY KEY REFERENCES operators(id),
  workspace_id TEXT NOT NULL REFERENCES workspace_settings(id),
  version INTEGER NOT NULL CHECK(version > 0),
  folders_json TEXT NOT NULL CHECK(json_valid(folders_json)),
  entries_json TEXT NOT NULL CHECK(json_valid(entries_json))
);
CREATE TRIGGER member_favorites_removed AFTER UPDATE OF removed_at ON operators
WHEN NEW.removed_at IS NOT NULL
BEGIN
  DELETE FROM member_favorites WHERE operator_id=NEW.id;
END;
