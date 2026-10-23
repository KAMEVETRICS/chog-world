-- Chog Cult v1 schema. One cult instance per database schema.

CREATE TABLE cult_runtime (
  id smallint PRIMARY KEY CHECK (id = 1),
  rules_version text NOT NULL,
  timing text NOT NULL CHECK (timing IN ('production', 'demo')),
  cycle integer NOT NULL CHECK (cycle >= 0),
  phase text NOT NULL CHECK (phase IN ('propose', 'debate', 'vote', 'resolve')),
  cycle_started_at timestamptz NOT NULL,
  phase_started_at timestamptz NOT NULL,
  next_boundary_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  city_cursor numeric(78, 0) NOT NULL DEFAULT 0 CHECK (city_cursor >= 0)
);

CREATE TABLE members (
  agent_key text PRIMARY KEY,
  name text NOT NULL,
  identity jsonb NOT NULL,
  traits jsonb NOT NULL,
  faction text CHECK (faction IN ('crown', 'chaos')),
  stance text NOT NULL CHECK (stance IN ('persona', 'abstain')),
  joined_cycle integer CHECK (joined_cycle >= 0),
  last_switch_cycle integer CHECK (last_switch_cycle >= 0),
  ownership_epoch numeric(78, 0) NOT NULL CHECK (ownership_epoch >= 0),
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  control_status text NOT NULL CHECK (control_status IN ('verified', 'unavailable', 'burned', 'not_awakened')),
  controller text CHECK (controller ~ '^0x[0-9a-f]{40}$'),
  CHECK ((faction IS NULL) = (joined_cycle IS NULL)),
  CHECK (faction IS NOT NULL OR stance = 'abstain')
);

CREATE TABLE votes (
  cycle integer NOT NULL CHECK (cycle >= 0),
  agent_key text NOT NULL REFERENCES members (agent_key),
  place text NOT NULL CHECK (place IN ('plaza', 'tavern', 'workshop')),
  source text NOT NULL CHECK (source IN ('agent', 'holder')),
  faction text NOT NULL CHECK (faction IN ('crown', 'chaos')),
  decree_id text,
  ownership_epoch numeric(78, 0) NOT NULL,
  PRIMARY KEY (cycle, agent_key, place, source),
  CHECK (source = 'holder' OR decree_id IS NOT NULL)
);

CREATE TABLE presence (
  cycle integer NOT NULL CHECK (cycle >= 0),
  city_revision numeric(78, 0) NOT NULL,
  agent_key text NOT NULL REFERENCES members (agent_key),
  place text NOT NULL CHECK (place IN ('plaza', 'tavern', 'workshop')),
  points integer NOT NULL CHECK (points > 0),
  PRIMARY KEY (cycle, city_revision, agent_key, place)
);

CREATE TABLE place_control (
  place text PRIMARY KEY CHECK (place IN ('plaza', 'tavern', 'workshop')),
  faction text CHECK (faction IN ('crown', 'chaos')),
  decree_id text,
  since_cycle integer,
  CHECK ((faction IS NULL) = (decree_id IS NULL) AND (faction IS NULL) = (since_cycle IS NULL))
);

CREATE TABLE cycle_results (
  cycle integer PRIMARY KEY CHECK (cycle >= 0),
  rules_version text NOT NULL,
  input_hash text NOT NULL,
  result_hash text NOT NULL,
  result jsonb NOT NULL,
  resolved_at timestamptz NOT NULL
);

CREATE TABLE reputation (
  agent_key text PRIMARY KEY REFERENCES members (agent_key),
  loyalty integer NOT NULL CHECK (loyalty >= 0),
  glory integer NOT NULL CHECK (glory >= 0)
);

-- Commit-ordered public events; the revision comes from the locked cult_runtime row.
CREATE TABLE cult_events (
  revision bigint PRIMARY KEY,
  cycle integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX cult_events_cycle ON cult_events (cycle);
