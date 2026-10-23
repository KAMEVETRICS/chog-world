-- SIWE (ERC-4361) login, sessions, and idempotent holder actions.

CREATE TABLE auth_challenges (
  nonce text PRIMARY KEY CHECK (nonce ~ '^[0-9a-f]{64}$'),
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX auth_challenges_expiry ON auth_challenges (expires_at);

-- Only hashes of the session token and CSRF token are stored.
CREATE TABLE sessions (
  id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{32}$'),
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE idempotency_records (
  session_id text NOT NULL REFERENCES sessions (id),
  agent_key text NOT NULL REFERENCES members (agent_key),
  operation text NOT NULL CHECK (operation IN ('membership', 'vote')),
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, agent_key, operation, key)
);
