-- Reviews are signed provider domain history. Credentials remain excluded on restore.
ALTER TABLE vector_github_pull_requests ADD COLUMN head_sha TEXT;
ALTER TABLE vector_github_pull_requests ADD COLUMN head_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vector_github_pull_requests ADD COLUMN head_changed_at TEXT;
ALTER TABLE vector_github_pull_requests ADD COLUMN head_conflicted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vector_github_pull_requests ADD COLUMN head_observed_at TEXT;
CREATE TABLE github_reviews (
 repository_id TEXT NOT NULL,
 number INTEGER NOT NULL,
 review_id INTEGER NOT NULL,
 reviewer_id INTEGER NOT NULL,
 reviewer_login TEXT NOT NULL,
 commit_sha TEXT NOT NULL,
 head_version INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('approved','changes_requested','commented','dismissed','conflicted')),
 submitted_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 PRIMARY KEY(repository_id,number,review_id),
 FOREIGN KEY(repository_id,number) REFERENCES vector_github_pull_requests(repository_id,number) ON DELETE CASCADE
);
CREATE INDEX github_reviews_current ON github_reviews(repository_id,number,head_version,reviewer_id,submitted_at);
