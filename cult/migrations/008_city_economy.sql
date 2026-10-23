-- Chog City economy (ruleset city-m2-citizens): Chogs hold city coins and may post one job offer. Citizens,
-- the treasury and shared projects are not stored on this server yet; these columns keep Chogs complete.
ALTER TABLE city_agents
  ADD COLUMN coins integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  ADD COLUMN offer jsonb CHECK (offer IS NULL OR jsonb_typeof(offer) = 'object');

-- Materials a Chog gives, trades, receives from a hired citizen or puts into a project.
ALTER TABLE city_ledger DROP CONSTRAINT city_ledger_reason_check;
ALTER TABLE city_ledger ADD CONSTRAINT city_ledger_reason_check
  CHECK (reason IN ('admission', 'gather_input', 'gather_output', 'build_reserve', 'build_consume', 'build_release', 'eat', 'decor',
                    'gift_out', 'gift_in', 'sold', 'bought', 'hired_output', 'project'));

ALTER TABLE city_events DROP CONSTRAINT city_events_type_check;
ALTER TABLE city_events ADD CONSTRAINT city_events_type_check
  CHECK (type IN ('city_tick', 'policy_changed', 'control_changed', 'resident_admitted', 'simulation_gap', 'home_decorated',
                  'citizen_joined', 'job_changed', 'params_changed', 'city_action'));
