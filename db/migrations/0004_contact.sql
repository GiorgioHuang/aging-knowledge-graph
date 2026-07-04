-- GraceAge Knowledge — contact form submissions.
-- Public visitors POST a message from the About page; it is stored here. There
-- is no email provider wired up, so the maintainer reads submissions via the
-- token-gated GET /contact/messages endpoint (or straight from the DB). Wiring
-- real email forwarding later only needs a provider + secret, not a schema
-- change. IF NOT EXISTS keeps this safe to run on every startup.

BEGIN;

CREATE TABLE IF NOT EXISTS contact_message (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text,
  email       text,
  message     text NOT NULL,
  user_agent  text,
  handled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_message_created_idx ON contact_message (created_at DESC);

COMMIT;
