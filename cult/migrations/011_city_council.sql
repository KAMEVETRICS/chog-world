-- Chog City council: holders' private standing instructions (per ownership epoch), the last council session
-- held, the 'council' event, and council turns as a paid automatic Soul action.
CREATE TABLE city_instructions (
  agent_key text PRIMARY KEY REFERENCES city_agents (agent_key),
  ownership_epoch numeric(78, 0) NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 600),
  updated_at timestamptz NOT NULL
);

ALTER TABLE city_runtime ADD COLUMN last_council_tick numeric(78, 0);

ALTER TABLE city_events DROP CONSTRAINT city_events_type_check;
ALTER TABLE city_events ADD CONSTRAINT city_events_type_check
  CHECK (type IN ('city_tick', 'policy_changed', 'control_changed', 'resident_admitted', 'simulation_gap', 'home_decorated',
                  'citizen_joined', 'job_changed', 'params_changed', 'city_action', 'council'));

ALTER TABLE soul_usage DROP CONSTRAINT soul_usage_action_check;
ALTER TABLE soul_usage ADD CONSTRAINT soul_usage_action_check CHECK (action IN ('chat', 'debate', 'vote', 'council'));
