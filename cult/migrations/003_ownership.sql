-- Ownership projection for the live chain reader (src/chain/projection.ts): every Transfer log of the
-- Chog collection since the adapter's activation block, with block-hash checkpoints for reorgs.

CREATE TABLE ownership_projection (
  scope text PRIMARY KEY,
  chain_id integer NOT NULL,
  collection text NOT NULL CHECK (collection ~ '^0x[0-9a-f]{40}$'),
  activation_block bigint NOT NULL CHECK (activation_block >= 0),
  activation_hash text NOT NULL CHECK (activation_hash ~ '^0x[0-9a-f]{64}$'),
  cursor_block bigint NOT NULL,
  cursor_hash text NOT NULL CHECK (cursor_hash ~ '^0x[0-9a-f]{64}$'),
  generation bigint NOT NULL CHECK (generation >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cursor_block >= activation_block)
);

CREATE TABLE ownership_checkpoints (
  scope text NOT NULL REFERENCES ownership_projection (scope),
  block_number bigint NOT NULL,
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  PRIMARY KEY (scope, block_number)
);

-- A log removed by a reorg stays, marked with the generation that orphaned it: epochs count it.
CREATE TABLE ownership_transfers (
  id bigserial PRIMARY KEY,
  scope text NOT NULL REFERENCES ownership_projection (scope),
  block_number bigint NOT NULL,
  block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer NOT NULL CHECK (log_index >= 0),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  token_id text NOT NULL CHECK (token_id ~ '^(0|[1-9][0-9]{0,77})$'),
  from_address text NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  to_address text NOT NULL CHECK (to_address ~ '^0x[0-9a-f]{40}$'),
  orphaned_generation bigint CHECK (orphaned_generation >= 2)
);
CREATE UNIQUE INDEX ownership_transfers_canonical ON ownership_transfers (scope, block_number, log_index) WHERE orphaned_generation IS NULL;
CREATE INDEX ownership_transfers_token ON ownership_transfers (scope, token_id, block_number, log_index);
