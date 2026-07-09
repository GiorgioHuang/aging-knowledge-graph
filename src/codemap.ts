// Healthy Aging Knowledge — standards vocabulary mapping.
//
// Attaches authoritative CURIEs (MONDO/HP/GO/ChEBI/FoodOn/MeSH) to nodes by
// resolving each node's NAME against open ontology services — never trusting an
// LLM for an identifier (same anti-hallucination rule as citation resolution).
// A code is accepted ONLY when the authority's own label/synonym matches the
// node's name or an alias. Open-licence codes only (no SNOMED/ICD/ATC), per
// docs/10-standards-alignment.md. Network calls run in production, exactly like
// the PubMed citation resolver; the pure logic here is unit-tested offline.
import { getSql, isDbConfigured } from "./db.ts";
import { NCBI_KEY } from "./sources.ts";
import type { Node } from "./types.ts";

export interface Target { prefix: string; source: "ols" | "mesh"; ontology?: string }
export interface Candidate { curie: string; labels: string[] }

// Per docs/10-standards-alignment.md §3 — open primaries that are resolvable via
// a key-free API (EBI OLS4 for OBO ontologies; NLM E-utilities for MeSH).
const OLS = (prefix: string, ontology: string): Target => ({ prefix, source: "ols", ontology });
const MESH: Target = { prefix: "MESH", source: "mesh" };
export const TARGETS_BY_TYPE: Record<string, Target[]> = {
  disease: [OLS("MONDO", "mondo"), MESH],
  symptom: [OLS("HP", "hp"), MESH],
  outcome: [MESH],
  intervention: [MESH],
  exercise: [MESH],
  nutrition: [OLS("CHEBI", "chebi"), OLS("FOODON", "foodon"), MESH],
  drug: [OLS("CHEBI", "chebi"), MESH],
  mechanism: [OLS("GO", "go"), MESH],
  scale: [MESH],
  tool: [MESH],
  technology: [MESH],
  // population / research / paper / guideline / expert / organization: internal
  // ids or non-term identifiers (ROR/ORCID/DOI) — not auto-resolved here.
};
export const TYPES_WITH_TARGETS = Object.keys(TARGETS_BY_TYPE);

export function vocabulariesForType(type: string): Target[] {
  return TARGETS_BY_TYPE[type] ?? [];
}

/** Normalise a term for comparison: lowercase, non-alphanumerics → single space. */
export function normTerm(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Accept a candidate only if the authority's own label/synonym equals (after
 *  normalisation) the node's name or one of its aliases. High-precision on purpose. */
export function acceptCurie(nodeNames: string[], candidate: Candidate): boolean {
  const names = new Set(nodeNames.map(normTerm).filter(Boolean));
  return candidate.labels.some((l) => names.has(normTerm(l)));
}

/** Keep existing codes (curator-supplied included), append newly resolved ones,
 *  de-duplicated, existing-first. */
export function mergeCodes(existing: string[], added: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of [...existing, ...added]) {
    const k = c.trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** Resolvable authority URL for a CURIE (for the UI + external links). */
export function codeUrl(curie: string): string | null {
  const i = curie.indexOf(":");
  if (i < 0) return null;
  const prefix = curie.slice(0, i).toUpperCase();
  const id = curie.slice(i + 1);
  if (!id) return null;
  if (prefix === "MESH") return `https://meshb.nlm.nih.gov/record/ui?ui=${encodeURIComponent(id)}`;
  if (["MONDO", "HP", "GO", "CHEBI", "FOODON", "MAXO", "BCIO"].includes(prefix)) return `http://purl.obolibrary.org/obo/${prefix}_${id}`;
  if (prefix === "DOI") return `https://doi.org/${id}`;
  if (prefix === "PMID") return `https://pubmed.ncbi.nlm.nih.gov/${id}/`;
  if (prefix === "PMCID") return `https://www.ncbi.nlm.nih.gov/pmc/articles/${id}/`;
  if (prefix === "ROR") return `https://ror.org/${id}`;
  if (prefix === "ORCID") return `https://orcid.org/${id}`;
  if (prefix === "RXNORM") return `https://mor.nlm.nih.gov/RxNav/search?searchBy=RXCUI&searchTerm=${encodeURIComponent(id)}`;
  if (prefix === "LOINC") return `https://loinc.org/${encodeURIComponent(id)}`;
  return null;
}

/** OLS4 search response → candidates (docs carrying an obo_id in the wanted vocab). */
export function parseOls(json: unknown, prefix: string): Candidate[] {
  const docs = (json as { response?: { docs?: Array<Record<string, unknown>> } })?.response?.docs ?? [];
  const out: Candidate[] = [];
  for (const d of docs) {
    const obo = d.obo_id as string | undefined;
    if (!obo || obo.split(":")[0].toUpperCase() !== prefix.toUpperCase()) continue;
    const syn = Array.isArray(d.synonym) ? (d.synonym as string[]) : [];
    out.push({ curie: obo, labels: [d.label as string, ...syn].filter(Boolean) });
  }
  return out;
}

/** NLM MeSH esummary response → candidates (MESH:Dxxxxxx + its descriptor terms). */
export function parseMeshSummary(json: unknown): Candidate[] {
  const result = (json as { result?: Record<string, unknown> })?.result;
  if (!result) return [];
  const uids = (result.uids as string[]) ?? [];
  const out: Candidate[] = [];
  for (const uid of uids) {
    const r = result[uid] as { ds_meshui?: string; ds_meshterms?: string[] } | undefined;
    if (r?.ds_meshui) out.push({ curie: `MESH:${r.ds_meshui}`, labels: Array.isArray(r.ds_meshterms) ? r.ds_meshterms : [] });
  }
  return out;
}

// ---- network (runs in production; not exercised by the offline test suite) ----
async function jget(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.ca)" } });
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) return null;
      return await res.json();
    } catch { /* retry */ } finally { clearTimeout(timer); }
  }
  return null;
}

