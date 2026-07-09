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
import { complete, isLlmConfigured, extractJson } from "./llm.ts";
import type { Node } from "./types.ts";

// A small, fast model is plenty for "pick the matching term from this list".
const DISAMBIG_MODEL = process.env.CODEMAP_MODEL || "claude-haiku-4-5";
const DISAMBIG_SYSTEM = `You map a healthy-aging knowledge-graph node to a controlled-vocabulary term.
Given a node and a NUMBERED list of REAL candidate terms from an authority, choose the ONE candidate that denotes the SAME concept as the node (a synonym, or the node's exact concept — not merely related or broader/narrower).
If none is clearly the same concept, choose -1. Never invent a term. Prefer precision: when unsure, return -1.
Respond with JSON only: {"choice": <index or -1>}.`;

type DisambigNode = { name: string; type: string; aliases?: string[]; description?: string };
export function buildDisambigPrompt(node: DisambigNode, candidates: Candidate[]): string {
  const list = candidates.map((c, i) =>
    `${i}. ${c.curie} — ${c.labels.slice(0, 4).join(" / ")}${c.def ? " — " + String(c.def).slice(0, 240) : ""}`).join("\n");
  return `Node:
- name: ${node.name}
- type: ${node.type}${node.aliases?.length ? `\n- aliases: ${node.aliases.join(", ")}` : ""}${node.description ? `\n- description: ${node.description}` : ""}

Candidates:
${list}

Which candidate denotes the SAME concept as the node? Reply JSON only: {"choice": <index or -1>}.`;
}

/** Parse the model's {"choice": n} into a candidate CURIE (null if -1 / invalid). */
export function parseDisambigChoice(text: string, candidates: Candidate[]): string | null {
  let obj: { choice?: unknown };
  try { obj = extractJson(text); } catch { return null; }
  const n = typeof obj.choice === "number" ? obj.choice : Number(obj.choice);
  if (!Number.isInteger(n) || n < 0 || n >= candidates.length) return null;
  return candidates[n].curie;
}

async function pickWithLlm(node: DisambigNode, candidates: Candidate[]): Promise<string | null> {
  try {
    const text = await complete([{ role: "user", content: buildDisambigPrompt(node, candidates) }],
      { system: DISAMBIG_SYSTEM, maxTokens: 120, thinking: false, model: DISAMBIG_MODEL });
    return parseDisambigChoice(text, candidates);
  } catch { return null; }
}

export interface Target { prefix: string; source: "ols" | "mesh" | "rxnorm" | "ror" | "orcid"; ontology?: string }
export interface Candidate { curie: string; labels: string[]; def?: string }

// Per docs/10-standards-alignment.md §3 — open primaries that are resolvable via
// a key-free API (EBI OLS4 for OBO ontologies; NLM E-utilities for MeSH; NLM
// RxNav for RxNorm; ROR API for organisations; ORCID public API for experts).
const OLS = (prefix: string, ontology: string): Target => ({ prefix, source: "ols", ontology });
const MESH: Target = { prefix: "MESH", source: "mesh" };
const RXNORM: Target = { prefix: "RXNORM", source: "rxnorm" };
const ROR: Target = { prefix: "ROR", source: "ror" };
const ORCID: Target = { prefix: "ORCID", source: "orcid" };
export const TARGETS_BY_TYPE: Record<string, Target[]> = {
  disease: [OLS("MONDO", "mondo"), MESH],
  symptom: [OLS("HP", "hp"), MESH],
  outcome: [MESH],
  intervention: [MESH],
  exercise: [MESH],
  nutrition: [OLS("CHEBI", "chebi"), OLS("FOODON", "foodon"), MESH],
  drug: [RXNORM, OLS("CHEBI", "chebi"), MESH],
  mechanism: [OLS("GO", "go"), MESH],
  scale: [MESH],
  tool: [MESH],
  technology: [MESH],
  organization: [ROR],
  expert: [ORCID],
  // population / research / paper / guideline: internal ids or already-carried
  // identifiers (DOI/PMID) — not auto-resolved here.
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
 *  normalisation) one of the node's name variants. High-precision on purpose. */
export function acceptCurie(nodeNames: string[], candidate: Candidate): boolean {
  const names = new Set(nodeNames.map(normTerm).filter(Boolean));
  return candidate.labels.some((l) => names.has(normTerm(l)));
}

/** Drop parenthetical glosses: "Exercise (physical activity)" → "Exercise". */
export function deParen(s: string): string {
  return String(s || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
}
/** The contents of each parenthetical: "Fall rate (accidental falls)" → ["accidental falls"]. */
export function parenParts(s: string): string[] {
  return [...String(s || "").matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim()).filter(Boolean);
}
function uniqByNorm(terms: string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const t of terms) { const s = (t || "").trim(), k = normTerm(s); if (s && k && !seen.has(k)) { seen.add(k); out.push(s); } }
  return out;
}
/** All strings a candidate label may match against — the full name, its
 *  de-parenthesised form, each parenthetical gloss, and every alias. Node names
 *  here are descriptive ("Term (gloss)"), so exact-only matching misses most. */
