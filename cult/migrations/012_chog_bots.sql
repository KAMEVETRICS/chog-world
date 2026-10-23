-- Chog Bots: a holder's bot settings per Chog (per ownership epoch, so a sale switches the bot off), and a
-- log of every reply the bot gave, which only the current holder can read.
CREATE TABLE bot_settings (
  agent_key text PRIMARY KEY REFERENCES members (agent_key),
  ownership_epoch numeric(78, 0) NOT NULL,
  enabled boolean NOT NULL,
  profile text NOT NULL CHECK (profile IN ('social', 'research', 'moderator', 'analyst')),
  channels jsonb NOT NULL,
  servers jsonb NOT NULL,
  daily_replies integer NOT NULL CHECK (daily_replies BETWEEN 1 AND 200),
  updated_at timestamptz NOT NULL
);

CREATE TABLE bot_activity (
  id bigserial PRIMARY KEY,
  agent_key text NOT NULL REFERENCES members (agent_key),
  ownership_epoch numeric(78, 0) NOT NULL,
  channel text NOT NULL CHECK (channel IN ('web', 'discord')),
  place text,
  skill text NOT NULL,
  -- A hash of who asked (never a raw platform ID).
  requester text NOT NULL,
  input text NOT NULL,
  reply text,
  outcome text NOT NULL CHECK (outcome IN ('answered', 'declined')),
  reason text,
  usage_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX bot_activity_agent ON bot_activity (agent_key, created_at DESC);

ALTER TABLE soul_usage DROP CONSTRAINT soul_usage_action_check;
ALTER TABLE soul_usage ADD CONSTRAINT soul_usage_action_check CHECK (action IN ('chat', 'debate', 'vote', 'council', 'bot'));
