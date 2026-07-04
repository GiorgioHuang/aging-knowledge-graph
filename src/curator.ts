// GraceAge Knowledge — Curator agent.
// Continuously EXPANDS the graph: it takes a topic, asks Claude to propose
// well-formed, literature-grounded candidate claims. The model DESCRIBES each
// source (title + author + year) but never supplies the identifier — LLMs
// hallucinate PMIDs/DOIs. The pipeline resolves the REAL id by searching
// PubMed/Crossref and confirming the title matches (src/citeresolve.ts); a
// claim whose citation can't be resolved is dropped, not written with a guessed
// id. Resolved claims are written with status `unverified`; the Reviewer
// (src/reviewer.ts) then checks support and promotes or flags them.

import { getSql } from "./db.ts";
import { loadGraph } from "./model.ts";
import { createNode, createClaim, createEvidence, addAlias } from "./writes.ts";
import { complete, extractJson } from "./llm.ts";
import { envModelFor } from "./models.ts";
import { logRun } from "./topics.ts";
import { NodeResolver } from "./resolve.ts";
import { resolveCitation } from "./citeresolve.ts";

const onto = loadGraph().ontology;
const CURIE = /^[A-Za-z0-9.]+:.+$/;

export interface CandidateNode { id?: string; name: string; type: string }
export interface Candidate {
  subject: CandidateNode;
  object: CandidateNode;
  relationship: string;
  direction?: string;
  population?: string;
  certainty?: string;
  // The model describes the source; the identifier is resolved by us, not given.
  citation: { title: string; first_author?: string; year?: string; journal?: string; quote?: string; study_design?: string };
  rationale?: string;
}

