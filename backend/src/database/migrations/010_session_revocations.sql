CREATE TABLE session_revocations (
  id uuid PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX session_revocations_expiry_idx ON session_revocations (expires_at);
