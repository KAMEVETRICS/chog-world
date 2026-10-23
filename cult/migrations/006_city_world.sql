-- Chog City on the City team's simulation (../city/src/simulation). Replaces the tables of 004, which were
-- shaped for the earlier City slice; no live City data existed. Residents no longer have to be Cult members:
-- a holder can bring any awakened Chog into City. One row per agent mirrors City's AgentState.

DROP TABLE city_events;
DROP TABLE city_ticks;
DROP TABLE city_ledger;
DROP TABLE city_residents;
DROP TABLE city_runtime;
DELETE FROM idempotency_records WHERE operation = 'city_policy';
ALTER TABLE idempotency_records DROP CONSTRAINT idempotency_records_operation_check;
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_operation_check CHECK (operation IN ('membership', 'vote'));

CREATE TABLE city_runtime (
  id smallint PRIMARY KEY CHECK (id = 1),
  city_id text NOT NULL,
  seed text NOT NULL,
  ruleset_version text NOT NULL,
  tick numeric(78, 0) NOT NULL CHECK (tick >= 0),
  next_due_at timestamptz NOT NULL,
  revision numeric(78, 0) NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE city_agents (
  agent_key text PRIMARY KEY,
  identity jsonb NOT NULL,
  chain_id numeric(78, 0) NOT NULL,
  collection text NOT NULL CHECK (collection ~ '^0x[0-9a-f]{40}$'),
  token_id numeric(78, 0) NOT NULL,
  name text NOT NULL,
  plot_id text NOT NULL UNIQUE,
  location jsonb NOT NULL,
  control_kind text NOT NULL CHECK (control_kind IN ('controlled', 'burned', 'unbound')),
  controller text CHECK (controller ~ '^0x[0-9a-f]{40}$'),
  ownership_epoch numeric(78, 0) NOT NULL CHECK (ownership_epoch >= 0),
  projection_generation numeric(78, 0) NOT NULL CHECK (projection_generation >= 0),
  control_block_number numeric(78, 0) NOT NULL,
  control_block_hash text NOT NULL,
  control_observed_at_ms bigint NOT NULL,
  control_availability text NOT NULL CHECK (control_availability IN ('verified', 'unavailable')),
  policy_version numeric(78, 0) NOT NULL CHECK (policy_version >= 1),
  active boolean NOT NULL,
  focus text NOT NULL CHECK (focus IN ('builder', 'gatherer', 'social')),
  policy_home_style text NOT NULL,
  home_level smallint NOT NULL CHECK (home_level >= 0),
  home_style text NOT NULL,
  construction jsonb,
  last_greeting_tick numeric(78, 0),
  wood_total smallint NOT NULL, wood_reserved smallint NOT NULL,
  stone_total smallint NOT NULL, stone_reserved smallint NOT NULL,
  food_total smallint NOT NULL, food_reserved smallint NOT NULL,
  admitted_tick numeric(78, 0) NOT NULL,
  -- One resident per NFT, whatever adapter or agent it arrives through: no second plot or grant.
  UNIQUE (chain_id, collection, token_id),
  CHECK ((control_kind = 'controlled') = (controller IS NOT NULL)),
  CHECK (control_kind = 'controlled' OR (active = false AND construction IS NULL)),
  CHECK (wood_reserved >= 0 AND wood_reserved <= wood_total AND wood_total <= 20),
  CHECK (stone_reserved >= 0 AND stone_reserved <= stone_total AND stone_total <= 20),
  CHECK (food_reserved >= 0 AND food_reserved <= food_total AND food_total <= 20)
);
CREATE INDEX city_agents_controller ON city_agents (controller);

CREATE TABLE city_ledger (
  id bigserial PRIMARY KEY,
  tick numeric(78, 0) NOT NULL,
  agent_key text NOT NULL REFERENCES city_agents (agent_key),
  resource text NOT NULL CHECK (resource IN ('wood', 'stone', 'food')),
  total_delta integer NOT NULL,
  reserved_delta integer NOT NULL,
  cause_id text NOT NULL,
  line_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('admission', 'gather_input', 'gather_output', 'build_reserve', 'build_consume', 'build_release')),
  UNIQUE (cause_id, line_id)
);
CREATE INDEX city_ledger_agent ON city_ledger (agent_key, resource);

CREATE TABLE city_ticks (
  tick numeric(78, 0) PRIMARY KEY,
  ruleset_version text NOT NULL,
  input_hash text NOT NULL,
  result_hash text NOT NULL,
  action_count integer NOT NULL CHECK (action_count >= 0),
  committed_at timestamptz NOT NULL
);

-- City's CityEvent envelope {revision, type, data, createdAt}; revisions come from the locked city_runtime row.
CREATE TABLE city_events (
  revision numeric(78, 0) PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('city_tick', 'policy_changed', 'control_changed', 'resident_admitted', 'simulation_gap')),
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX city_events_type ON city_events (type, revision);

-- Holder settings saves, replayed by Idempotency-Key. Scoped to the session, agent and key.
CREATE TABLE city_idempotency (
  session_id text NOT NULL REFERENCES sessions (id),
  agent_key text NOT NULL REFERENCES city_agents (agent_key),
  operation text NOT NULL CHECK (operation IN ('policy')),
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, agent_key, operation, key)
);