export function nameVariants(name: string, aliases: string[] = []): string[] {
  return uniqByNorm([name, deParen(name), ...parenParts(name), ...aliases]);
}
/** Terms to query the authorities with (bounded) — cleaned name first (best hit
 *  rate), then the raw name, then the first alias. */
export function searchTerms(name: string, aliases: string[] = []): string[] {
  return uniqByNorm([deParen(name) || name, name, ...(aliases ?? []).slice(0, 1)]).slice(0, 3);
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
    const desc = Array.isArray(d.description) ? (d.description as string[])[0] : (typeof d.description === "string" ? d.description : undefined);
    out.push({ curie: obo, labels: [d.label as string, ...syn].filter(Boolean), def: desc });
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
    const r = result[uid] as { ds_meshui?: string; ds_meshterms?: string[]; ds_scopenote?: string } | undefined;
    if (r?.ds_meshui) out.push({ curie: `MESH:${r.ds_meshui}`, labels: Array.isArray(r.ds_meshterms) ? r.ds_meshterms : [], def: r.ds_scopenote });
  }
  return out;
}

/** RxNav exact-name response → RXNORM candidates. The exact `name=` endpoint
 *  returns a CUI only for an exact name match, so the match is already verified;
 *  we carry the queried term as the label so acceptCurie confirms it. */
export function parseRxnorm(json: unknown, term: string): Candidate[] {
  const ids = (json as { idGroup?: { rxnormId?: string[] } })?.idGroup?.rxnormId ?? [];
  return ids.map((id) => ({ curie: `RXNORM:${id}`, labels: [term] }));
}

/** ROR API response → ROR candidates (id URL → local id; name + aliases/acronyms as labels). */
export function parseRor(json: unknown): Candidate[] {
  const items = (json as { items?: Array<Record<string, unknown>> })?.items ?? [];
  return items.slice(0, 5).map((it) => ({
    curie: `ROR:${String(it.id ?? "").replace(/^https?:\/\/ror\.org\//, "")}`,
    labels: [it.name as string, ...((it.aliases as string[]) ?? []), ...((it.acronyms as string[]) ?? [])].filter(Boolean),
  })).filter((c) => c.curie !== "ROR:");
}

/** ORCID expanded-search → a candidate ONLY when exactly one record's full name
 *  matches the query (person-name collisions make anything looser unsafe). */
export function parseOrcid(json: unknown, term: string): Candidate[] {
  const rows = (json as { "expanded-result"?: Array<Record<string, unknown>> | null })?.["expanded-result"] ?? [];
  const want = normTerm(term);
  const fullName = (r: Record<string, unknown>) => `${(r["given-names"] as string) ?? ""} ${(r["family-names"] as string) ?? ""}`.trim();
  const exact = (rows ?? []).filter((r) => normTerm(fullName(r)) === want && r["orcid-id"]);
  if (exact.length !== 1) return [];
  return [{ curie: `ORCID:${exact[0]["orcid-id"]}`, labels: [fullName(exact[0])] }];
}

// ---- network (runs in production; not exercised by the offline test suite) ----
async function jget(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.ca)", accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) continue;
      if (!res.ok) return null;
      return await res.json();
    } catch { /* retry */ } finally { clearTimeout(timer); }
  }
  return null;
}

async function olsSearch(term: string, ontology: string, prefix: string): Promise<Candidate[]> {
  // Ranked (not exact): an exact label still ranks first (cheap-accepted by
  // acceptCurie), and the rest become candidates for LLM disambiguation.
  const url = `https://www.ebi.ac.uk/ols4/api/search?q=${encodeURIComponent(term)}&ontology=${ontology}&rows=6&fieldList=obo_id,label,synonym,description,ontology_name`;
  return parseOls(await jget(url), prefix);
}

async function meshSearch(term: string): Promise<Candidate[]> {
  const s = await jget(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=mesh&retmode=json&retmax=5&term=${encodeURIComponent(term)}${NCBI_KEY}`);
  const ids = (s as { esearchresult?: { idlist?: string[] } })?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  return parseMeshSummary(await jget(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=mesh&retmode=json&id=${ids.join(",")}${NCBI_KEY}`));
}