/** Stable claim id from its semantic key, so re-running a topic dedups. */
export function makeClaimId(subject: string, rel: string, object: string, population?: string): string {
  const key = `${subject}|${rel}|${object}|${population ?? ""}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `gc:${(h >>> 0).toString(36)}`;
}

function fnv36(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Find an existing edge with the same subject+relationship+object+direction
 *  (population-agnostic, direction-sensitive so opposing claims stay separate).
 *  Prefers a curated match. Returns its claim id, or undefined. */
async function findExistingClaim(subject: string, object: string, rel: string, direction?: string): Promise<string | undefined> {
  const sql = await getSql();
  const rows = (await sql.query(
    `SELECT id FROM claim
     WHERE subject_id=$1 AND object_id=$2 AND type=$3 AND direction IS NOT DISTINCT FROM $4
     ORDER BY (status='curated') DESC, created_at ASC LIMIT 1`,
    [subject, object, rel, direction ?? null],
  )) as { id: string }[];
  return rows[0]?.id;
}

/** Attach a citation as new evidence on an existing claim (skips if that source
 *  is already cited there). Returns true if evidence was added. */
async function attachEvidence(claimId: string, sourceId: string, c: Candidate, model: string): Promise<boolean> {
  const sql = await getSql();
  const dup = (await sql.query("SELECT 1 FROM evidence WHERE claim_id=$1 AND source_id=$2", [claimId, sourceId])) as unknown[];
  if (dup.length) return false;
  const r = await createEvidence({
    id: `${claimId}-e${fnv36(sourceId)}`,
    claim: claimId,
    source_id: sourceId,
    quote: c.citation.quote,
    study_design: onto.studyDesigns.includes(String(c.citation.study_design)) ? c.citation.study_design : undefined,
    extracted_by: `agent:curator:${model}`,
  });
  return r.ok;
}

/** Stable node id from a concept name. */
export function nodeId(name: string): string {
  const s = name.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `ga:${s || "node"}`;
}

/** Coerce a raw citation source_id to a CURIE the writer accepts (PMID:/DOI:/URL). */
export function normalizeSourceId(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  if (/^(PMID|DOI|URL):/i.test(s) || /^https?:\/\//i.test(s)) return s;
  if (/^\d+$/.test(s)) return `PMID:${s}`;
  if (/^10\.\d{4,}\//.test(s)) return `DOI:${s}`;
  return s;
}

/** Validate a candidate against the ontology. Returns the list of problems. */
export function validateCandidate(c: Candidate): string[] {
  const errs: string[] = [];
  if (!c?.subject?.name) errs.push("subject.name missing");
  if (!c?.object?.name) errs.push("object.name missing");
  if (!onto.nodeTypes.includes(c?.subject?.type)) errs.push(`bad subject.type '${c?.subject?.type}'`);
  if (!onto.nodeTypes.includes(c?.object?.type)) errs.push(`bad object.type '${c?.object?.type}'`);
  if (!onto.relationshipTypes.includes(c?.relationship)) errs.push(`bad relationship '${c?.relationship}'`);
  if (c?.direction && !onto.directions.includes(c.direction)) errs.push(`bad direction '${c.direction}'`);
  if (c?.certainty && !onto.certainties.includes(c.certainty)) errs.push(`bad certainty '${c.certainty}'`);
  if (!c?.citation?.title || c.citation.title.trim().length < 8) errs.push("citation.title (the paper's full title) is required");
  return errs;
}

const SYSTEM = `You are the Curator for GraceAge Knowledge, an evidence-traceable knowledge graph about healthy aging.
Your job: given a TOPIC, propose well-formed candidate claims that connect two concepts, each grounded in a REAL, citable scientific source.

Hard rules:
- Every claim MUST be grounded in a REAL, specific paper. Provide its exact full TITLE, the first author's surname, the publication year, and the journal, plus a short supporting finding/quote. Prefer systematic reviews/meta-analyses and large RCTs/cohorts in older adults.
- DO NOT output any PubMed ID, PMID, or DOI. The system looks up the real identifier from the title you give — an invented identifier is useless and a wrong one is discarded. Give the most accurate title you can. If you are not confident the paper is real, omit that claim.
- DO NOT OVERSTATE the source. The relationship, object, direction, population, and dose must reflect what the cited paper actually reports. Do not present a general guideline or recommendation as an endorsement of a specific tool, brand, instrument, or product the source does not name; if the source is general, keep the claim general (use the general concept as the object). Match the claim's specificity to the evidence — no more.
- The OBJECT must be the outcome the source actually measured for the SUBJECT, and the POPULATION must be the population the source actually studied. Do not swap a measured outcome for a related-but-different one (e.g. detecting/assessing falls is NOT reducing fall rate; improving balance is NOT improving muscle strength), and do not attribute an outcome seen in one group to another (e.g. a benefit to care-recipients is not a benefit to caregivers). Pick the relationship type that matches what the study did (assesses/measures for tools that detect or evaluate; treats/improves/reduces_risk_of only when the study shows that effect).
- Reuse existing node ids when a concept already exists (a list is provided). Otherwise propose a new node with a clear name and a type from the vocabulary.
- Stay on the topic and within healthy-aging scope.

Output ONLY a JSON array (no prose) of objects with this exact shape:
[{
  "subject": {"id": "<existing id or omit>", "name": "<concept>", "type": "<node type>"},
  "object":  {"id": "<existing id or omit>", "name": "<concept>", "type": "<node type>"},
  "relationship": "<relationship type>",
  "direction": "increase|decrease|no_effect|mixed (optional)",
  "population": "<who, e.g. 'community-dwelling older adults' (optional)>",
  "certainty": "high|moderate|low|very_low (GRADE of the body of evidence, optional)",
  "citation": {"title": "<exact full paper title>", "first_author": "<surname>", "year": "<year>", "journal": "<journal>", "quote": "<short supporting finding>", "study_design": "<study design>"},
  "rationale": "<one sentence on why this claim belongs>"
}]`;

export function buildUserPrompt(topic: string, existingNodes: { id: string; name: string; type: string }[]): string {
  const vocab = [
    `node types: ${onto.nodeTypes.join(", ")}`,
    `relationship types: ${onto.relationshipTypes.join(", ")}`,
    `directions: ${onto.directions.join(", ")}`,
    `certainties: ${onto.certainties.join(", ")}`,
    `study designs: ${onto.studyDesigns.join(", ")}`,
  ].join("\n");
  const nodes = existingNodes.slice(0, 250).map((n) => `${n.id} (${n.type}): ${n.name}`).join("\n");
  return `TOPIC: ${topic}

Controlled vocabulary:
${vocab}

Existing nodes (reuse these ids where a concept already exists):
${nodes || "(none yet)"}

Propose up to 6 high-quality, well-cited candidate claims for this topic.

CRITICAL OUTPUT FORMAT: respond with ONLY a raw JSON array. No prose, no explanation, no markdown code fences. The very first character of your response must be "[" and the last must be "]".`;
}

/** Resolve a proposed concept to an existing node (folding in the new surface
 *  form as an alias), or create a fresh node. Mutates the resolver so later
 *  candidates in the same run see the decision. Returns the node id, or
 *  undefined if a required node could not be created. */
async function resolveOrCreate(
  cand: { id?: string; name: string; type: string },
  resolver: NodeResolver,
  counters: { reused: number },
): Promise<string | undefined> {
  // 1) trust an explicit, already-existing id from the model
  if (cand.id && resolver.byId(cand.id)) return cand.id;
  // 2) lexical/alias match against existing nodes of the same type
  const match = resolver.resolve(cand);
  if (match) {
    counters.reused++;
    if (resolver.noteAlias(match.id, cand.name)) await addAlias(match.id, cand.name);
    return match.id;
  }
  // 3) create a new node
  const id = cand.id && CURIE.test(cand.id) ? cand.id : nodeId(cand.name);
  const r = await createNode({ id, type: cand.type, name: cand.name });
  if (!r.ok && r.status !== 409) return undefined;
  resolver.add({ id, name: cand.name, type: cand.type, aliases: [] });
  return id;
}

/** Persist one validated candidate. Resolves the citation to a REAL id by title
 *  match FIRST (dropping the candidate if none is found), de-duplicates nodes via
 *  the resolver, then writes a claim with status `unverified`. */
export async function persistCandidate(
  c: Candidate,
  model: string,
  resolver: NodeResolver,
  counters: { reused: number } = { reused: 0 },
): Promise<{ ok: boolean; claimId?: string; source?: string; merged?: boolean; errors?: string[] }> {
  // Resolve the citation BEFORE touching the graph: no real source ⇒ no write.
  const cite = await resolveCitation({
    title: c.citation.title, first_author: c.citation.first_author, year: c.citation.year, journal: c.citation.journal,
  });
  if (!cite) return { ok: false, errors: [`citation not resolved: "${(c.citation.title ?? "").slice(0, 90)}"`] };

  const subjId = await resolveOrCreate(c.subject, resolver, counters);
  if (!subjId) return { ok: false, errors: ["could not create subject node"] };
  const objId = await resolveOrCreate(c.object, resolver, counters);
  if (!objId) return { ok: false, errors: ["could not create object node"] };

  // Edge-level de-dup: if this relationship already exists (same direction),
  // attach the citation as additional evidence instead of making a duplicate edge.
  const existing = await findExistingClaim(subjId, objId, c.relationship, c.direction);
  if (existing) {
    await attachEvidence(existing, cite.source_id, c, model);
    return { ok: true, claimId: existing, source: cite.source_id, merged: true };
  }

  let popId: string | undefined;
  if (c.population) {
    popId = await resolveOrCreate({ name: c.population, type: "population" }, resolver, counters); // optional
  }

  const id = makeClaimId(subjId, c.relationship, objId, popId);
  const res = await createClaim({
    id,
    type: c.relationship,
    subject: subjId,
    object: objId,
    population: popId,
    direction: c.direction,
    certainty: c.certainty,
    status: "unverified",
    evidence: [{
      source_id: cite.source_id,
      quote: c.citation.quote,
      study_design: onto.studyDesigns.includes(String(c.citation.study_design)) ? c.citation.study_design : undefined,
      extracted_by: `agent:curator:${model}`,
    }],
  });
  if (!res.ok) return { ok: false, errors: res.errors };
  return { ok: true, claimId: id, source: cite.source_id };
}

export interface CurateSummary {
  topic: string;
  proposed: number;
  created: number;
  merged: number;        // citations attached to an existing edge (de-dup)
  reused_nodes: number;
  skipped: { reason: string }[];
}

/** Run the curator for a single topic: propose → validate → de-dup → persist. */
export async function curateTopic(topic: string, opts: { model?: string; topicId?: string } = {}): Promise<CurateSummary> {
  const model = opts.model ?? envModelFor("curator");
  const sql = await getSql();
  const existing = (await sql.query("SELECT id, name, type, aliases FROM node ORDER BY name", [])) as { id: string; name: string; type: string; aliases?: string[] }[];
  const resolver = new NodeResolver(existing);

  const text = await complete(
    [{ role: "user", content: buildUserPrompt(topic, existing) }],
    // No adaptive thinking: extraction is fast and predictable without it, and
    // thinking was eating the budget / blowing the request timeout on big calls.
    { system: SYSTEM, maxTokens: 8000, model, thinking: false },
  );
  let candidates: Candidate[];
  try {
    const parsed = extractJson<unknown>(text);
    candidates = Array.isArray(parsed) ? parsed as Candidate[]
      : Array.isArray((parsed as { candidates?: unknown })?.candidates) ? (parsed as { candidates: Candidate[] }).candidates
      : Array.isArray((parsed as { claims?: unknown })?.claims) ? (parsed as { claims: Candidate[] }).claims
      : [];
  } catch (e) {
    const sample = (text ?? "").slice(0, 700);
    await logRun({ agent: "curator", topic_id: opts.topicId, outcome: "parse_error", summary: { error: (e as Error).message, model, sample } });
    return { topic, proposed: 0, created: 0, merged: 0, reused_nodes: 0, skipped: [{ reason: `model output not valid JSON: ${(e as Error).message} | sample: ${sample.slice(0, 300)}` }] };
  }

  const counters = { reused: 0 };
  const summary: CurateSummary = { topic, proposed: candidates.length, created: 0, merged: 0, reused_nodes: 0, skipped: [] };
  for (const c of candidates) {
    const errs = validateCandidate(c);
    if (errs.length) { summary.skipped.push({ reason: errs.join("; ") }); continue; }
    const r = await persistCandidate(c, model, resolver, counters);
    if (r.ok) {
      if (r.merged) summary.merged++; else summary.created++;
      await logRun({ agent: "curator", topic_id: opts.topicId, claim_id: r.claimId, outcome: r.merged ? "evidence_added" : "created", summary: { relationship: c.relationship, source: r.source, title: c.citation.title, merged: r.merged } });
    } else {
      summary.skipped.push({ reason: (r.errors ?? ["write failed"]).join("; ") });
    }
  }
  summary.reused_nodes = counters.reused;
  return summary;
}
