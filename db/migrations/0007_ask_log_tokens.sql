-- GraceAge Knowledge — record LLM token usage per Q&A request (retrieval +
-- synthesis). Idempotent; safe to run on every startup.

BEGIN;

ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS input_tokens  int;
ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS output_tokens int;

COMMIT;
