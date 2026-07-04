// GraceAge Knowledge — Q&A request logging.
// Records every /ask to Postgres (question, grounded answer, retrieved/cited
// claims, model, latency, client info). Best-effort: never throws into the
// request path, and is a no-op when no DATABASE_URL is set. The table is created
// lazily so a deployment provisioned before migration 0005 gets it on first write.

import { isDbConfigured, getSql, type Sql } from "./db.ts";

export interface AskLogEntry {
  question: string;
  answer?: string;
  model?: string;
  ok: boolean;
  error?: string;
  claimIds?: string[];
  citations?: string[];
  numClaims?: number;
  ip?: string;
  userAgent?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AskLogRow extends Omit<AskLogEntry, "claimIds" | "numClaims" | "latencyMs" | "inputTokens" | "outputTokens"> {
  id: number;
  claim_ids: string[] | null;
  num_claims: number | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  gap_status: string | null;
  created_at: string;
}

// CREATE for fresh DBs (includes gap_status) + ALTER for tables created before
// the gap_status column existed. Run on every save/list/gap pass so the column
// is guaranteed present regardless of which path first created the table.
const DDL = [
  `CREATE TABLE IF NOT EXISTS ask_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question text NOT NULL, answer text, model text,
    ok boolean NOT NULL DEFAULT true, error text,
    claim_ids text[], citations text[], num_claims int,
    ip text, user_agent text, latency_ms int, gap_status text,
    input_tokens int, output_tokens int,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS gap_status text`,
  `ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS input_tokens int`,
  `ALTER TABLE ask_log ADD COLUMN IF NOT EXISTS output_tokens int`,
];

/** Ensure the ask_log table + gap_status column exist. */
export async function ensureAskLog(sql: Sql): Promise<void> {
  for (const s of DDL) await sql.query(s);
}

/** Persist one Q&A request. No-op without a DB; swallows its own errors. */
export async function saveAskLog(e: AskLogEntry): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    const sql = await getSql();
    await ensureAskLog(sql);
    await sql.query(
      `INSERT INTO ask_log (question, answer, model, ok, error, claim_ids, citations, num_claims, ip, user_agent, latency_ms, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [e.question, e.answer ?? null, e.model || null, e.ok, e.error ?? null,
       e.claimIds ?? null, e.citations ?? null, e.numClaims ?? null, e.ip ?? null, e.userAgent ?? null, e.latencyMs ?? null,
       e.inputTokens ?? null, e.outputTokens ?? null],
    );
  } catch (err) {
    console.error(`ask_log write failed: ${(err as Error).message}`);
  }
}

/** Newest-first Q&A log, for the maintainer (token-gated at the HTTP layer). */
export async function listAskLogs(limit = 100): Promise<AskLogRow[]> {
  if (!isDbConfigured()) return [];
  const sql = await getSql();
  await ensureAskLog(sql);
  const n = Math.min(Math.max(1, Math.floor(limit)), 500);
  return (await sql.query(
    "SELECT id, question, answer, model, ok, error, claim_ids, citations, num_claims, ip, user_agent, latency_ms, input_tokens, output_tokens, gap_status, created_at FROM ask_log ORDER BY created_at DESC LIMIT $1",
    [n],
  )) as AskLogRow[];
}
