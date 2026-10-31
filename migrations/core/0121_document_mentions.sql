-- Native document custody. Retain receipts on compatible application rollback.
-- Upgrades never scan historical text or deliver historical mentions.
CREATE TABLE document_followers (
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(document_id,operator_id)
);
CREATE TABLE document_mentions (
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
 PRIMARY KEY(document_id,operator_id)
);
CREATE TABLE document_notification_events (
 event_id TEXT PRIMARY KEY REFERENCES document_revisions(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 version INTEGER NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(document_id,version)
);
CREATE TABLE document_notifications (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES operators(id) ON DELETE SET NULL,
 actor_name TEXT,
 created_at TEXT NOT NULL,
 read_at TEXT,
 UNIQUE(event_id,recipient_id)
);
CREATE INDEX document_notifications_recipient_order ON document_notifications(recipient_id,created_at DESC,id DESC);
