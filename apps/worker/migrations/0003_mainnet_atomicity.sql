ALTER TABLE top_up_intents ADD COLUMN created_at_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE top_up_intents ADD COLUMN claim_operation_id TEXT;
CREATE UNIQUE INDEX top_up_intents_claim_operation_idx ON top_up_intents(claim_operation_id) WHERE claim_operation_id IS NOT NULL;
CREATE UNIQUE INDEX top_up_open_exact_amount_idx ON top_up_intents(expected_amount_micro_usd) WHERE state='OPEN';

ALTER TABLE fee_reservations ADD COLUMN operation_id TEXT;
CREATE UNIQUE INDEX fee_reservations_operation_idx ON fee_reservations(operation_id) WHERE operation_id IS NOT NULL;
