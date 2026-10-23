-- Chog City (docs/superpowers/specs/2026-10-19-city-slice.md). Residents are Cult members, so one roster,
-- one identity and one ownership projection serve both. City keeps its own runtime, revisions and events.

CREATE TABLE city_runtime (
  id smallint PRIMARY KEY CHECK (id = 1),
  rules_version text NOT NULL,
  world_version text NOT NULL,
  tick bigint NOT NULL CHECK (tick >= 0),
  next_due_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE city_residents (
  agent_key text PRIMARY KEY REFERENCES members (agent_key),
  name text NOT NULL,
  plot_id text NOT NULL UNIQUE,
  location jsonb NOT NULL,
  active boolean NOT NULL,
  focus text NOT NULL CHECK (focus IN ('builder', 'gatherer', 'social')),
  home_style text NOT NULL CHECK (home_style IN ('moss', 'brick', 'timber')),
  policy_version numeric(78, 0) NOT NULL CHECK (policy_version >= 1),
  ownership_epoch numeric(78, 0) NOT NULL CHECK (ownership_epoch >= 0),
  control_status text NOT NULL CHECK (control_status IN ('verified', 'unavailable', 'burned', 'not_awakened')),
  controller text CHECK (controller ~ '^0x[0-9a-f]{40}$'),
  home_level smallint NOT NULL CHECK (home_level BETWEEN 0 AND 2),
  construction jsonb,
  last_greeting_tick bigint,
  wood_total smallint NOT NULL, wood_reserved smallint NOT NULL,
  stone_total smallint NOT NULL, stone_reserved smallint NOT NULL,
  food_total smallint NOT NULL, food_reserved smallint NOT NULL,
  admitted_tick bigint NOT NULL,
  CHECK (wood_reserved >= 0 AND wood_reserved <= wood_total AND wood_total <= 20),
  CHECK (stone_reserved >= 0 AND stone_reserved <= stone_total AND stone_total <= 20),
  CHECK (food_reserved >= 0 AND food_reserved <= food_total AND food_total <= 20),
  CHECK (control_status <> 'burned' OR (active = false AND construction IS NULL))
);

CREATE TABLE city_ledger (
  id bigserial PRIMARY KEY,
  tick bigint NOT NULL,
  agent_key text NOT NULL REFERENCES city_residents (agent_key),
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
  tick bigint PRIMARY KEY,
  input_hash text NOT NULL,
  result_hash text NOT NULL,
  action_count integer NOT NULL CHECK (action_count >= 0),
  committed_at timestamptz NOT NULL
);

-- City's CityEvent envelope {revision, type, data, createdAt}; revisions come from the locked city_runtime row.
CREATE TABLE city_events (
  revision bigint PRIMARY KEY,
  type text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX city_events_type ON city_events (type, revision);

ALTER TABLE idempotency_records DROP CONSTRAINT idempotency_records_operation_check;
ALTER TABLE idempotency_records ADD CONSTRAINT idempotency_records_operation_check CHECK (operation IN ('membership', 'vote', 'city_policy'));
