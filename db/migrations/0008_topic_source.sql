-- GraceAge Knowledge — topic provenance: where a topic came from
-- ('seed' | 'auto_gen' | 'ask_gap'), and for ask_gap the original user question,
-- so graph content driven by user questions is traceable. Idempotent.

BEGIN;

ALTER TABLE topic ADD COLUMN IF NOT EXISTS source        text;
ALTER TABLE topic ADD COLUMN IF NOT EXISTS source_detail text;

COMMIT;
