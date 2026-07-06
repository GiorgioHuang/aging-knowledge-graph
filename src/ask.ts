// Healthy Aging Knowledge — grounded Q&A (RAG) over the curated graph.
// Retrieve the most relevant claims via semantic search, hand the model ONLY the
// graph's own claims + evidence, and ask it to answer with citations — or to say
// the graph has no evidence. It must not invent facts or identifiers.

import type { Graph, Claim, Evidence } from "./types.ts";
import { search } from "./store.ts";
import { complete, completeWithUsage, extractJson, type Usage } from "./llm.ts";
import { graphClaimQuality, type Quality } from "./quality.ts";

const ZERO_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens });

export interface AskEvidence { source_id: string; quote?: string; study_design?: string }
export interface AskClaim {
  id: string;
  subject: string; subjectId: string;
  relationship: string;
  object: string; objectId: string;
  direction?: string; certainty?: string; population?: string; status: string;
  evidence: AskEvidence[];
  quality: Quality;
  cited?: boolean; // did the answer actually cite this claim's evidence?
}
export interface AskResult {
  question: string;
  answer: string;
  claims: AskClaim[];   // the grounding shown for transparency
  citations: string[];  // source ids the answer actually cited
  model: string;
  usage: Usage;         // total LLM tokens (retrieval + synthesis)
}

const nameOf = (g: Graph, id?: string) => (id ? g.nodes.get(id)?.name ?? id : "");

/** Turn a raw graph claim into the answer's grounding shape (with evidence). Pure. */
export function hydrateClaim(g: Graph, c: Claim): AskClaim {
  const ev = (c.evidence ?? [])
    .map((eid) => g.evidence.get(eid))
    .filter((e): e is Evidence => Boolean(e))
    .map((e) => ({ source_id: e.source_id, quote: e.quote ?? undefined, study_design: e.study_design ?? undefined }));
  return {
    id: c.id,
    subject: nameOf(g, c.subject), subjectId: c.subject,
    relationship: c.type.replace(/_/g, " "),
    object: nameOf(g, c.object), objectId: c.object,
    direction: c.direction ?? undefined,
    certainty: c.certainty ?? undefined,
    population: c.population ? nameOf(g, c.population) : undefined,
    status: c.status,
    evidence: ev,
    quality: graphClaimQuality(g, c),
  };
}

/** Vector-based retrieval (offline embedder / pgvector). Kept for the Search box
 *  and as a prefilter when the claim set is too large to hand the model whole. */
export async function retrieveClaimsByVector(g: Graph, question: string, k = 8): Promise<AskClaim[]> {
  const hits = await search(g, question, { k, owner: "claim" });
  return hits.map((h) => g.claims.get(h.id)).filter((c): c is Claim => Boolean(c)).map((c) => hydrateClaim(g, c));
}

// The offline hashing embedder matches surface wording, not meaning, so for the
// grounded answer we let the LLM do retrieval: it reads the whole claim catalog
// and picks what is genuinely relevant. Perfect recall on a graph this size, and
// real semantic understanding — no embeddings provider required.
const CATALOG_CAP = Number(process.env.ASK_CATALOG_MAX) || 600;

/** One catalog line the retriever model reads: "<id> | subject — rel → object". Pure. */
export function claimLine(g: Graph, c: Claim): string {
  const rel = c.type.replace(/_/g, " ");
  return `${c.id} | ${nameOf(g, c.subject)} — ${rel}${c.direction ? ` (${c.direction})` : ""} → ${nameOf(g, c.object)}` +
    `${c.population ? ` · in ${nameOf(g, c.population)}` : ""}${c.certainty ? ` · ${c.certainty}` : ""}`;
}

/** Candidate pool for the LLM retriever: curated claims (the answer should rest
 *  on verified evidence). If that pool is huge, prefilter with the vector index. */
async function candidateClaims(g: Graph, question: string): Promise<Claim[]> {
  const curated = [...g.claims.values()].filter((c) => c.status === "curated");
  const pool = curated.length ? curated : [...g.claims.values()];
  if (pool.length <= CATALOG_CAP) return pool;
  const hits = await search(g, question, { k: CATALOG_CAP, owner: "claim" });
  const keep = new Set(pool.map((c) => c.id));
  return hits.map((h) => g.claims.get(h.id)).filter((c): c is Claim => Boolean(c) && keep.has(c.id));
}

const RETRIEVER_SYSTEM = `You select which knowledge-graph claims are relevant to a question, judging by MEANING (not shared words). You are given a question and a list of claims, one per line as "<id> | subject — relationship → object". Return ONLY the ids of claims that could genuinely help answer the question, most relevant first, at most {K}. If none are truly relevant, return an empty list. Respond with a JSON array of id strings and nothing else.`;

/** Ask the LLM to pick the claim ids relevant to the question, by meaning.
 *  Returns the ids plus the token usage of the retrieval call. */
