// GraceAge Knowledge — close the loop: turn user questions the graph COULDN'T
// answer (ask_log gaps: ok, num_claims=0) into curation topics — but only the
// ones that are genuinely relevant. Two gates protect the queue from junk:
//   1. an LLM relevance judge (in scope for healthy aging? researchable?) that
//      also normalizes the raw question into a topic + ontology domain;
//   2. the SAME structural scope gate the topic generator uses (filterTopics:
//      valid domain, well-formed, non-duplicate).
// Off-topic / nonsensical / out-of-scope questions are marked 'rejected' and are
// never processed again.

import { complete, extractJson } from "./llm.ts";
import { loadGraph } from "./model.ts";
import { getSql } from "./db.ts";
import { seedTopics } from "./topics.ts";
import { filterTopics } from "./topicgen.ts";
import { ensureAskLog } from "./asklog.ts";

const DOMAINS = loadGraph().ontology.domains;

interface Judgement { relevant?: boolean; topic?: unknown; domain?: unknown }

const JUDGE_SYSTEM = `You triage user questions for GraceAge Knowledge, an evidence graph STRICTLY about healthy aging / geriatrics (older adults, ~65+).

For each question decide if it is a RELEVANT, researchable healthy-aging topic worth adding to the graph. It is relevant ONLY if it concerns older-adult health — an intervention, exposure, or condition tied to an aging-relevant outcome or older population, of the kind with systematic reviews, RCTs, or cohort studies.

REJECT (relevant=false) anything that is: off-topic, nonsensical, spam, not actually a question, about children/general population/not older adults, pure basic science, or otherwise outside older-adult health. When unsure, REJECT.

For each RELEVANT question, write a concise, specific research TOPIC phrase (NOT the raw question) and map it to exactly ONE domain from: ${DOMAINS.join(", ")}.

Output ONLY a JSON array, one object per input question in order:
[{"i":<index>,"relevant":true|false,"topic":"<topic, omit if not relevant>","domain":"<one domain from the list, omit if not relevant>"}]`;

/** Pure: an accepted, normalized topic for a judged question, or null if it fails
 *  either gate (not relevant, invalid domain, malformed, or duplicate). */
export function topicFromJudgement(v: Judgement | undefined, existing: string[]): string | null {
  if (!v || v.relevant !== true) return null;
  if (typeof v.topic !== "string" || typeof v.domain !== "string") return null;
  const ok = filterTopics([{ topic: v.topic, domain: v.domain }], existing);
  return ok.length ? ok[0].topic : null;
}

export interface GapResult { scanned: number; queued: number; rejected: number; topics: string[] }

interface GapRow { id: number; question: string }

/** Triage unprocessed Q&A gaps into topics (relevance-gated). LLM is one batch
 *  call; returns immediately (no LLM cost) when there are no gaps. */
export async function processGapQuestions(opts: { limit?: number; model?: string } = {}): Promise<GapResult> {
  const sql = await getSql();
  await ensureAskLog(sql);
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const gaps = (await sql.query(
    `SELECT id, question FROM ask_log
     WHERE ok = true AND (num_claims = 0 OR num_claims IS NULL) AND gap_status IS NULL
     ORDER BY created_at DESC LIMIT $1`,
    [limit],
  )) as GapRow[];
  if (!gaps.length) return { scanned: 0, queued: 0, rejected: 0, topics: [] };

  let judged: unknown;
  try {
    const list = gaps.map((g, i) => `${i}. ${g.question}`).join("\n");
    const text = await complete([{ role: "user", content: `Questions:\n${list}` }], { system: JUDGE_SYSTEM, maxTokens: 1500, thinking: false, model: opts.model });
    judged = extractJson(text);
  } catch {
    return { scanned: gaps.length, queued: 0, rejected: 0, topics: [] }; // leave unprocessed; retry next run
  }
  const byIndex = new Map<number, Judgement>();
  for (const j of Array.isArray(judged) ? judged : []) {
    const i = Number((j as { i?: unknown })?.i);
    if (Number.isInteger(i)) byIndex.set(i, j as Judgement);
  }

  const existing = ((await sql.query("SELECT topic FROM topic ORDER BY created_at DESC LIMIT 500", [])) as { topic: string }[]).map((e) => e.topic);

  let queued = 0, rejected = 0;
  const topics: string[] = [];
  for (let i = 0; i < gaps.length; i++) {
    const topic = topicFromJudgement(byIndex.get(i), existing);
    let status: "queued" | "rejected";
    if (topic) {
      // user-driven → above auto-generated (3); tag provenance to the question
      const added = await seedTopics([{ topic, priority: 5, source: "ask_gap", source_detail: gaps[i].question }]);
      if (added) { queued++; topics.push(topic); existing.push(topic); }
      status = "queued";
    } else {
      rejected++;
      status = "rejected";
    }
    await sql.query("UPDATE ask_log SET gap_status=$2 WHERE id=$1", [gaps[i].id, status]);
  }
  return { scanned: gaps.length, queued, rejected, topics };
}
