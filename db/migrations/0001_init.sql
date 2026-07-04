-- GraceAge Knowledge — V0 core schema
-- Postgres 16. Mirrors docs/02-knowledge-model.md.
-- Idempotent-ish: safe to run on a fresh database.

BEGIN;

-- ---------- Enumerations (mirror docs/02) ----------

CREATE TYPE node_type AS ENUM (
  'disease', 'symptom', 'outcome', 'population', 'intervention', 'exercise',
  'nutrition', 'drug', 'mechanism', 'scale', 'tool', 'research', 'paper',
  'guideline', 'expert', 'organization', 'technology'
);

-- node -> node predicates (claim types). has_mechanism / evidence / contradicts
-- are modelled separately (claim.mechanism_id, evidence table, claim_relation).
CREATE TYPE relationship_type AS ENUM (
  'treats', 'prevents', 'improves', 'worsens', 'causes',
  'increases_risk_of', 'reduces_risk_of', 'diagnoses', 'assesses', 'measures',
  'is_a', 'part_of', 'recommends', 'related'
);

CREATE TYPE claim_direction AS ENUM ('increase', 'decrease', 'no_effect', 'mixed');

CREATE TYPE grade_certainty AS ENUM ('high', 'moderate', 'low', 'very_low');

CREATE TYPE claim_status AS ENUM ('curated', 'unverified', 'needs_refinement', 'skeleton');

CREATE TYPE care_setting AS ENUM ('home', 'community', 'ltc', 'hospital', 'rehab', 'any');

CREATE TYPE study_design AS ENUM (
  'systematic_review_or_meta_analysis', 'rct', 'cohort', 'case_control',
  'cross_sectional', 'case_report', 'expert_opinion', 'guideline'
);

-- ---------- Nodes ----------

CREATE TABLE node (
  id           text PRIMARY KEY,
  type         node_type   NOT NULL,
  name         text        NOT NULL,
  description  text,
  aliases      text[]      NOT NULL DEFAULT '{}',
  domains      text[]      NOT NULL DEFAULT '{}',
  external_ids text[]      NOT NULL DEFAULT '{}',   -- CURIEs, e.g. {MONDO:0005010, MESH:D000058}
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX node_type_idx        ON node (type);
CREATE INDEX node_domains_idx     ON node USING gin (domains);
CREATE INDEX node_external_id_idx ON node USING gin (external_ids);

-- ---------- Claims (every edge is a first-class assertion) ----------

CREATE TABLE claim (
  id             text PRIMARY KEY,
  type           relationship_type NOT NULL,
  subject_id     text NOT NULL REFERENCES node (id),
  object_id      text NOT NULL REFERENCES node (id),
  population_id  text REFERENCES node (id),          -- for whom (optional)
  mechanism_id   text REFERENCES node (id),          -- has_mechanism (optional)
  setting        care_setting,
  direction      claim_direction,
  effect_value   numeric,
  effect_measure text,                               -- e.g. 'RaR', 'OR', 'SMD'
  effect_note    text,
  comparator     text,                               -- placebo|usual_care|no_intervention|<node id/text>
  dose           text,
  certainty      grade_certainty,                    -- GRADE of the body of evidence
  rec_strength   text,                               -- recommends-only, verbatim (e.g. 'USPSTF B')
  status         claim_status NOT NULL DEFAULT 'curated',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_strength_only_on_recommends
    CHECK (rec_strength IS NULL OR type = 'recommends'),
  CONSTRAINT mechanism_is_a_mechanism_node CHECK (mechanism_id IS NULL OR mechanism_id <> subject_id)
);

CREATE INDEX claim_subject_idx   ON claim (subject_id);
CREATE INDEX claim_object_idx    ON claim (object_id);
CREATE INDEX claim_type_idx      ON claim (type);
CREATE INDEX claim_certainty_idx ON claim (certainty);
CREATE INDEX claim_status_idx    ON claim (status);

-- ---------- Evidence (graded & traceable) ----------

CREATE TABLE evidence (
  id             text PRIMARY KEY,
  claim_id       text NOT NULL REFERENCES claim (id) ON DELETE CASCADE,
  source_id      text NOT NULL,                      -- DOI:/PMID:/URL
  source_node_id text REFERENCES node (id),          -- optional Paper/Research/Guideline node
  quote          text,
  study_design   study_design,
  confidence     numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  extracted_by   text,                               -- 'human' | model id
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_claim_idx ON evidence (claim_id);

-- ---------- Claim-to-claim relations (contradicts; kept, not deleted) ----------

CREATE TABLE claim_relation (
  id                text PRIMARY KEY,
  type              text NOT NULL DEFAULT 'contradicts' CHECK (type IN ('contradicts')),
  subject_claim_id  text NOT NULL REFERENCES claim (id) ON DELETE CASCADE,
  object_claim_id   text NOT NULL REFERENCES claim (id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_relation CHECK (subject_claim_id <> object_claim_id)
);

COMMIT;