export async function selectRelevantClaimIds(g: Graph, question: string, k = 8, opts: { model?: string } = {}): Promise<{ ids: string[]; usage: Usage }> {
  const cands = await candidateClaims(g, question);
  if (!cands.length) return { ids: [], usage: ZERO_USAGE };
  const catalog = cands.map((c) => claimLine(g, c)).join("\n");
  const { text: raw, usage } = await completeWithUsage(
    [{ role: "user", content: `Question: ${question}\n\nClaims:\n${catalog}` }],
    { system: RETRIEVER_SYSTEM.replace("{K}", String(k)), maxTokens: 500, thinking: false, model: opts.model ?? process.env.ASK_RETRIEVER_MODEL ?? process.env.ASK_MODEL ?? undefined },
  );
  let ids: unknown;
  try { ids = extractJson(raw); } catch { return { ids: [], usage }; }
  if (!Array.isArray(ids)) return { ids: [], usage };
  const valid = new Set(cands.map((c) => c.id));
  const out: string[] = [];
  for (const id of ids) if (typeof id === "string" && valid.has(id) && !out.includes(id)) out.push(id);
  return { ids: out.slice(0, k), usage };
}

/** Render the retrieved claims as the model's grounding context. */
export function buildContext(claims: AskClaim[]): string {
  return claims
    .map((c, i) => {
      const head =
        `[C${i + 1}] ${c.subject} — ${c.relationship}${c.direction ? ` (${c.direction})` : ""} → ${c.object}` +
        `${c.population ? ` · population: ${c.population}` : ""}${c.certainty ? ` · certainty: ${c.certainty}` : ""} · status: ${c.status}`;
      const ev = c.evidence.length
        ? c.evidence.map((e) => `    - ${e.source_id}${e.study_design ? ` (${e.study_design})` : ""}${e.quote ? `: “${e.quote}”` : ""}`).join("\n")
        : "    - (no citation on record)";
      return `${head}\n${ev}`;
    })
    .join("\n\n");
}

/** Distinct source ids the answer actually cited (bracketed PMID:/DOI:). */
export function extractCitedIds(answer: string): string[] {
  const ids = new Set<string>();
  for (const m of answer.matchAll(/\[(PMID:\s*\d+|DOI:\s*[^\]\s]+)\]/gi)) ids.add(m[1].replace(/\s+/g, ""));
  return [...ids];
}

export const ASK_SYSTEM = `You are the answering assistant for Healthy Aging Knowledge, an evidence-traceable knowledge graph for healthy aging.
Answer the user's question USING ONLY the claims and evidence in the provided context. Rules:
- Do NOT use outside knowledge. If the context lacks enough evidence to answer, say so plainly (e.g. "The graph doesn't yet have evidence on this.") and stop — do not guess.
- Cite the sources you rely on inline, using their identifiers EXACTLY as given, in square brackets, e.g. [PMID:12345678] or [DOI:10.1000/xyz]. Never invent or alter an identifier.
- Be faithful to each claim's direction, population, and GRADE certainty. Do not overstate strength or scope.
- Keep it concise (a few sentences to a short paragraph), in plain language for a general reader.`;

/** Answer a question grounded in the graph. Retrieval is hermetic; the synthesis
 *  step calls the LLM (throws if ANTHROPIC_API_KEY is unset). */
export async function answerQuestion(g: Graph, question: string, opts: { k?: number; model?: string } = {}): Promise<AskResult> {
  const q = question.trim();
  const model = opts.model ?? process.env.ASK_MODEL ?? process.env.ANTHROPIC_MODEL ?? "";
  const sel = await selectRelevantClaimIds(g, q, opts.k ?? 8, { model: opts.model });
  const claims = sel.ids.map((id) => g.claims.get(id)).filter((c): c is Claim => Boolean(c)).map((c) => hydrateClaim(g, c));
  if (!claims.length) {
    return { question: q, answer: "The graph doesn't yet have evidence on this — no relevant claims were found.", claims: [], citations: [], model, usage: sel.usage };
  }
  const user = `Question: ${q}\n\nContext — claims from the graph (cite by the bracketed source ids on each evidence line):\n\n${buildContext(claims)}`;
  const synth = await completeWithUsage([{ role: "user", content: user }], {
    system: ASK_SYSTEM,
    maxTokens: 1200,
    thinking: false,
    model: opts.model ?? process.env.ASK_MODEL ?? undefined,
  });
  const answer = synth.text.trim();
  // Flag which retrieved claims the answer actually cited, so the UI can show
  // the true grounding (retrieval over-fetches — off-topic hits are common with
  // the offline embedder) rather than the raw candidate set.
  const citations = extractCitedIds(answer);
  const citedSet = new Set(citations.map((c) => c.toLowerCase()));
  for (const c of claims) c.cited = c.evidence.some((e) => citedSet.has(e.source_id.toLowerCase()));
  return { question: q, answer, claims, citations, model, usage: addUsage(sel.usage, synth.usage) };
}
