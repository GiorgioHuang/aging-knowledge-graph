-- GraceAge Knowledge — track how each "no evidence" Q&A gap was triaged into the
-- topic queue: NULL = not yet processed, 'queued' = became an in-scope topic,
-- 'rejected' = judged off-topic/irrelevant, 'duplicate' = already covered.
-- Idempotent; safe to run on every startup.

BEGIN;

ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS gap_status text;

COMMIT;
