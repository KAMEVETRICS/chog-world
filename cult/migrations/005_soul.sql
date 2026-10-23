-- Chog Soul (docs/superpowers/specs/2026-10-20-chog-soul.md): $CHOG credits per holder wallet, holds that
-- settle exactly once, per-Chog AI consent, and private chat memory per ownership epoch.

-- Where the $CHOG deposit indexer has read up to (finalized blocks only, so nothing it credits is reorged).
CREATE TABLE credit_indexer (
  id smallint PRIMARY KEY CHECK (id = 1),
  chain_id integer NOT NULL,
  token text NOT NULL CHECK (token ~ '^0x[0-9a-f]{40}$'),
  treasury text NOT NULL CHECK (treasury ~ '^0x[0-9a-f]{40}$'),
  cursor_block bigint NOT NULL CHECK (cursor_block >= 0)
);

CREATE TABLE credit_deposits (
  tx_hash text NOT NULL CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK (log_index >= 0),
  block_number bigint NOT NULL,
  payer text NOT NULL CHECK (payer ~ '^0x[0-9a-f]{40}$'),
  amount numeric(78, 0) NOT NULL CHECK (amount > 0),
  credited_at timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

-- balance is spendable now; held is reserved for actions in flight.
CREATE TABLE credit_accounts (
  address text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  balance numeric(78, 0) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  held numeric(78, 0) NOT NULL DEFAULT 0 CHECK (held >= 0)
);

CREATE TABLE credit_ledger (
  id bigserial PRIMARY KEY,
  address text NOT NULL REFERENCES credit_accounts (address),
  kind text NOT NULL CHECK (kind IN ('deposit', 'grant', 'hold', 'capture', 'refund')),
  amount numeric(78, 0) NOT NULL CHECK (amount > 0),
  ref text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (kind, ref)
);

-- One row per paid action. The id is the hold reference; status moves held → charged or held → refunded once.
CREATE TABLE soul_usage (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 160),
  address text NOT NULL REFERENCES credit_accounts (address),
  agent_key text NOT NULL REFERENCES members (agent_key),
  action text NOT NULL CHECK (action IN ('chat', 'debate', 'vote')),
  price numeric(78, 0) NOT NULL CHECK (price > 0),
  status text NOT NULL CHECK (status IN ('held', 'charged', 'refunded')),
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  provider_cost_usd numeric(20, 10),
  failure text,
  created_at timestamptz NOT NULL,
  settled_at timestamptz
);
CREATE INDEX soul_usage_agent_day ON soul_usage (agent_key, created_at);
CREATE INDEX soul_usage_address ON soul_usage (address, created_at DESC);

-- The holder's consent for automatic AI actions. Valid only for the epoch it was given in: a sale turns it off.
CREATE TABLE soul_settings (
  agent_key text PRIMARY KEY REFERENCES members (agent_key),
  ownership_epoch numeric(78, 0) NOT NULL,
  ai_enabled boolean NOT NULL,
  daily_cap numeric(78, 0) NOT NULL CHECK (daily_cap >= 0),
  updated_at timestamptz NOT NULL
);

-- Private chat: belongs to the holder of one ownership epoch and is never shown to a later holder.
CREATE TABLE soul_messages (
  id bigserial PRIMARY KEY,
  agent_key text NOT NULL REFERENCES members (agent_key),
  ownership_epoch numeric(78, 0) NOT NULL,
  role text NOT NULL CHECK (role IN ('holder', 'chog')),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  usage_id text REFERENCES soul_usage (id),
  created_at timestamptz NOT NULL
);
CREATE INDEX soul_messages_thread ON soul_messages (agent_key, ownership_epoch, id);
