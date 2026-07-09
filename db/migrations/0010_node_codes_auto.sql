-- 0010 · Provenance for auto-attached standard codes.
-- Records exactly which external_ids the resolver added (vs. seed/curator codes),
-- so a "re-map ALL" can strip and re-resolve only its own codes and never clobber
-- hand-curated ones. See docs/10-standards-alignment.md and src/codemap.ts.
ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_auto text[] NOT NULL DEFAULT '{}';
