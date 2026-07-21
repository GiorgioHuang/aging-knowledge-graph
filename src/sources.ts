// Healthy Aging Knowledge — source metadata fetch + mapping.
// The Reviewer doesn't just check that a PMID/DOI EXISTS — it fetches the real
// title + abstract so the judge can decide whether the source actually SUPPORTS
// the claim, infers the study design from authoritative publication types, and
// lets each verified source become a first-class `paper` node in the graph.

import { citationKind } from "./cite.ts";
import { loadGraph } from "./model.ts";

const DESIGNS = new Set(loadGraph().ontology.studyDesigns);

export interface SourceMeta {
  source_id: string;
  exists: boolean;
  lookupFailed?: boolean; // the lookup itself errored (network/429) — existence UNKNOWN, not "absent"
  pmid?: string;
  doi?: string;          // CURIE form, e.g. "DOI:10.x/y"
  title?: string;
  journal?: string;
  year?: string;
  authors?: string[];
  abstract?: string;
  pubtypes?: string[];
  study_design?: string; // mapped to our enum when confident, else undefined
}

/** Optional NCBI API key raises the E-utilities rate limit (3→10 req/s). */
export const NCBI_KEY = process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : "";

/** fetch with an abort timeout AND retry on transient failure (429/5xx/network),
 *  so throttling/blips don't masquerade as "source doesn't exist". */
async function timedFetch(url: string, opts: RequestInit = {}, ms = 25000): Promise<Response> {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) { lastErr = `status ${res.status}`; continue; }
      return res;
    } catch (e) {
      lastErr = (e as Error).message || "fetch failed";
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr || "fetch failed");
}

/** Strip XML/HTML tags (Crossref abstracts are JATS) and collapse whitespace. */
export function stripTags(s: string): string {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Map PubMed publication types / Crossref type / title hints → our study_design
 *  enum. Returns undefined unless reasonably confident. */
export function mapStudyDesign(pubtypes: string[] = [], crossrefType?: string, title?: string): string | undefined {
  const pt = pubtypes.map((p) => p.toLowerCase());
  const has = (s: string) => pt.some((p) => p.includes(s));
  let d: string | undefined;
  if (has("meta-analysis") || has("systematic review")) d = "systematic_review_or_meta_analysis";
  else if (has("randomized controlled trial")) d = "rct";
  else if (has("case-control")) d = "case_control";
  else if (has("cross-sectional")) d = "cross_sectional";
  else if (has("cohort") || has("observational study")) d = "cohort";
  else if (has("case reports")) d = "case_report";
  else if (has("guideline")) d = "guideline";

  if (!d) {
    const t = (title ?? "").toLowerCase();
    if (/meta-analysis|systematic review/.test(t)) d = "systematic_review_or_meta_analysis";
    else if (/randomi[sz]ed|randomised controlled|\brct\b/.test(t)) d = "rct";
    else if (/case-control/.test(t)) d = "case_control";
    else if (/cross-sectional/.test(t)) d = "cross_sectional";
    else if (/cohort|longitudinal|prospective study/.test(t)) d = "cohort";
    else if (/\bguideline/.test(t)) d = "guideline";
  }
  if (!d && (crossrefType === "standard" || crossrefType === "guideline")) d = "guideline";
  return d && DESIGNS.has(d) ? d : undefined;
}

/** Build a `paper` node from fetched metadata (id derived from PMID/DOI). */
export function paperNode(meta: SourceMeta): { id: string; type: string; name: string; external_ids: string[]; description?: string } | undefined {
  if (!meta.exists || !meta.title) return undefined;
  const ext: string[] = [];
  if (meta.pmid) ext.push(`PMID:${meta.pmid}`);
  if (meta.doi) ext.push(meta.doi.toUpperCase().startsWith("DOI:") ? meta.doi : `DOI:${meta.doi}`);
  const id = meta.pmid ? `pmid:${meta.pmid}` : (meta.doi ? `doi:${meta.doi.replace(/^DOI:/i, "")}` : undefined);
  if (!id) return undefined;
  const desc = [meta.journal, meta.year, (meta.authors ?? []).slice(0, 3).join(", ")].filter(Boolean).join(" · ");
  return { id, type: "paper", name: meta.title.slice(0, 300), external_ids: ext, description: desc || undefined };
}

async function fetchPubmedAbstract(id: string): Promise<string | undefined> {
  try {
    const res = await timedFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${id}&rettype=abstract&retmode=text${NCBI_KEY}`);
    if (!res.ok) return undefined;
    const txt = (await res.text()).trim();
    return txt ? txt.slice(0, 4000) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchPubmedMeta(sourceId: string): Promise<SourceMeta> {
  const id = sourceId.replace(/^PMID:/i, "").trim();
  const base: SourceMeta = { source_id: `PMID:${id}`, pmid: id, exists: false };
  try {
    const res = await timedFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${id}${NCBI_KEY}`);
    if (!res.ok) { base.lookupFailed = true; return base; }
    const json = (await res.json()) as { result?: Record<string, any> };
    const r = json.result?.[id];
    if (!r || r.error) return base; // clean "not found" — existence is known (absent)
    base.exists = true;
    base.title = r.title;
    base.journal = r.fulljournalname ?? r.source;
    base.year = (r.pubdate ?? "").slice(0, 4);
    base.authors = (r.authors ?? []).map((a: { name: string }) => a.name);
    const doi = (r.articleids ?? []).find((a: { idtype: string }) => a.idtype === "doi")?.value;
    if (doi) base.doi = `DOI:${doi}`;
    base.pubtypes = r.pubtype ?? [];
    base.study_design = mapStudyDesign(base.pubtypes, undefined, base.title);
    base.abstract = await fetchPubmedAbstract(id);
    return base;
  } catch {
    base.lookupFailed = true; // network/throttle — existence unknown, don't treat as fake
    return base;
  }
}

