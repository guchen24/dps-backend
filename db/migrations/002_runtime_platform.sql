ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS sessions_last_seen_at_idx ON sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS runtime_slots (
  slot SMALLINT PRIMARY KEY CHECK (slot BETWEEN 1 AND 3),
  service_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO runtime_slots (slot, service_name) VALUES
  (1, 'harness-01'), (2, 'harness-02'), (3, 'harness-03')
ON CONFLICT (slot) DO UPDATE SET service_name = EXCLUDED.service_name;

CREATE TABLE IF NOT EXISTS user_runtimes (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL UNIQUE REFERENCES runtime_slots(slot),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS model_usage_events (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot SMALLINT NOT NULL REFERENCES runtime_slots(slot),
  model TEXT,
  status_code INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  duration_ms INTEGER NOT NULL,
  usage_available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS model_usage_events_user_created_idx ON model_usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_usage_events_created_idx ON model_usage_events(created_at DESC);
