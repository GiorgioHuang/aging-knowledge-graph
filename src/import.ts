// GraceAge Knowledge — bulk import (JSON batch or CSV) and a PubMed citation
// lookup helper. Reuses the validated single-record writers.

import { createNode, createClaim, createEvidence, type WriteResult } from "./writes.ts";
import { parseCsv, multi } from "./csv.ts";

export interface ImportSummary {
  created: number;
  failed: number;
  results: { kind: string; id: string; ok: boolean; errors?: string[] }[];
}

async function run(kind: string, items: Record<string, unknown>[], fn: (x: Record<string, unknown>) => Promise<WriteResult>, out: ImportSummary): Promise<void> {
  for (const it of items) {
    const r = await fn(it);
    if (r.ok) { out.created++; out.results.push({ kind, id: String(it.id ?? ""), ok: true }); }
    else { out.failed++; out.results.push({ kind, id: String(it.id ?? ""), ok: false, errors: r.errors }); }
  }
}

/** Import a JSON batch: { nodes?, claims?, evidence? }. Nodes first (FKs). */
export async function importBatch(batch: { nodes?: unknown[]; claims?: unknown[]; evidence?: unknown[] }): Promise<ImportSummary> {
  const out: ImportSummary = { created: 0, failed: 0, results: [] };
  await run("node", (batch.nodes ?? []) as Record<string, unknown>[], createNode, out);
  await run("claim", (batch.claims ?? []) as Record<string, unknown>[], createClaim, out);
  await run("evidence", (batch.evidence ?? []) as Record<string, unknown>[], createEvidence, out);
  return out;
}

/** CSV row -> node input. Columns: id,type,name,domains,external_ids,description */
function rowToNode(r: Record<string, string>): Record<string, unknown> {
  return { id: r.id, type: r.type, name: r.name, description: r.description || undefined,
    domains: multi(r.domains), external_ids: multi(r.external_ids) };
}
/** CSV row -> claim input. Columns: id,type,subject,object,population,direction,certainty,status,source_id,study_design,quote */
function rowToClaim(r: Record<string, string>): Record<string, unknown> {
  const evidence = r.source_id ? [{ source_id: r.source_id, study_design: r.study_design || undefined, quote: r.quote || undefined }] : [];
  return { id: r.id, type: r.type, subject: r.subject, object: r.object,
    population: r.population || undefined, direction: r.direction || undefined,
    certainty: r.certainty || undefined, status: r.status || "curated", evidence };
}

export async function importCsv(kind: "nodes" | "claims", text: string): Promise<ImportSummary> {
  const rows = parseCsv(text);
  if (kind === "nodes") return importBatch({ nodes: rows.map(rowToNode) });
  return importBatch({ claims: rows.map(rowToClaim) });
}

/** Look up citation metadata for a PMID via NCBI E-utilities (server-side fetch). */
export async function fetchPubmed(pmid: string): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const id = pmid.replace(/^PMID:/i, "").trim();
  if (!/^\d+$/.test(id)) return { ok: false, status: 400, error: "expected a numeric PMID (or PMID:<n>)" };
  try {
    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${id}`);
    if (!res.ok) return { ok: false, status: 502, error: `PubMed error ${res.status}` };
    const json = (await res.json()) as { result?: Record<string, any> };
    const r = json.result?.[id];
    if (!r || r.error) return { ok: false, status: 404, error: `PMID ${id} not found` };
    const doi = (r.articleids ?? []).find((a: { idtype: string }) => a.idtype === "doi")?.value;
    return { ok: true, data: {
      pmid: id,
      title: r.title,
      journal: r.fulljournalname ?? r.source,
      year: (r.pubdate ?? "").slice(0, 4),
      authors: (r.authors ?? []).map((a: { name: string }) => a.name),
      doi: doi ? `DOI:${doi}` : undefined,
      source_id: `PMID:${id}`,
    } };
  } catch (e) {
    return { ok: false, status: 502, error: (e as Error).message };
  }
}
