-- Chog City needs, mood and home decorations (City ruleset city-m1-needs). Residents already living in the
-- village start with the same needs a newcomer gets, and no decorations.
ALTER TABLE city_agents
  ADD COLUMN needs jsonb NOT NULL DEFAULT '{"energy": 80, "hunger": 80, "fun": 80, "social": 80}',
  ADD COLUMN decor jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(decor) = 'array' AND jsonb_array_length(decor) <= 4);

-- Eating spends a Chog's food; decorating spends its materials.
ALTER TABLE city_ledger DROP CONSTRAINT city_ledger_reason_check;
ALTER TABLE city_ledger ADD CONSTRAINT city_ledger_reason_check
  CHECK (reason IN ('admission', 'gather_input', 'gather_output', 'build_reserve', 'build_consume', 'build_release', 'eat', 'decor'));

ALTER TABLE city_events DROP CONSTRAINT city_events_type_check;
ALTER TABLE city_events ADD CONSTRAINT city_events_type_check
  CHECK (type IN ('city_tick', 'policy_changed', 'control_changed', 'resident_admitted', 'simulation_gap', 'home_decorated'));

ALTER TABLE city_idempotency DROP CONSTRAINT city_idempotency_operation_check;
ALTER TABLE city_idempotency ADD CONSTRAINT city_idempotency_operation_check CHECK (operation IN ('policy', 'decor'));
