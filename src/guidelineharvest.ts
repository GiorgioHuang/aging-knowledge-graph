// Healthy Aging Knowledge — clinical-guideline data-source connector.
//
// A sibling of the PubMed connector (src/pubmedharvest.ts), but for the OTHER
// kind of authoritative source: practice guidelines from bodies like WHO, CDC,
// and Canadian geriatric societies. Those aren't indexed papers with a PMID —
// they're HTML/PDF documents issued by an ORGANIZATION, cited by their URL (or
// DOI). So the flow differs from PubMed in three ways:
//   1. the document text comes from a fetched HTML page OR pasted text (PDFs
//      can't be parsed zero-dep — paste their text), not an abstract API;
//   2. the source id is a URL/DOI CURIE we already hold, not a looked-up PMID;
//   3. claims are typically `recommends` (a body recommends an intervention for
//      a population), grounded in a VERBATIM quote from the guideline.
// Everything else reuses the curator's persist path (node de-dup, edge de-dup,
// evidence) via persistCandidate with a knownSource, and new claims are written
// `unverified` so the Reviewer still checks grounding.
import { getSql } from "./db.ts";
import { complete, extractJson } from "./llm.ts";
import { envModelFor } from "./models.ts";
import { logRun } from "./topics.ts";
import { loadGraph } from "./model.ts";
import { NodeResolver } from "./resolve.ts";
import { persistCandidate, validateCandidate, type Candidate } from "./curator.ts";
import { stripTags } from "./sources.ts";

const onto = loadGraph().ontology;

export interface GuidelineMeta {
  title: string;         // the guideline's title
  issuer?: string;       // issuing body, e.g. "WHO", "CDC", "Canadian Geriatrics Society"
  year?: string;
  source_id: string;     // CURIE: "URL:https://…" or "DOI:10.…"
}

const EXTRACT_SYSTEM = `You extract structured, evidence-grounded claims for a healthy-aging knowledge graph FROM ONE CLINICAL PRACTICE GUIDELINE's text.
Hard rules:
- Use ONLY what the guideline text explicitly states — no outside knowledge, no overstating. The object must be what the guideline actually addresses for the subject; the population must be the population it actually targets.
- Prefer the "recommends" relationship for a recommendation the guideline makes (an intervention/screening/action recommended for a population); use another relationship only when the text states a factual link (e.g. causes/increases_risk_of) rather than a recommendation.
- Every claim needs a SHORT VERBATIM quote from the guideline text that supports it.
- Scope: healthy aging / geriatrics (older adults, ~65+). If a recommendation is not about older adults, or the text states no clear recommendation/finding, skip it.
- Reuse an existing node id when a concept already exists (a list is provided); otherwise name a new node with a type from the vocabulary.
Output ONLY a JSON array (first character "[", last "]"), each item:
{"subject":{"id":"<existing id or omit>","name":"<concept>","type":"<node type>"},"object":{"id":"","name":"","type":""},"relationship":"<relationship type>","direction":"increase|decrease|no_effect|mixed (optional)","population":"<who (optional)>","certainty":"high|moderate|low|very_low (optional)","quote":"<verbatim sentence from the guideline>"}`;

interface RawClaim {
  subject?: { id?: string; name?: string; type?: string };
  object?: { id?: string; name?: string; type?: string };
  relationship?: string; direction?: string; population?: string; certainty?: string; quote?: string;
}

export function buildGuidelinePrompt(meta: GuidelineMeta, text: string, existingNodes: { id: string; name: string; type: string }[]): string {
  const vocab = [
    `node types: ${onto.nodeTypes.join(", ")}`,
    `relationship types: ${onto.relationshipTypes.join(", ")}`,
    `directions: ${onto.directions.join(", ")}`,
    `certainties: ${onto.certainties.join(", ")}`,
  ].join("\n");
  const nodes = existingNodes.slice(0, 200).map((n) => `${n.id} (${n.type}): ${n.name}`).join("\n");
  return `GUIDELINE
Title: ${meta.title}
Issuing body: ${meta.issuer ?? "(unspecified)"}
Year: ${meta.year ?? "(unspecified)"}
Text:
${(text ?? "").slice(0, 12000)}

Controlled vocabulary:
${vocab}

Existing nodes (reuse these ids where a concept already exists):
${nodes || "(none yet)"}

Extract up to 8 recommendation/finding claims that THIS GUIDELINE TEXT directly supports. Respond with ONLY a raw JSON array (no prose, no code fences).`;
}

/** Turn one guideline's text into curator Candidates. The citation carries the
 *  guideline's own metadata (title, issuer as author, year) so persistCandidate
 *  has a valid citation + the supporting quote; the real source id (URL/DOI) is
 *  passed separately as a knownSource. */
