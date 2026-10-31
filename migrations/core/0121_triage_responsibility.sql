-- Weekly responsibility is portable configuration. A consumed creation receipt
-- survives handovers; no scheduler reconstructs notification history.
CREATE TABLE team_triage_rotations (
 team_id TEXT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
 starts_local TEXT NOT NULL,
 revision TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE team_triage_rotation_members (
 team_id TEXT NOT NULL REFERENCES team_triage_rotations(team_id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position>=0),
 operator_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
 PRIMARY KEY(team_id,position),
 UNIQUE(team_id,operator_id)
);
CREATE TABLE triage_creation_receipts (
 issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL UNIQUE,
 recipient_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
 period_starts_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);

-- Retain every prior mute and candidate while admitting the new event kind.
CREATE TABLE triage_type_mute_copy AS SELECT operator_id,kind FROM notification_type_mutes;
DROP TABLE notification_type_mutes;
CREATE TABLE notification_type_mutes (
 operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','mention','comment','thread_reopened','triage','intake_return','unblocked','due_reminder','status','completed','canceled','duplicate','archived','urgent','blocking','due_changed','reminder')),
 PRIMARY KEY(operator_id,kind)
);
INSERT INTO notification_type_mutes SELECT operator_id,kind FROM triage_type_mute_copy;
DROP TABLE triage_type_mute_copy;

CREATE TABLE triage_candidate_copy AS SELECT * FROM notification_candidates;
DROP TABLE notification_candidates;
CREATE TABLE notification_candidates (
 event_id TEXT NOT NULL, issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','mention','comment','thread_reopened','triage','intake_return','unblocked','due_reminder','status','completed','canceled','duplicate','archived','urgent','blocking','due_changed','reminder')),
 actor_id TEXT REFERENCES operators(id) ON DELETE SET NULL, actor_name TEXT,
 created_at TEXT NOT NULL, PRIMARY KEY(event_id,issue_id,recipient_id,kind)
);
INSERT INTO notification_candidates SELECT * FROM triage_candidate_copy;
DROP TABLE triage_candidate_copy;

CREATE TABLE triage_channel_copy AS SELECT * FROM notification_channel_defaults;
DROP TABLE notification_channel_defaults;
CREATE TABLE notification_channel_defaults (
 workspace_id TEXT NOT NULL REFERENCES workspace_settings(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','mention','comment','thread_reopened','triage','intake_return','unblocked','due_reminder','status','completed','canceled','duplicate','archived','urgent','blocking','due_changed','reminder')),
 email_mode TEXT NOT NULL CHECK(email_mode IN ('off','immediate','hourly','daily')),
 slack_enabled INTEGER NOT NULL CHECK(slack_enabled IN (0,1)), PRIMARY KEY(workspace_id,kind)
);
INSERT INTO notification_channel_defaults SELECT * FROM triage_channel_copy;
DROP TABLE triage_channel_copy;

CREATE TABLE triage_channel_copy AS SELECT * FROM notification_channel_overrides;
DROP TABLE notification_channel_overrides;
CREATE TABLE notification_channel_overrides (
 operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','mention','comment','thread_reopened','triage','intake_return','unblocked','due_reminder','status','completed','canceled','duplicate','archived','urgent','blocking','due_changed','reminder')),
 email_mode TEXT NOT NULL CHECK(email_mode IN ('off','immediate','hourly','daily')),
 slack_enabled INTEGER NOT NULL CHECK(slack_enabled IN (0,1)), PRIMARY KEY(operator_id,kind)
);
INSERT INTO notification_channel_overrides SELECT * FROM triage_channel_copy;
DROP TABLE triage_channel_copy;
