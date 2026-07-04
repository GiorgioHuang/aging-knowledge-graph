// GraceAge Knowledge — topic work queue + agent run log.
// The curator pulls one pending topic at a time (atomic claim with SKIP LOCKED
// so concurrent jobs don't collide), expands it, then marks it done/failed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getSql } from "./db.ts";

const here = dirname(fileURLToPath(import.meta.url));

export interface Topic {
  id: string;
  topic: string;
  status: string;
  priority: number;
  attempts: number;
}

/** Turn a free-text topic into a stable id (so re-seeding is idempotent). */
export function slugId(text: string, prefix = "t"): string {
  const s = text.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${prefix}:${s || "x"}`;
}

/** Create the agent tables if they don't exist (idempotent — runs every cycle so
 *  databases provisioned before migration 0003 pick them up automatically). */
export async function ensureAgentSchema(): Promise<void> {
  const sql = await getSql();
  const file = join(here, "..", "db", "migrations", "0003_agents.sql");
  const stmts = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*--/.test(l) && !/^\s*(BEGIN|COMMIT)\s*;/i.test(l))
    .join("\n")
    .split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) await sql.query(s);
}

/** Atomically claim the highest-priority pending topic, marking it in_progress. */
export async function claimNextTopic(): Promise<Topic | undefined> {
  const sql = await getSql();
  const rows = (await sql.query(
    `UPDATE topic SET status='in_progress', attempts=attempts+1, updated_at=now()
     WHERE id = (
       SELECT id FROM topic WHERE status='pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, topic, status, priority, attempts`,
    [],
  )) as Topic[];
  return rows[0];
}

export async function finishTopic(id: string, status: "done" | "failed" | "pending", note?: string): Promise<void> {
  const sql = await getSql();
  await sql.query(
    "UPDATE topic SET status=$2, last_error=$3, updated_at=now() WHERE id=$1",
    [id, status, status === "failed" ? note ?? null : null],
  );
}

export interface SeedTopic { id?: string; topic: string; priority?: number; source?: string; source_detail?: string }

/** Insert topics (idempotent on id). Records provenance (source + original
 *  detail) so user-driven vs auto-generated vs seed content is traceable.
 *  Returns the number newly inserted. */
export async function seedTopics(topics: SeedTopic[]): Promise<number> {
  const sql = await getSql();
  // Ensure provenance columns exist (databases provisioned before migration 0008).
  await sql.query("ALTER TABLE topic ADD COLUMN IF NOT EXISTS source text");
  await sql.query("ALTER TABLE topic ADD COLUMN IF NOT EXISTS source_detail text");
  let n = 0;
  for (const t of topics) {
    const id = t.id ?? slugId(t.topic);
    const r = await sql.query(
      "INSERT INTO topic (id,topic,priority,source,source_detail) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING id",
      [id, t.topic, t.priority ?? 0, t.source ?? null, t.source_detail ?? null],
    );
    if (r.length) n++;
  }
  return n;
}

/** Reset all `failed` topics back to `pending` (fresh attempt count) so they get
 *  retried. Returns the number re-queued. */
export async function requeueFailedTopics(): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query(
    "UPDATE topic SET status='pending', attempts=0, last_error=NULL, updated_at=now() WHERE status='failed' RETURNING id",
    [],
  );
  return rows.length;
}

export async function countPendingTopics(): Promise<number> {
  const sql = await getSql();
  const [r] = (await sql.query("SELECT count(*)::int AS n FROM topic WHERE status='pending'", [])) as { n: number }[];
  return r?.n ?? 0;
}

/** Append a row to the agent run log (best-effort; never throws). */
export async function logRun(entry: {
  agent: string; topic_id?: string; claim_id?: string; outcome?: string; summary?: unknown;
}): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query(
      "INSERT INTO agent_run (agent,topic_id,claim_id,outcome,summary) VALUES ($1,$2,$3,$4,$5)",
      [entry.agent, entry.topic_id ?? null, entry.claim_id ?? null, entry.outcome ?? null,
       entry.summary === undefined ? null : JSON.stringify(entry.summary)],
    );
  } catch { /* logging must not break a run */ }
}

/** Load the seed topic list shipped in the repo (seed/topics.json). */
export function loadSeedTopics(): { id?: string; topic: string; priority?: number }[] {
  try {
    const raw = JSON.parse(readFileSync(join(here, "..", "seed", "topics.json"), "utf8")) as
      { topics?: { id?: string; topic: string; priority?: number }[] };
    return raw.topics ?? [];
  } catch {
    return [];
  }
}