async function rxnormSearch(term: string): Promise<Candidate[]> {
  return parseRxnorm(await jget(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(term)}`), term);
}

async function rorSearch(term: string): Promise<Candidate[]> {
  return parseRor(await jget(`https://api.ror.org/organizations?query=${encodeURIComponent(term)}`));
}

async function orcidSearch(term: string): Promise<Candidate[]> {
  return parseOrcid(await jget(`https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(term)}&rows=10`), term);
}

async function runSearch(t: Target, term: string): Promise<Candidate[]> {
  try {
    return t.source === "ols" ? await olsSearch(term, t.ontology!, t.prefix)
      : t.source === "mesh" ? await meshSearch(term)
      : t.source === "rxnorm" ? await rxnormSearch(term)
      : t.source === "ror" ? await rorSearch(term)
      : await orcidSearch(term);
  } catch { return []; }
}

/** Resolve open CURIEs for one node. Skips vocabularies the node already has a
 *  code for. First tries a verified exact label match (cheap, no LLM); if none
 *  and `llm` is on, a small model picks the best of the REAL candidates the
 *  authority returned (it can only choose from those — no invented ids). */
export async function resolveCodesForNode(
  node: Pick<Node, "type" | "name" | "aliases" | "external_ids" | "description">,
  opts: { llm?: boolean } = {},
): Promise<{ added: string[]; all: string[] }> {
  const existing = node.external_ids ?? [];
  const havePrefix = new Set(existing.map((c) => c.split(":")[0].toUpperCase()));
  const variants = nameVariants(node.name, node.aliases ?? []);
  const queries = searchTerms(node.name, node.aliases ?? []);
  const added: string[] = [];
  for (const t of vocabulariesForType(node.type)) {
    if (havePrefix.has(t.prefix.toUpperCase())) continue;
    const cands: Candidate[] = [];
    const seen = new Set<string>();
    let exact: Candidate | undefined;
    for (const term of queries) {
      for (const c of await runSearch(t, term)) {
        if (c.curie.split(":")[0].toUpperCase() !== t.prefix.toUpperCase()) continue;
        if (!seen.has(c.curie)) { seen.add(c.curie); cands.push(c); }
        if (!exact && acceptCurie(variants, c)) exact = c;
      }
      if (exact) break; // verified match — no need to keep searching or ask the LLM
    }
    let hit = exact;
    if (!hit && opts.llm && cands.length) {
      const curie = await pickWithLlm({ name: node.name, type: node.type, aliases: node.aliases, description: node.description }, cands.slice(0, 8));
      if (curie) hit = cands.find((c) => c.curie === curie);
    }
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
export async function mapUnmappedNodes({ limit = 25, force = false, llm }: { limit?: number; force?: boolean; llm?: boolean } = {}): Promise<MapSummary> {
  if (!isDbConfigured()) throw new Error("standards mapping requires a database (DATABASE_URL)");
  const useLlm = (llm ?? true) && isLlmConfigured(); // AI disambiguation, only if an API key is present
  const sql = await getSql();
  await sql.query("ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_checked_at timestamptz");
  // force = re-map everything: clear the checked flag so the normal pagination
  // (WHERE codes_checked_at IS NULL) walks every eligible node again.
  if (force) await sql.query("UPDATE node SET codes_checked_at = NULL WHERE type = ANY($1)", [TYPES_WITH_TARGETS]);
  const rows = (await sql.query(
    `SELECT id, type, name, aliases, description, external_ids FROM node
      WHERE type = ANY($1) AND codes_checked_at IS NULL
      ORDER BY updated_at DESC LIMIT $2`,
    [TYPES_WITH_TARGETS, Math.max(1, Math.min(200, limit))],
  )) as Array<{ id: string; type: string; name: string; aliases: string[] | null; description: string | null; external_ids: string[] | null }>;

  let mapped = 0, codesAdded = 0;
  const details: MapSummary["details"] = [];
  for (const r of rows) {
    const { added, all } = await resolveCodesForNode({ type: r.type, name: r.name, aliases: r.aliases ?? [], description: r.description ?? undefined, external_ids: r.external_ids ?? [] }, { llm: useLlm });
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

/** Eligible-type nodes that still carry NO standard code (external_ids empty),
 *  so a curator can see what the resolvers missed and map them by hand. */
export async function listUnmappedNodes({ limit = 500 }: { limit?: number } = {}): Promise<{ total: number; byType: Record<string, number>; items: Array<{ id: string; type: string; name: string; checked: boolean }> }> {
  if (!isDbConfigured()) throw new Error("requires a database (DATABASE_URL)");
  const sql = await getSql();
  await sql.query("ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_checked_at timestamptz");
  const noCode = "type = ANY($1) AND coalesce(array_length(external_ids, 1), 0) = 0";
  const [{ total }] = (await sql.query(`SELECT count(*)::int AS total FROM node WHERE ${noCode}`, [TYPES_WITH_TARGETS])) as Array<{ total: number }>;
  const byRows = (await sql.query(`SELECT type, count(*)::int AS n FROM node WHERE ${noCode} GROUP BY type ORDER BY n DESC`, [TYPES_WITH_TARGETS])) as Array<{ type: string; n: number }>;
  const items = (await sql.query(
    `SELECT id, type, name, (codes_checked_at IS NOT NULL) AS checked FROM node WHERE ${noCode} ORDER BY type, name LIMIT $2`,
    [TYPES_WITH_TARGETS, Math.max(1, Math.min(2000, limit))],
  )) as Array<{ id: string; type: string; name: string; checked: boolean }>;
  const byType: Record<string, number> = {};
  for (const r of byRows) byType[r.type] = r.n;
  return { total, byType, items };
}
