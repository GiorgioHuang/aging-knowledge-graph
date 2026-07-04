// GraceAge Knowledge — automatic topic generation (keeps the curator fed).
// When the queue runs low, propose NEW healthy-aging research topics so the graph
// keeps expanding without hand-curated topics. Quality is enforced structurally:
// every generated topic must be tagged with a domain from the ontology's
// controlled vocabulary (the healthy-aging scope) — anything else is dropped —
// on top of a strict in-scope prompt and de-duplication against existing topics.

import { complete, extractJson } from "./llm.ts";
import { loadGraph } from "./model.ts";
import { getSql } from "./db.ts";
import { seedTopics, slugId } from "./topics.ts";

const DOMAINS = loadGraph().ontology.domains;
const DOMAIN_SET = new Set(DOMAINS);

const GEN_SYSTEM = `You generate NEW research topics for GraceAge Knowledge, an evidence-based knowledge graph STRICTLY about healthy aging / geriatrics (older adults, ~65+).

Every topic MUST:
- be squarely within healthy-aging / older-adult health scope, and map to exactly one of these domains: ${DOMAINS.join(", ")};
- be specific and researchable — a clear intervention/exposure/condition tied to an aging-relevant outcome or older-adult population — the kind with systematic reviews, RCTs, or cohort studies to cite;
- NOT duplicate or closely overlap any topic in the provided EXISTING list.

Do NOT propose anything outside older-adult health (no pediatrics, no general/unrelated topics, no pure basic science). When unsure, omit.

Output ONLY a JSON array (no prose): [{"topic":"<specific topic>","domain":"<one domain from the list above>"}]`;

function buildPrompt(existing: string[], count: number): string {
  return `EXISTING topics (do not repeat or overlap these):
${existing.slice(0, 200).map((t) => `- ${t}`).join("\n") || "(none)"}

Propose ${count} NEW, specific, in-scope healthy-aging topics not already covered. Output only the JSON array.`;
}

/** Pure: keep only well-formed, in-scope (valid domain), non-duplicate topics. */
export function filterTopics(arr: unknown, existing: string[]): { topic: string; priority: number }[] {
  const existingSet = new Set(existing.map((t) => slugId(t)));
  const seen = new Set<string>();
  const out: { topic: string; priority: number }[] = [];
  for (const t of Array.isArray(arr) ? arr : []) {
    const topic = typeof (t as { topic?: unknown })?.topic === "string" ? (t as { topic: string }).topic.trim() : "";
    const domain = (t as { domain?: unknown })?.domain;
    if (topic.length < 10) continue;
    if (typeof domain !== "string" || !DOMAIN_SET.has(domain)) continue; // hard healthy-aging scope gate
    const id = slugId(topic);
    if (existingSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ topic, priority: 3 });
  }
  return out;
}

export interface GenerateResult { proposed: number; added: number; topics: string[] }

/** Generate and enqueue new in-scope topics. `gen` (LLM) is injectable for tests. */
export async function generateTopics(opts: { count?: number; model?: string } = {}): Promise<GenerateResult> {
  const count = Math.max(1, Math.min(opts.count ?? 8, 20));
  const sql = await getSql();
  const existing = (await sql.query("SELECT topic FROM topic ORDER BY created_at DESC LIMIT 200", [])) as { topic: string }[];
  const existingTopics = existing.map((e) => e.topic);

  let arr: unknown;
  try {
    const text = await complete([{ role: "user", content: buildPrompt(existingTopics, count) }], { system: GEN_SYSTEM, maxTokens: 2000, model: opts.model, thinking: false });
    arr = extractJson(text);
  } catch {
    return { proposed: 0, added: 0, topics: [] };
  }
  const valid = filterTopics(arr, existingTopics).slice(0, count);
  const added = await seedTopics(valid.map((v) => ({ topic: v.topic, priority: v.priority, source: "auto_gen" })));
  return { proposed: Array.isArray(arr) ? arr.length : 0, added, topics: valid.map((v) => v.topic) };
}
