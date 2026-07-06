// Healthy Aging Knowledge — human review console (the "exceptions to humans" half of
// the agent policy). The reviewer agent files suspect claims as
// `needs_refinement` and logs WHY (verdict + reason + citation checks) to
// agent_run. This module surfaces that queue with full context and lets a human
// approve (→ curated) or reject (delete) each one. Read is open; the HTTP layer
// token-gates the approve/reject actions like any other write.

import { getSql } from "./db.ts";
import { loadGraph } from "./model.ts";
import { deleteClaim } from "./writes.ts";
import { logRun } from "./topics.ts";
import { scoreClaim, type Quality } from "./quality.ts";

const CERTAINTIES = new Set(loadGraph().ontology.certainties);

export interface QueueEvidence {
  id: string; source_id: string; quote: string | null; study_design: string | null; source_node_id: string | null;
}
export interface ReviewLog {
  verdict?: string; reason?: string; certainty?: string;
  citations?: { source_id: string; resolved: boolean }[];
  enriched?: { papers: number; designs: number };
  at?: string;
}
export interface QueueItem {
  id: string; type: string; status: string;
  subject: { id: string; name: string };
  object: { id: string; name: string };
  population: { id: string; name: string } | null;
  direction: string | null; certainty: string | null;
  evidence: QueueEvidence[];
  quality: Quality;
  review: ReviewLog | null;
}

/** Claims awaiting human attention (default `needs_refinement`), newest first,
 *  with their evidence and the reviewer's latest rationale from agent_run. */
export async function reviewQueue(opts: { status?: string; limit?: number; offset?: number; q?: string } = {}): Promise<QueueItem[]> {
  const sql = await getSql();
  const status = opts.status ?? "needs_refinement";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const search = (opts.q ?? "").trim();
  const claims = (await sql.query(
    `SELECT c.id, c.type, c.status, c.subject_id, c.object_id, c.population_id, c.direction, c.certainty,
            s.name AS subj, o.name AS obj, p.name AS pop
     FROM claim c
     JOIN node s ON s.id = c.subject_id
     JOIN node o ON o.id = c.object_id
     LEFT JOIN node p ON p.id = c.population_id
     WHERE ($1 = 'all' OR c.status::text = $1)
       AND ($3 = '' OR s.name ILIKE '%'||$3||'%' OR o.name ILIKE '%'||$3||'%' OR c.type::text ILIKE '%'||$3||'%')
     ORDER BY c.updated_at DESC
     LIMIT $2 OFFSET $4`,
    [status, limit, search, offset],
  )) as any[];
  if (claims.length === 0) return [];
  const ids = claims.map((c) => c.id);

  const ev = (await sql.query(
    "SELECT id, claim_id, source_id, quote, study_design, source_node_id FROM evidence WHERE claim_id = ANY($1::text[])",
    [ids],
  )) as any[];
  const byClaim = new Map<string, QueueEvidence[]>();
  for (const e of ev) (byClaim.get(e.claim_id) ?? byClaim.set(e.claim_id, []).get(e.claim_id)!).push(
    { id: e.id, source_id: e.source_id, quote: e.quote, study_design: e.study_design, source_node_id: e.source_node_id },
  );

  let logs: any[] = [];
  try {
    logs = (await sql.query(
      `SELECT DISTINCT ON (claim_id) claim_id, summary, created_at
       FROM agent_run WHERE agent='reviewer' AND claim_id = ANY($1::text[])
       ORDER BY claim_id, created_at DESC`,
      [ids],
    )) as any[];
  } catch { /* agent_run may not exist yet */ }
  const logByClaim = new Map<string, ReviewLog>();
  for (const l of logs) {
    const s = (typeof l.summary === "string" ? safeJson(l.summary) : l.summary) ?? {};
    logByClaim.set(l.claim_id, { verdict: s.verdict, reason: s.reason, certainty: s.certainty, citations: s.citations, enriched: s.enriched, at: l.created_at });
  }

  // Conflict status (for the consistency factor) — claims in a contradiction.
  const conflicted = new Set<string>();
  try {
    const rels = (await sql.query(
      "SELECT subject_claim_id, object_claim_id FROM claim_relation WHERE type='contradicts' AND (subject_claim_id = ANY($1::text[]) OR object_claim_id = ANY($1::text[]))",
      [ids],
    )) as any[];
    for (const r of rels) { conflicted.add(r.subject_claim_id); conflicted.add(r.object_claim_id); }
  } catch { /* claim_relation may not exist yet */ }

  return claims.map((c) => {
    const evidence = byClaim.get(c.id) ?? [];
    return {
      id: c.id, type: c.type, status: c.status,
      subject: { id: c.subject_id, name: c.subj }, object: { id: c.object_id, name: c.obj },
      population: c.population_id ? { id: c.population_id, name: c.pop } : null,
      direction: c.direction, certainty: c.certainty,
      evidence,
      quality: scoreClaim({ evidence, conflicted: conflicted.has(c.id) }),
      review: logByClaim.get(c.id) ?? null,
    };
  });
}

