// Healthy Aging Knowledge — citation verification (anti-hallucination gate).
// The reviewer does NOT trust the model to self-check: it actually resolves each
// cited PMID/DOI against PubMed (NCBI E-utilities) and Crossref. A citation that
// does not resolve is treated as fabricated, which sends the claim to human
// review (needs_refinement) rather than letting it be promoted to `curated`.

import { fetchPubmed } from "./import.ts";

export type CitationKind = "PMID" | "DOI" | "URL" | "OTHER";

export function citationKind(sourceId: string): CitationKind {
  if (/^PMID:/i.test(sourceId)) return "PMID";
  if (/^DOI:/i.test(sourceId)) return "DOI";
  if (/^URL:/i.test(sourceId) || /^https?:\/\//i.test(sourceId)) return "URL";
  return "OTHER";
}

/** Resolve a DOI via Crossref's lightweight /agency endpoint (200 ⇒ exists). */
export async function resolveDoi(doi: string): Promise<boolean> {
  const id = doi.replace(/^DOI:/i, "").trim();
  if (!id) return false;
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(id)}/agency`, {
      headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.ca)" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Resolve a PMID via PubMed esummary (reuses the importer's fetchPubmed). */
export async function resolvePmid(pmid: string): Promise<boolean> {
  const r = await fetchPubmed(pmid);
  return r.ok;
}

/** Resolve one citation by kind. URLs are accepted (can't be verified for
 *  truthfulness here); unknown/bare strings are rejected. */
export async function verifyCitation(sourceId: string): Promise<boolean> {
  switch (citationKind(sourceId)) {
    case "PMID": return resolvePmid(sourceId);
    case "DOI": return resolveDoi(sourceId);
    case "URL": return true;
    default: return false;
  }
}

export type Resolver = (sourceId: string) => Promise<boolean>;

export interface CitationCheck {
  source_id: string;
  kind: CitationKind;
  resolved: boolean;
}

/** Verify a list of citations. The resolver is injectable so the mapping logic
 *  can be tested without touching the network. */
export async function verifyAll(sourceIds: string[], resolve: Resolver = verifyCitation): Promise<CitationCheck[]> {
  const out: CitationCheck[] = [];
  for (const s of sourceIds) out.push({ source_id: s, kind: citationKind(s), resolved: await resolve(s) });
  return out;
}

/** True only if there is at least one citation and every one resolved. */
export function allResolved(checks: CitationCheck[]): boolean {
  return checks.length > 0 && checks.every((c) => c.resolved);
}
