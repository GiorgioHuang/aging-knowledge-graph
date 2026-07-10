// Healthy Aging Knowledge — PubMed data-source connector.
//
// Inverts the curator's flow: instead of the model proposing which papers to
// cite for a topic (then resolving the id), we START from REAL papers — search
// PubMed, fetch each abstract, and extract claims GROUNDED IN THAT ABSTRACT.
// The source is real by construction (a harvested PMID), the supporting quote
// comes from the abstract, and claims are written `unverified` so the Reviewer
// still checks grounding. Reuses the curator's persist path (nodes, de-dup,
// evidence) via persistCandidate with a knownSource.
import { getSql } from "./db.ts";
import { complete, extractJson } from "./llm.ts";
import { envModelFor } from "./models.ts";
import { logRun } from "./topics.ts";
import { loadGraph } from "./model.ts";
import { NodeResolver } from "./resolve.ts";
import { persistCandidate, validateCandidate, type Candidate } from "./curator.ts";
import { pubmedSearch, pubmedTitles, fetchSourceMeta, type SourceMeta } from "./sources.ts";

const onto = loadGraph().ontology;

const EXTRACT_SYSTEM = `You extract structured, evidence-grounded claims for a healthy-aging knowledge graph FROM ONE PAPER's abstract.
Hard rules:
- Use ONLY what the abstract explicitly reports — no outside knowledge, no overstating. The object must be the outcome the paper actually measured for the subject; the population must be the population it actually studied.
- Every claim needs a SHORT VERBATIM quote from the abstract that supports it.
- Scope: healthy aging / geriatrics (older adults, ~65+). If the paper is out of scope, or the abstract reports no clear directional finding, return an empty array.
- Reuse an existing node id when a concept already exists (a list is provided); otherwise name a new node with a type from the vocabulary.
Output ONLY a JSON array (first character "[", last "]"), each item:
{"subject":{"id":"<existing id or omit>","name":"<concept>","type":"<node type>"},"object":{"id":"","name":"","type":""},"relationship":"<relationship type>","direction":"increase|decrease|no_effect|mixed (optional)","population":"<who (optional)>","certainty":"high|moderate|low|very_low (optional)","quote":"<verbatim sentence from the abstract>"}`;

interface RawClaim {
  subject?: { id?: string; name?: string; type?: string };
  object?: { id?: string; name?: string; type?: string };
  relationship?: string; direction?: string; population?: string; certainty?: string; quote?: string;
}

export function buildExtractPrompt(meta: SourceMeta, existingNodes: { id: string; name: string; type: string }[]): string {
  const vocab = [
    `node types: ${onto.nodeTypes.join(", ")}`,
    `relationship types: ${onto.relationshipTypes.join(", ")}`,
    `directions: ${onto.directions.join(", ")}`,
    `certainties: ${onto.certainties.join(", ")}`,
  ].join("\n");
  const nodes = existingNodes.slice(0, 200).map((n) => `${n.id} (${n.type}): ${n.name}`).join("\n");
  return `PAPER
Title: ${meta.title ?? ""}
Journal / Year: ${meta.journal ?? ""} ${meta.year ?? ""}
Study design: ${meta.study_design ?? "unspecified"}
Abstract:
${(meta.abstract ?? "").slice(0, 6000)}

Controlled vocabulary:
${vocab}

Existing nodes (reuse these ids where a concept already exists):
${nodes || "(none yet)"}

Extract up to 6 claims that THIS ABSTRACT directly supports. Respond with ONLY a raw JSON array (no prose, no code fences).`;
}

/** Turn one abstract into curator Candidates whose citation is the REAL paper's
 *  metadata (so persistCandidate has a valid citation + the abstract quote). */