async function olsSearch(term: string, ontology: string, prefix: string): Promise<Candidate[]> {
  const url = `https://www.ebi.ac.uk/ols4/api/search?q=${encodeURIComponent(term)}&ontology=${ontology}&exact=true&rows=5&fieldList=obo_id,label,synonym,ontology_name`;
  return parseOls(await jget(url), prefix);
}

async function meshSearch(term: string): Promise<Candidate[]> {
  const s = await jget(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=mesh&retmode=json&retmax=5&term=${encodeURIComponent(term)}${NCBI_KEY}`);
  const ids = (s as { esearchresult?: { idlist?: string[] } })?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  return parseMeshSummary(await jget(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=mesh&retmode=json&id=${ids.join(",")}${NCBI_KEY}`));
}

/** Resolve open CURIEs for one node. Skips vocabularies the node already has a
 *  code for. Returns the accepted additions and the merged external_ids. */
export async function resolveCodesForNode(node: Pick<Node, "type" | "name" | "aliases" | "external_ids">): Promise<{ added: string[]; all: string[] }> {
  const existing = node.external_ids ?? [];
  const havePrefix = new Set(existing.map((c) => c.split(":")[0].toUpperCase()));
  const names = [node.name, ...(node.aliases ?? [])].filter(Boolean);
  const added: string[] = [];
  for (const t of vocabulariesForType(node.type)) {
    if (havePrefix.has(t.prefix.toUpperCase())) continue;
    let cands: Candidate[] = [];
    try { cands = t.source === "ols" ? await olsSearch(node.name, t.ontology!, t.prefix) : await meshSearch(node.name); }
    catch { cands = []; }
    const hit = cands.find((c) => c.curie.split(":")[0].toUpperCase() === t.prefix.toUpperCase() && acceptCurie(names, c));
    if (hit) { added.push(hit.curie); havePrefix.add(t.prefix.toUpperCase()); }
  }
  return { added, all: mergeCodes(existing, added) };
}

export interface MapSummary {
  scanned: number;
  mapped: number;
  codesAdded: number;
  remaining: number;
  details: Array<{ id: string; name: string; added: string[] }>;
}

/** Batch-map nodes that haven't been checked yet (or all, when force). Persists
 *  accepted codes to external_ids and stamps codes_checked_at so each node is
 *  processed once. Bounded per call to respect API rate limits. */
export async function mapUnmappedNodes({ limit = 25, force = false }: { limit?: number; force?: boolean } = {}): Promise<MapSummary> {
  if (!isDbConfigured()) throw new Error("standards mapping requires a database (DATABASE_URL)");
  const sql = await getSql();
  await sql.query("ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_checked_at timestamptz");
  const rows = (await sql.query(
    `SELECT id, type, name, aliases, external_ids FROM node
      WHERE type = ANY($1) ${force ? "" : "AND codes_checked_at IS NULL"}
      ORDER BY updated_at DESC LIMIT $2`,
    [TYPES_WITH_TARGETS, Math.max(1, Math.min(200, limit))],
  )) as Array<{ id: string; type: string; name: string; aliases: string[] | null; external_ids: string[] | null }>;

  let mapped = 0, codesAdded = 0;
  const details: MapSummary["details"] = [];
  for (const r of rows) {
    const { added, all } = await resolveCodesForNode({ type: r.type, name: r.name, aliases: r.aliases ?? [], external_ids: r.external_ids ?? [] });
    if (added.length) {
      await sql.query("UPDATE node SET external_ids=$2, codes_checked_at=now(), updated_at=now() WHERE id=$1", [r.id, all]);
      mapped++; codesAdded += added.length; details.push({ id: r.id, name: r.name, added });
    } else {
      await sql.query("UPDATE node SET codes_checked_at=now() WHERE id=$1", [r.id]);
    }
  }
  const [{ remaining }] = (await sql.query(
    `SELECT count(*)::int AS remaining FROM node WHERE type = ANY($1) AND codes_checked_at IS NULL`,
    [TYPES_WITH_TARGETS],
  )) as Array<{ remaining: number }>;
  return { scanned: rows.length, mapped, codesAdded, remaining, details };
}
