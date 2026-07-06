// Healthy Aging Knowledge — citation resolution by description.
// LLMs hallucinate identifiers: they recall a real paper's title/finding but
// attach a PMID/DOI that points to an unrelated paper (and that wrong id still
// "resolves"). So we never trust a model-supplied identifier. The curator
// describes the paper (title + author + year); this module finds the REAL
// PMID/DOI by searching PubMed/Crossref and confirming the returned title
// matches the proposed one. No confident match → no citation (the claim is
// dropped rather than attached to a fabricated id).

import { tokenSet, jaccard } from "./resolve.ts";
import { pubmedSearch, pubmedTitles, crossrefSearch } from "./sources.ts";

export interface CiteDesc { title: string; first_author?: string; year?: string; journal?: string }
export interface ResolvedCite { source_id: string; matchedTitle: string; score: number; via: "pubmed" | "crossref" }

/** Similarity between two titles: max of token-set Jaccard and overlap
 *  coefficient (the latter tolerates subtitle/length differences). Pure. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokenSet(a), tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const j = jaccard(ta, tb);
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  const overlap = inter / Math.min(ta.size, tb.size);
  return Math.max(j, overlap * 0.95); // discount pure-overlap slightly
}

export const TITLE_THRESHOLD = 0.6;

/** Errata / corrections / retractions carry the article's title but have no
 *  abstract, so they're useless as a citation — skip them during resolution. */
export function isErratum(title: string | undefined, pubtypes: string[] = []): boolean {
  if (pubtypes.some((p) => /erratum|correction|retraction/i.test(p))) return true;
  return /^(erratum|correction|author correction|retraction)\b/i.test((title ?? "").trim());
}

/** Crossref indexes peer-review reports as their own DOI records (type
 *  "peer-review", DOI like `10.1111/jan.15084/v3/review1`) whose title mirrors
 *  the article they review — so a title match happily attaches the review's DOI
 *  instead of the paper's. These have no usable abstract; skip them (and other
 *  non-article components/grants/datasets) so we resolve to the real article. */
export function isNonArticleArtifact(doi: string | undefined, type?: string): boolean {
  if (type && /^(peer-review|component|grant|dataset|other)$/i.test(type)) return true;
  return /\/(v\d+\/)?review\d*$/i.test((doi ?? "").replace(/^DOI:/i, "").trim());
}

/** Best candidate whose title matches `proposed` at/above threshold. Pure. */
export function bestTitleMatch(
  proposed: string,
  candidates: { id: string; title: string }[],
  threshold = TITLE_THRESHOLD,
): { id: string; title: string; score: number } | undefined {
  let best: { id: string; title: string; score: number } | undefined;
  for (const c of candidates) {
    const score = Number(titleSimilarity(proposed, c.title).toFixed(4));
    if (score >= threshold && (!best || score > best.score)) best = { id: c.id, title: c.title, score };
  }
  return best;
}

export interface ResolveDeps {
  pubmedSearch: typeof pubmedSearch;
  pubmedTitles: typeof pubmedTitles;
  crossrefSearch: typeof crossrefSearch;
}
const defaultDeps: ResolveDeps = { pubmedSearch, pubmedTitles, crossrefSearch };

/** Resolve a described paper to a real PMID (preferred) or DOI, confirmed by
 *  title match. Returns undefined if nothing matches confidently. Deps are
 *  injectable so the matching logic is testable without the network. */
export async function resolveCitation(desc: CiteDesc, deps: ResolveDeps = defaultDeps): Promise<ResolvedCite | undefined> {
  const title = (desc.title ?? "").trim();
  if (tokenSet(title).size < 2) return undefined; // too generic to match safely
  const term = [title, desc.first_author, desc.year].filter(Boolean).join(" ");

  const pmids = await deps.pubmedSearch(term, 5);
  if (pmids.length) {
    const titles = (await deps.pubmedTitles(pmids)).filter((t) => !isErratum(t.title, t.pubtypes));
    const m = bestTitleMatch(title, titles.map((t) => ({ id: t.pmid, title: t.title })));
    if (m) return { source_id: `PMID:${m.id}`, matchedTitle: m.title, score: m.score, via: "pubmed" };
  }

  const cr = (await deps.crossrefSearch(term, 5)).filter((c) => !isErratum(c.title) && !isNonArticleArtifact(c.doi, c.type));
  if (cr.length) {
    const m = bestTitleMatch(title, cr.map((c) => ({ id: c.doi, title: c.title })));
    if (m) return { source_id: m.id, matchedTitle: m.title, score: m.score, via: "crossref" };
  }
  return undefined;
}