/** Total claims matching a status (+ optional concept search) — the real count
 *  behind the paginated queue, independent of the page limit. */
export async function reviewQueueCount(status = "needs_refinement", q = ""): Promise<number> {
  const sql = await getSql();
  const [r] = (await sql.query(
    `SELECT count(*)::int AS n
     FROM claim c
     JOIN node s ON s.id = c.subject_id
     JOIN node o ON o.id = c.object_id
     WHERE ($1 = 'all' OR c.status::text = $1)
       AND ($2 = '' OR s.name ILIKE '%'||$2||'%' OR o.name ILIKE '%'||$2||'%' OR c.type::text ILIKE '%'||$2||'%')`,
    [status, q.trim()],
  )) as { n: number }[];
  return r?.n ?? 0;
}

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return undefined; } }

export interface ReviewStats {
  byStatus: Record<string, number>;
  queue: number;
  nodes: number;
  papers: number;
  pendingTopics: number;
  recent: { agent: string; outcome: string; n: number }[];
}

/** Dashboard counts: claims by status, queue depth, nodes/papers, pending topics,
 *  and recent agent activity. Optional tables (topic/agent_run) are guarded. */
export async function reviewStats(): Promise<ReviewStats> {
  const sql = await getSql();
  const byStatusRows = (await sql.query("SELECT status, count(*)::int AS n FROM claim GROUP BY status", [])) as { status: string; n: number }[];
  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r.n;
  const [{ n: nodes }] = (await sql.query("SELECT count(*)::int AS n FROM node", [])) as { n: number }[];
  const [{ n: papers }] = (await sql.query("SELECT count(*)::int AS n FROM node WHERE type='paper'", [])) as { n: number }[];

  let pendingTopics = 0;
  try { const [r] = (await sql.query("SELECT count(*)::int AS n FROM topic WHERE status='pending'", [])) as { n: number }[]; pendingTopics = r?.n ?? 0; } catch { /* no topic table */ }
  let recent: { agent: string; outcome: string; n: number }[] = [];
  try {
    recent = (await sql.query(
      "SELECT agent, COALESCE(outcome,'?') AS outcome, count(*)::int AS n FROM agent_run WHERE created_at > now() - interval '7 days' GROUP BY agent, outcome ORDER BY n DESC",
      [],
    )) as { agent: string; outcome: string; n: number }[];
  } catch { /* no agent_run table */ }

  return { byStatus, queue: byStatus["needs_refinement"] ?? 0, nodes, papers, pendingTopics, recent };
}

export type DecideResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; errors: string[] };

/** Human decision on a queued claim: approve (→ curated, optional certainty) or
 *  reject (delete the claim + its evidence). Logged to agent_run as agent=human. */
export async function decideClaim(id: string, action: "approve" | "reject", opts: { certainty?: string; note?: string } = {}): Promise<DecideResult> {
  const sql = await getSql();
  const rows = (await sql.query("SELECT id, status FROM claim WHERE id=$1", [id])) as { id: string; status: string }[];
  if (rows.length === 0) return { ok: false, status: 404, errors: [`claim '${id}' not found`] };

  if (action === "approve") {
    const certainty = opts.certainty && CERTAINTIES.has(opts.certainty) ? opts.certainty : undefined;
    await sql.query("UPDATE claim SET status='curated', certainty=COALESCE($2,certainty), updated_at=now() WHERE id=$1", [id, certainty ?? null]);
    await logRun({ agent: "human", claim_id: id, outcome: "curated", summary: { action: "approve", note: opts.note, certainty } });
    return { ok: true, data: { id, status: "curated" } };
  }

  const r = await deleteClaim(id); // cascades evidence + claim_relation, removes embedding
  if (!r.ok) return r as DecideResult;
  await logRun({ agent: "human", claim_id: id, outcome: "rejected", summary: { action: "reject", note: opts.note } });
  return { ok: true, data: { id, deleted: true } };
}
