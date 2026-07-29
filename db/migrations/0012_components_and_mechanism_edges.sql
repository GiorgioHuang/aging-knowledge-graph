-- 0012 · P1: intervention components + explicit mechanism edges.
-- Adds `intervention_component` (a part_of an intervention) and the typed
-- mechanistic edges the research platform asked for:
--   intervention --operates_through--> mechanism --contributes_to--> outcome
-- (previously only expressible via the generic causes/improves relationships).
-- ALTER TYPE ... ADD VALUE is idempotent (IF NOT EXISTS) and must run outside a
-- transaction, so no BEGIN/COMMIT here (bootstrap runs each statement standalone).

ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'intervention_component';

ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'operates_through';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'contributes_to';
