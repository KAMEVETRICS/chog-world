-- Chog City for everyone (ruleset city-m2-citizens): citizens with villagers, the treasury, voted parameters,
-- shared projects, and the books for coins, the treasury's stores and project funds.

CREATE TABLE city_citizens (
  citizen_key text PRIMARY KEY CHECK (citizen_key ~ '^citizen:0x[0-9a-f]{40}$'),
  address text NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 20),
  look jsonb NOT NULL,
  lot_id text NOT NULL UNIQUE,
  location jsonb NOT NULL,
  job text NOT NULL CHECK (job IN ('farmhand', 'woodcutter', 'quarrier', 'off')),
  job_version numeric(78, 0) NOT NULL CHECK (job_version >= 1),
  coins integer NOT NULL CHECK (coins >= 0),
  joined_tick numeric(78, 0) NOT NULL,
  active_days integer NOT NULL CHECK (active_days >= 0),
  last_worked_day integer,
  employer text REFERENCES city_agents (agent_key),
  CHECK (citizen_key = 'citizen:' || address)
);

-- Filled by PgCity.initialize from the constitution's defaults and the founding treasury.
ALTER TABLE city_runtime
  ADD COLUMN params jsonb,
  ADD COLUMN treasury jsonb,
  ADD COLUMN projects jsonb;

-- Coins (everyone), the treasury's stores and project funds. A Chog's materials stay in city_ledger.
CREATE TABLE city_accounts (
  id bigserial PRIMARY KEY,
  tick numeric(78, 0) NOT NULL,
  account text NOT NULL,
  asset text NOT NULL CHECK (asset IN ('coins', 'wood', 'stone', 'food')),
  delta integer NOT NULL,
  cause_id text NOT NULL,
  line_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('grant', 'wage', 'wage_paid', 'tax', 'work_output', 'gift_out', 'gift_in', 'sold', 'bought', 'project')),
  UNIQUE (cause_id, line_id)
);
CREATE INDEX city_accounts_account ON city_accounts (account, asset);

-- Joining, job changes and economy actions, replayed by Idempotency-Key per session.
CREATE TABLE city_player_idempotency (
  session_id text NOT NULL REFERENCES sessions (id),
  operation text NOT NULL CHECK (operation IN ('join', 'job', 'act')),
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, operation, key)
);
