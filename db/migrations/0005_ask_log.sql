-- GraceAge Knowledge — Q&A (RAG) request log.
-- Every /ask is recorded: the question, the grounded answer, which claims were
-- retrieved and cited, the model, latency, and client info — for analytics,
-- auditing answer quality, and spotting gaps (questions the graph can't answer).
-- IF NOT EXISTS keeps this safe to run on every startup.

BEGIN;

CREATE TABLE IF NOT EXISTS ask_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question    text NOT NULL,
  answer      text,
  model       text,
  ok          boolean NOT NULL DEFAULT true,
  error       text,
  claim_ids   text[],
  citations   text[],
  num_claims  int,
  ip          text,
  user_agent  text,
  latency_ms  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ask_log_created_idx ON ask_log (created_at DESC);

COMMIT;
