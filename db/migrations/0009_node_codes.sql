-- 0009 · Standards mapping bookkeeping.
-- Records when a node was last checked against the vocabulary resolvers
-- (OLS / MeSH) so the batch mapper skips already-processed nodes. The codes
-- themselves live in node.external_ids (CURIEs) — see docs/10-standards-alignment.md.
ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_checked_at timestamptz;