export async function extractFromGuideline(meta: GuidelineMeta, text: string, existing: { id: string; name: string; type: string }[], model: string): Promise<Candidate[]> {
  let raw: RawClaim[];
  try {
    const out = await complete([{ role: "user", content: buildGuidelinePrompt(meta, text, existing) }], { system: EXTRACT_SYSTEM, maxTokens: 4000, model, thinking: false });
    const parsed = extractJson<unknown>(out);
    raw = Array.isArray(parsed) ? parsed as RawClaim[] : Array.isArray((parsed as { claims?: unknown })?.claims) ? (parsed as { claims: RawClaim[] }).claims : [];
  } catch { return []; }
  return raw.map((r) => ({
    subject: { id: r.subject?.id, name: String(r.subject?.name ?? ""), type: String(r.subject?.type ?? "") },
    object: { id: r.object?.id, name: String(r.object?.name ?? ""), type: String(r.object?.type ?? "") },
    relationship: String(r.relationship ?? ""),
    direction: r.direction,
    population: r.population,
    certainty: r.certainty,
    // The guideline's issuing body is the "author"; study design is "guideline".
    citation: { title: meta.title, first_author: meta.issuer, year: meta.year, journal: meta.issuer, quote: r.quote, study_design: "guideline" },
  }));
}

/** Fetch an HTML guideline page and reduce it to readable text. Best-effort:
 *  returns "" on any failure (the caller then reports "no usable text"). */
async function fetchGuidelineText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.ca)" } });
    if (!res.ok) return "";
    const html = await res.text();
    // Drop scripts/styles wholesale, then strip remaining tags to plain text.
    const cleaned = html.replace(/<(script|style|noscript|head)[\s\S]*?<\/\1>/gi, " ");
    return stripTags(cleaned).slice(0, 40000);
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize a URL / DOI into a CURIE source id the writer accepts. */
export function guidelineSourceId({ url, doi }: { url?: string; doi?: string }): string | undefined {
  const d = (doi ?? "").trim();
  if (d) return /^DOI:/i.test(d) ? d : `DOI:${d.replace(/^doi:/i, "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}`;
  const u = (url ?? "").trim();
  if (u) return /^URL:/i.test(u) ? u : (/^https?:\/\//i.test(u) ? `URL:${u}` : undefined);
  return undefined;
}

export interface GuidelineHarvestSummary {
  title: string;
  source_id: string;
  chars: number;       // guideline characters fed to the extractor
  proposed: number;    // claims the model extracted
  created: number;     // new claims written
  merged: number;      // evidence added to an existing claim
  reused_nodes: number;
  skipped: Array<{ reason: string }>;
  claims: Array<{ claimId: string; merged: boolean }>;
}

/** Harvest one clinical guideline into grounded claims. Provide the document via
 *  `text` (paste — required for PDFs) OR `url` (an HTML page we fetch + strip);
 *  the source id is the DOI (preferred) or the URL as a CURIE. New claims are
 *  `unverified` → Reviewer gate. */
export async function harvestGuideline(
  { title, issuer, year, url, doi, text, model }:
  { title: string; issuer?: string; year?: string; url?: string; doi?: string; text?: string; model?: string },
): Promise<GuidelineHarvestSummary> {
  const t = String(title ?? "").trim();
  if (!t) throw new Error("title is required");
  const source_id = guidelineSourceId({ url, doi });
  if (!source_id) throw new Error("a source is required: pass a doi or an http(s) url");

  let body = String(text ?? "").trim();
  if (!body && url) body = await fetchGuidelineText(String(url).trim());
  if (!body || body.length < 200) throw new Error("no usable guideline text (paste the text, or give a fetchable HTML url)");

  const useModel = model ?? envModelFor("curator");
  const sql = await getSql();
  const existing = (await sql.query("SELECT id, name, type, aliases FROM node ORDER BY name", [])) as { id: string; name: string; type: string; aliases?: string[] }[];
  const resolver = new NodeResolver(existing);

  const meta: GuidelineMeta = { title: t, issuer: issuer?.trim() || undefined, year: year?.trim() || undefined, source_id };
  const summary: GuidelineHarvestSummary = { title: t, source_id, chars: body.length, proposed: 0, created: 0, merged: 0, reused_nodes: 0, skipped: [], claims: [] };
  const counters = { reused: 0 };

  const cands = await extractFromGuideline(meta, body, existing, useModel);
  summary.proposed = cands.length;
  for (const c of cands) {
    const errs = validateCandidate(c);
    if (errs.length) { summary.skipped.push({ reason: errs.join("; ") }); continue; }
    const r = await persistCandidate(c, useModel, resolver, counters, { source_id });
    if (r.ok) {
      if (r.merged) summary.merged++; else summary.created++;
      summary.claims.push({ claimId: r.claimId!, merged: Boolean(r.merged) });
      await logRun({ agent: "curator", claim_id: r.claimId, outcome: r.merged ? "evidence_added" : "created", summary: { source: source_id, relationship: c.relationship, guideline: t } });
    } else {
      summary.skipped.push({ reason: (r.errors ?? ["write failed"]).join("; ") });
    }
  }
  summary.reused_nodes = counters.reused;
  summary.skipped = summary.skipped.slice(0, 25);
  return summary;
}
