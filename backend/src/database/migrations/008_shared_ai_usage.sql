CREATE TABLE shared_ai_usage (
  scope text PRIMARY KEY,
  usage_date date NOT NULL,
  requests integer NOT NULL CHECK (requests > 0)
);