async function fetchCrossrefMeta(sourceId: string): Promise<SourceMeta> {
  const id = sourceId.replace(/^DOI:/i, "").trim();
  const base: SourceMeta = { source_id: `DOI:${id}`, doi: `DOI:${id}`, exists: false };
  try {
    const res = await timedFetch(`https://api.crossref.org/works/${encodeURIComponent(id)}`, {
      headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.cc)" },
    });
    if (res.status === 404) return base;            // genuinely not found
    if (!res.ok) { base.lookupFailed = true; return base; }
    const m = ((await res.json()) as { message?: any }).message;
    if (!m) return base;
    base.exists = true;
    base.title = Array.isArray(m.title) ? m.title[0] : m.title;
    base.journal = Array.isArray(m["container-title"]) ? m["container-title"][0] : undefined;
    const yr = m.published?.["date-parts"]?.[0]?.[0] ?? m.issued?.["date-parts"]?.[0]?.[0];
    base.year = yr ? String(yr) : undefined;
    base.authors = (m.author ?? []).map((a: { given?: string; family?: string }) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean);
    base.abstract = m.abstract ? stripTags(m.abstract).slice(0, 4000) : undefined;
    base.study_design = mapStudyDesign([], m.type, base.title);
    return base;
  } catch {
    base.lookupFailed = true;
    return base;
  }
}

/** Fetch metadata for any citation. URLs are accepted but not enriched. */
export async function fetchSourceMeta(sourceId: string): Promise<SourceMeta> {
  switch (citationKind(sourceId)) {
    case "PMID": return fetchPubmedMeta(sourceId);
    case "DOI": return fetchCrossrefMeta(sourceId);
    case "URL": return { source_id: sourceId, exists: true };
    default: return { source_id: sourceId, exists: false };
  }
}

export type MetaFetcher = (sourceId: string) => Promise<SourceMeta>;

// ---- search (used to RESOLVE a citation from a description, so the model never
//      supplies the identifier itself — see src/citeresolve.ts) ----

/** PubMed esearch: relevance-ranked PMIDs for a free-text term. */
export async function pubmedSearch(term: string, retmax = 5): Promise<string[]> {
  try {
    const res = await timedFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&term=${encodeURIComponent(term)}${NCBI_KEY}`);
    if (!res.ok) return [];
    const j = (await res.json()) as { esearchresult?: { idlist?: string[] } };
    return j.esearchresult?.idlist ?? [];
  } catch {
    return [];
  }
}

/** PubMed esummary (lean): {pmid,title,pubtypes} for a set of PMIDs. pubtypes let
 *  the resolver skip errata/corrections (which have no abstract). */
export async function pubmedTitles(pmids: string[]): Promise<{ pmid: string; title: string; pubtypes: string[] }[]> {
  if (!pmids.length) return [];
  try {
    const res = await timedFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}${NCBI_KEY}`);
    if (!res.ok) return [];
    const j = (await res.json()) as { result?: Record<string, { title?: string; pubtype?: string[] }> };
    const r = j.result;
    if (!r) return [];
    return pmids.map((id) => ({ pmid: id, title: r[id]?.title ?? "", pubtypes: r[id]?.pubtype ?? [] })).filter((x) => x.title);
  } catch {
    return [];
  }
}

/** Crossref bibliographic search: {doi (CURIE), title, type} candidates. `type`
 *  (e.g. journal-article, peer-review, component) lets the resolver skip
 *  non-article artifacts whose title mirrors the article they attach to. */
export async function crossrefSearch(query: string, rows = 5): Promise<{ doi: string; title: string; type?: string }[]> {
  try {
    const res = await timedFetch(`https://api.crossref.org/works?rows=${rows}&select=DOI,title,type&query.bibliographic=${encodeURIComponent(query)}`, {
      headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.cc)" },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { message?: { items?: { DOI?: string; title?: string[]; type?: string }[] } };
    return (j.message?.items ?? [])
      .map((it) => ({ doi: it.DOI ? `DOI:${it.DOI}` : "", title: Array.isArray(it.title) ? it.title[0] : "", type: it.type }))
      .filter((x) => x.doi && x.title);
  } catch {
    return [];
  }
}