export async function extractFromAbstract(meta: SourceMeta, existing: { id: string; name: string; type: string }[], model: string): Promise<Candidate[]> {
  let raw: RawClaim[];
  try {
    const text = await complete([{ role: "user", content: buildExtractPrompt(meta, existing) }], { system: EXTRACT_SYSTEM, maxTokens: 4000, model, thinking: false });
    const parsed = extractJson<unknown>(text);
    raw = Array.isArray(parsed) ? parsed as RawClaim[] : Array.isArray((parsed as { claims?: unknown })?.claims) ? (parsed as { claims: RawClaim[] }).claims : [];
  } catch { return []; }
  const firstAuthor = (meta.authors?.[0] ?? "").trim().split(/\s+/).pop();
  return raw.map((r) => ({
    subject: { id: r.subject?.id, name: String(r.subject?.name ?? ""), type: String(r.subject?.type ?? "") },
    object: { id: r.object?.id, name: String(r.object?.name ?? ""), type: String(r.object?.type ?? "") },
    relationship: String(r.relationship ?? ""),
    direction: r.direction,
    population: r.population,
    certainty: r.certainty,
    citation: { title: meta.title ?? "", first_author: firstAuthor, year: meta.year, journal: meta.journal, quote: r.quote, study_design: meta.study_design },
  }));
}

export interface HarvestSummary {
  query: string;
  papers: number;      // abstracts processed
  proposed: number;    // claims the model extracted
  created: number;     // new claims written
  merged: number;      // evidence added to an existing claim
  reused_nodes: number;
  skipped: Array<{ pmid?: string; reason: string }>;
  claims: Array<{ pmid: string; claimId: string; merged: boolean }>;
}

/** Harvest recent PubMed papers for a query and extract grounded claims from
 *  their abstracts. Prefers systematic reviews / meta-analyses / RCTs. Bounded
 *  by `retmax` papers per call. New claims are `unverified` → Reviewer gate. */
export async function harvestPubmed({ query, retmax = 5, model }: { query: string; retmax?: number; model?: string }): Promise<HarvestSummary> {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("query is required");
  const useModel = model ?? envModelFor("curator");
  const sql = await getSql();
  const existing = (await sql.query("SELECT id, name, type, aliases FROM node ORDER BY name", [])) as { id: string; name: string; type: string; aliases?: string[] }[];
  const resolver = new NodeResolver(existing);

  const n = Math.max(1, Math.min(15, retmax));
  // Bias toward high-quality evidence in older adults.
  const pmids = await pubmedSearch(`(${q}) AND (aged[MeSH] OR older adults) AND (systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt] OR review[pt])`, n * 2);
  const titles = pmids.length ? await pubmedTitles(pmids) : [];
  const good = /review|meta-analysis|randomized/i;
  const ranked = titles.sort((a, b) => Number(b.pubtypes.some((p) => good.test(p))) - Number(a.pubtypes.some((p) => good.test(p)))).map((t) => t.pmid);
  const chosen = (ranked.length ? ranked : pmids).slice(0, n);

  const summary: HarvestSummary = { query: q, papers: 0, proposed: 0, created: 0, merged: 0, reused_nodes: 0, skipped: [], claims: [] };
  const counters = { reused: 0 };
  for (const pmid of chosen) {
    const meta = await fetchSourceMeta(`PMID:${pmid}`);
    if (!meta.exists || !meta.abstract || meta.abstract.length < 120) { summary.skipped.push({ pmid, reason: "no usable abstract" }); continue; }
    summary.papers++;
    const cands = await extractFromAbstract(meta, existing, useModel);
    summary.proposed += cands.length;
    for (const c of cands) {
      const errs = validateCandidate(c);
      if (errs.length) { summary.skipped.push({ pmid, reason: errs.join("; ") }); continue; }
      const r = await persistCandidate(c, useModel, resolver, counters, { source_id: `PMID:${pmid}` });
      if (r.ok) {
        if (r.merged) summary.merged++; else summary.created++;
        summary.claims.push({ pmid, claimId: r.claimId!, merged: Boolean(r.merged) });
        await logRun({ agent: "curator", claim_id: r.claimId, outcome: r.merged ? "evidence_added" : "created", summary: { source: `PMID:${pmid}`, relationship: c.relationship, harvest: q } });
      } else {
        summary.skipped.push({ pmid, reason: (r.errors ?? ["write failed"]).join("; ") });
      }
    }
  }
  summary.reused_nodes = counters.reused;
  summary.skipped = summary.skipped.slice(0, 25);
  return summary;
}
