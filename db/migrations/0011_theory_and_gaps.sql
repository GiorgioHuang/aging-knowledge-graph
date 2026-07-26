-- Healthy Aging Knowledge — 0011: Theory/Model entities + Knowledge Gaps.
-- Extends the node_type and relationship_type enums so the graph can represent
-- theories/models, knowledge gaps and research questions, plus the structural
-- links between them. Idempotent (ADD VALUE IF NOT EXISTS); requires Postgres 12+.
-- New enum values must be added outside a transaction block, so keep each
-- statement standalone (the bootstrap runner executes them one at a time).

ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'theory';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'model';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'knowledge_gap';
ALTER TYPE node_type ADD VALUE IF NOT EXISTS 'research_question';

ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'explains';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'informs';
ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'generates';
