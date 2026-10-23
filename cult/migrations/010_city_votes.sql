-- Chog City proposals and votes: open and recent proposals live on the runtime row with the other city-wide
-- state; a passed funding proposal moves treasury funds into a project on the books.
ALTER TABLE city_runtime
  ADD COLUMN proposals jsonb,
  ADD COLUMN proposal_seq integer NOT NULL DEFAULT 0 CHECK (proposal_seq >= 0);

ALTER TABLE city_accounts DROP CONSTRAINT city_accounts_reason_check;
ALTER TABLE city_accounts ADD CONSTRAINT city_accounts_reason_check
  CHECK (reason IN ('grant', 'treasury_grant', 'wage', 'wage_paid', 'tax', 'work_output', 'gift_out', 'gift_in', 'sold', 'bought', 'project'));
