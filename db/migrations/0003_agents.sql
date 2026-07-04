-- GraceAge Knowledge — agent infrastructure (curator + reviewer).
-- The `topic` table is the work queue that drives continuous expansion; the
-- `agent_run` table is an append-only log of what each agent did, for audit.
-- All statements use IF NOT EXISTS so this is safe to run on every agent cycle
-- (existing deployments provisioned before this migration get the tables lazily).

BEGIN;

CREATE TABLE IF NOT EXISTS topic (
  id          text PRIMARY KEY,
  topic       text NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
  priority    int  NOT NULL DEFAULT 0,
  attempts    int  NOT NULL DEFAULT 0,
  last_error  text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS topic_queue_idx ON topic (status, priority DESC, created_at);

CREATE TABLE IF NOT EXISTS agent_run (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent      text NOT NULL,            -- 'curator' | 'reviewer'
  topic_id   text,
  claim_id   text,
  outcome    text,                     -- e.g. 'curated' | 'needs_refinement' | 'created' | 'error'
  summary    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_run_agent_idx ON agent_run (agent, created_at DESC);

COMMIT;
