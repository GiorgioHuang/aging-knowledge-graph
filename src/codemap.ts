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
import { complete, isLlmConfigured, extractJson } from "./llm.ts";
import { loadGraph } from "./model.ts";
import type { Node } from "./types.ts";

// A small, fast model is plenty for "what is the canonical term for this concept".
const CODEMAP_MODEL = process.env.CODEMAP_MODEL || "claude-haiku-4-5";
const TERM_SYSTEM = `You translate a healthy-aging knowledge-graph node into CONTROLLED-VOCABULARY TERMS.
Given a node (name, type, optional description), output the canonical term STRING(S) exactly as they appear in standard biomedical vocabularies (MeSH, MONDO, HPO, ChEBI, FoodOn, GO) that are an EXACT SYNONYM of the node's concept — the SAME meaning.
Examples: "Fall incidence" → "Accidental Falls"; "Alzheimer's disease and related dementia" → "Alzheimer Disease"; "Delirium incidence" → "Delirium".
STRICT rules:
- Output the single most precise standard term. Add a second ONLY if it is a true synonym of the SAME concept.
- NEVER output a BROADER category, a RELATED concept, or a MEASURE/SCALE of the concept (e.g. do NOT map "Fear of falling" to "Postural Balance", nor "Lean mass" to "Body Composition").
- If there is no standard term meaning exactly this concept, output an EMPTY list — do not substitute something close.
- Term strings only, never codes/IDs. Respond JSON only: {"terms": ["..."]}.`;

type TermNode = { name: string; type: string; aliases?: string[]; description?: string };
export function buildTermPrompt(node: TermNode): string {
  return `Node:
- name: ${node.name}
- type: ${node.type}${node.aliases?.length ? `\n- aliases: ${node.aliases.join(", ")}` : ""}${node.description ? `\n- description: ${String(node.description).slice(0, 300)}` : ""}

Exact-synonym controlled-vocabulary term(s) for the SAME concept (empty if none)? Reply JSON only: {"terms": ["..."]}.`;
}

/** Parse {"terms": [...]} into up to 3 non-empty term strings. */
export function parseTermSuggestions(text: string): string[] {
  let obj: { terms?: unknown };
  try { obj = extractJson(text); } catch { return []; }
  const arr = Array.isArray(obj.terms) ? obj.terms : [];
  return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, 3);
}

// Batch diagnostics — the AI/lookup helpers swallow errors (a failed call just
// means "no match"), which hides WHY a batch under-performs. Count attempts and
// failures and keep the last error so mapUnmappedNodes can report them.
interface Diag { aiCalls: number; aiFail: number; lookups: number; lookupFail: number; lastError: string }
let DIAG: Diag = { aiCalls: 0, aiFail: 0, lookups: 0, lookupFail: 0, lastError: "" };

async function suggestVocabTerms(node: TermNode): Promise<string[]> {
  DIAG.aiCalls++;
  try {
    const text = await complete([{ role: "user", content: buildTermPrompt(node) }],
      { system: TERM_SYSTEM, maxTokens: 150, thinking: false, model: CODEMAP_MODEL });
    return parseTermSuggestions(text);
  } catch (e) { DIAG.aiFail++; DIAG.lastError = "AI: " + String((e as Error).message).slice(0, 180); return []; }
}

// Verification gate: a match found only via an AI-suggested term is confirmed to
// be the SAME concept before it's accepted (keeps precision high).
const VERIFY_SYSTEM = `You verify a proposed controlled-vocabulary mapping for a healthy-aging knowledge graph.
Answer whether the vocabulary term denotes the SAME concept as the node — a synonym or the node's exact concept, NOT merely broader, narrower, or related. When in doubt, answer false. Respond JSON only: {"same": true|false}.`;
export function buildVerifyPrompt(node: TermNode, candidate: Candidate): string {
  return `Node: ${node.name} (${node.type})${node.description ? ` — ${String(node.description).slice(0, 200)}` : ""}
Vocabulary term: ${candidate.curie} "${candidate.labels[0] ?? ""}"${candidate.def ? ` — ${String(candidate.def).slice(0, 200)}` : ""}

Same concept? Reply JSON only: {"same": true|false}.`;
}
export function parseVerifyDecision(text: string): boolean {
  try { return extractJson<{ same?: unknown }>(text).same === true; } catch { return false; }
}
async function confirmSameConcept(node: TermNode, candidate: Candidate): Promise<boolean> {
  DIAG.aiCalls++;
  try {
    const text = await complete([{ role: "user", content: buildVerifyPrompt(node, candidate) }],
      { system: VERIFY_SYSTEM, maxTokens: 60, thinking: false, model: CODEMAP_MODEL });
    return parseVerifyDecision(text);
  } catch (e) { DIAG.aiFail++; DIAG.lastError = "AI: " + String((e as Error).message).slice(0, 180); return false; }
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

/** NLM MeSH RDF term-lookup response → candidates. Each entry is
 *  { resource: "http://id.nlm.nih.gov/mesh/D000058", label: "Accidental Falls" }.
 *  This looks a term up in the MeSH vocabulary directly (unlike PubMed esearch,
 *  which indexes article text and misses descriptive phrases). */
export function parseMeshLookup(json: unknown): Candidate[] {
  const arr = Array.isArray(json) ? (json as Array<{ resource?: string; label?: string }>) : [];
  const out: Candidate[] = [];
  for (const r of arr) {
    const ui = String(r.resource ?? "").split("/").pop();
    if (ui && r.label) out.push({ curie: `MESH:${ui}`, labels: [r.label] });
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
  DIAG.lookups++;
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 300));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000); // bounded so a slow authority can't blow the request budget, but generous enough to avoid flaky misses
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "HealthyAgingKnowledge/1.0 (https://ack.icareu.ca)", accept: "application/json" } });
      if (res.status === 429 || res.status >= 500) { lastErr = `${new URL(url).host} ${res.status}`; continue; }
      if (!res.ok) { DIAG.lookupFail++; DIAG.lastError = `lookup: ${new URL(url).host} ${res.status}`; return null; }
      return await res.json();
    } catch (e) { lastErr = `${new URL(url).host} ${(e as Error).message}`; } finally { clearTimeout(timer); }
  }
  DIAG.lookupFail++; DIAG.lastError = "lookup: " + lastErr.slice(0, 180);
  return null;
}

async function olsSearch(term: string, ontology: string, prefix: string): Promise<Candidate[]> {
  // Ranked (not exact): an exact label still ranks first (cheap-accepted by
  // acceptCurie), and the rest become candidates for LLM disambiguation.
  const url = `https://www.ebi.ac.uk/ols4/api/search?q=${encodeURIComponent(term)}&ontology=${ontology}&rows=15&fieldList=obo_id,label,synonym,description,ontology_name`;
  return parseOls(await jget(url), prefix);
}

async function meshSearch(term: string): Promise<Candidate[]> {
  // Look the term up among MeSH DESCRIPTORS directly (substring match; the exact
  // one is selected by acceptCurie). Only descriptors (D-codes) — entry-term
  // (T-code) resources aren't the identifiers we attach.
  return parseMeshLookup(await jget(`https://id.nlm.nih.gov/mesh/lookup/descriptor?label=${encodeURIComponent(term)}&match=contains&limit=10`));
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

/** Search one target for a node and decide a match. A candidate matching the
 *  node's own name/alias is trusted; one matching only an AI-suggested term is
 *  confirmed by the model (same-concept?) before it counts. */
interface MatchResult { cands: Candidate[]; hit?: Candidate; via?: "name" | "ai"; verified?: boolean }
async function matchTarget(t: Target, queries: string[], variants: string[], llmTerms: string[], node: TermNode, opts: { verify?: boolean } = {}): Promise<MatchResult> {
  const cands: Candidate[] = [];
  const seen = new Set<string>();
  let nameHit: Candidate | undefined, aiHit: Candidate | undefined;
  for (const term of queries) {
    for (const c of await runSearch(t, term)) {
      if (c.curie.split(":")[0].toUpperCase() !== t.prefix.toUpperCase()) continue;
      if (!seen.has(c.curie)) { seen.add(c.curie); cands.push(c); }
      if (!nameHit && acceptCurie(variants, c)) nameHit = c;
      else if (!aiHit && acceptCurie(llmTerms, c)) aiHit = c;
    }
    if (nameHit) break;
  }
  if (nameHit) return { cands, hit: nameHit, via: "name", verified: true };
  if (aiHit) {
    const verified = opts.verify === false || await confirmSameConcept(node, aiHit);
    return { cands, hit: verified ? aiHit : undefined, via: "ai", verified };
  }
  return { cands };
}

/** Resolve open CURIEs for one node. Matches the node's own name directly; for
 *  descriptive names the LLM proposes the canonical vocabulary TERM (never an
 *  id) and the authority supplies the real code, guarded by a verification call.
 *
 *  NON-DESTRUCTIVE: a vocabulary the node already has a code for is left alone
 *  unless its prefix is in `reresolve` — and even then the old code is REPLACED
 *  only when a confident new one is found; a lookup miss keeps the old code (so
 *  a transient failure or an over-strict reject never deletes good data). */
export async function resolveCodesForNode(
  node: Pick<Node, "type" | "name" | "aliases" | "external_ids" | "description">,
  opts: { llm?: boolean; reresolve?: Set<string> } = {},
): Promise<{ added: string[]; all: string[] }> {
  const existing = node.external_ids ?? [];
  const reresolve = opts.reresolve ?? new Set<string>();
  const variants = nameVariants(node.name, node.aliases ?? []);
  const baseQueries = searchTerms(node.name, node.aliases ?? []);
  const targets = vocabulariesForType(node.type);
  const existingByPrefix = new Map<string, string>();
  for (const c of existing) { const p = c.split(":")[0].toUpperCase(); if (!existingByPrefix.has(p)) existingByPrefix.set(p, c); }

  const resolved = new Map<string, string>(); // target prefix -> final code
  const toResolve: Target[] = [];
  for (const t of targets) {
    const p = t.prefix.toUpperCase();
    const has = existingByPrefix.get(p);
    if (has && !reresolve.has(p)) { resolved.set(p, has); continue; } // keep as-is
    toResolve.push(t);
  }
  // Pass 1: cheap, no LLM — accept a match to the node's own name/alias.
  const pending: Target[] = [];
  for (const t of toResolve) {
    const { hit } = await matchTarget(t, baseQueries, variants, [], node, { verify: false });
    if (hit) resolved.set(t.prefix.toUpperCase(), hit.curie);
    else pending.push(t);
  }
  // Pass 2: still-unresolved vocabularies — LLM proposes the canonical term,
  // the authority supplies the code, and the match is verified.
  if (opts.llm && pending.length) {
    const llmTerms = await suggestVocabTerms(node);
    if (llmTerms.length) {
      const queries = uniqByNorm([...baseQueries, ...llmTerms]).slice(0, 5);
      for (const t of pending) {
        const { hit } = await matchTarget(t, queries, variants, llmTerms, node, { verify: true });
        if (hit) resolved.set(t.prefix.toUpperCase(), hit.curie);
      }
    }
  }
  // Keep the old code for any re-resolved vocabulary that found nothing.
  for (const t of toResolve) {
    const p = t.prefix.toUpperCase();
    if (!resolved.has(p) && existingByPrefix.has(p)) resolved.set(p, existingByPrefix.get(p)!);
  }
  // Final = non-target existing codes (DOI/seed/etc.) + resolved target codes.
  const targetSet = new Set(targets.map((t) => t.prefix.toUpperCase()));
  const nonTarget = existing.filter((c) => !targetSet.has(c.split(":")[0].toUpperCase()));
  const all: string[] = [];
  const seen = new Set<string>();
  for (const c of [...nonTarget, ...resolved.values()]) { if (c && !seen.has(c)) { seen.add(c); all.push(c); } }
  const existingSet = new Set(existing);
  return { added: all.filter((c) => !existingSet.has(c)), all };
}

/** Explain WHY a node did/didn't get a code for each target vocabulary — the
 *  terms searched, the real candidates the authority returned, and the decision.
 *  Read-only (no writes), so it's safe to run for a single node on demand. */
export interface TargetTrace { prefix: string; source: string; queries: string[]; candidates: Array<{ curie: string; label: string }>; decision: string }
export async function diagnoseNode(node: Pick<Node, "type" | "name" | "aliases" | "external_ids" | "description">, opts: { llm?: boolean } = {}): Promise<{ type: string; name: string; aiTerms: string[]; targets: TargetTrace[] }> {
  const existing = node.external_ids ?? [];
  const havePrefix = new Set(existing.map((c) => c.split(":")[0].toUpperCase()));
  const llmTerms = opts.llm ? await suggestVocabTerms(node) : [];
  const variants = nameVariants(node.name, node.aliases ?? []);
  const queries = uniqByNorm([...searchTerms(node.name, node.aliases ?? []), ...llmTerms]).slice(0, 5);
  const targets: TargetTrace[] = [];
  for (const t of vocabulariesForType(node.type)) {
    if (havePrefix.has(t.prefix.toUpperCase())) { targets.push({ prefix: t.prefix, source: t.source, queries: [], candidates: [], decision: "already has a code" }); continue; }
    const m = await matchTarget(t, queries, variants, llmTerms, node);
    let decision: string;
    if (m.hit) decision = `matched (${m.via === "name" ? "name" : "AI-verified"}) → ${m.hit.curie}`;
    else if (m.via === "ai") decision = "AI term matched a candidate but verification rejected it (not the same concept)";
    else if (m.cands.length) decision = `no matching term (${m.cands.length} candidates)`;
    else decision = "no candidates returned by the authority";
    targets.push({ prefix: t.prefix, source: t.source, queries, candidates: m.cands.slice(0, 8).map((c) => ({ curie: c.curie, label: c.labels[0] ?? "" })), decision });
  }
  return { type: node.type, name: node.name, aiTerms: llmTerms, targets };
}

export interface MapSummary {
  scanned: number;
  mapped: number;
  codesAdded: number;
  remaining: number;
  details: Array<{ id: string; name: string; added: string[] }>;
  diag: Diag;
}

/** Batch-map nodes that haven't been checked yet (or all, when force). Persists
 *  accepted codes to external_ids and stamps codes_checked_at so each node is
 *  processed once. Bounded per call to respect API rate limits. */
export async function mapUnmappedNodes({ limit = 25, reset = false, remap = false, llm, maxMs = 45000 }: { limit?: number; reset?: boolean; remap?: boolean; llm?: boolean; maxMs?: number } = {}): Promise<MapSummary> {
  if (!isDbConfigured()) throw new Error("standards mapping requires a database (DATABASE_URL)");
  const start = Date.now();
  DIAG = { aiCalls: 0, aiFail: 0, lookups: 0, lookupFail: 0, lastError: "" }; // per-request diagnostics
  const useLlm = (llm ?? true) && isLlmConfigured(); // AI disambiguation, only if an API key is present
  const sql = await getSql();
  await sql.query("ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_checked_at timestamptz");
  await sql.query("ALTER TABLE node ADD COLUMN IF NOT EXISTS codes_auto text[] NOT NULL DEFAULT '{}'");
  // reset = clear the checked flag so pagination walks every eligible node again
  // (done ONCE, on the first round). `remap` (below) then strips & re-resolves
  // each node it visits — every round, not just the first.
  if (reset) await sql.query("UPDATE node SET codes_checked_at = NULL WHERE type = ANY($1)", [TYPES_WITH_TARGETS]);
  const rows = (await sql.query(
    `SELECT id, type, name, aliases, description, external_ids, codes_auto FROM node
      WHERE type = ANY($1) AND codes_checked_at IS NULL
      ORDER BY updated_at DESC LIMIT $2`,
    [TYPES_WITH_TARGETS, Math.max(1, Math.min(200, limit))],
  )) as Array<{ id: string; type: string; name: string; aliases: string[] | null; description: string | null; external_ids: string[] | null; codes_auto: string[] | null }>;

  // Seed codes are protected from the re-map strip (codes_auto may be empty for
  // rows mapped before provenance tracking existed, so fall back to the seed).
  const seed = loadGraph();
  const seedCodes = (id: string) => new Set(seed.nodes.get(id)?.external_ids ?? []);

  let mapped = 0, codesAdded = 0, scanned = 0;
  const details: MapSummary["details"] = [];
  for (const r of rows) {
    // Time budget: return promptly so the HTTP request never hits a gateway
    // timeout; the client loops until `remaining` is 0. Always do at least one.
    if (scanned > 0 && Date.now() - start > maxMs) break;
    scanned++;
    const existing = r.external_ids ?? [];
    const prevAuto = r.codes_auto ?? [];
    const targetPrefixes = new Set(vocabulariesForType(r.type).map((t) => t.prefix.toUpperCase()));
    const seeded = seedCodes(r.id);
    // On a re-map, RE-RESOLVE the vocabularies whose current code is one the
    // resolver could have produced (target-vocab, non-seed) — replacing it only
    // if a confident new code is found (resolveCodesForNode keeps it otherwise,
    // so we never delete a good code on a lookup miss). Seed/curator and
    // non-target codes are always kept.
    const reresolve = new Set<string>();
    if (remap) for (const c of existing) { const p = c.split(":")[0].toUpperCase(); if (targetPrefixes.has(p) && (!seeded.has(c) || prevAuto.includes(c))) reresolve.add(p); }
    const { added, all } = await resolveCodesForNode({ type: r.type, name: r.name, aliases: r.aliases ?? [], description: r.description ?? undefined, external_ids: existing }, { llm: useLlm, reresolve });
    // codes_auto = the target-vocab, non-seed codes currently present (our provenance).
    const newAuto = all.filter((c) => targetPrefixes.has(c.split(":")[0].toUpperCase()) && !seeded.has(c));
    const changed = added.length > 0 || all.length !== existing.length;
    if (remap || changed) {
      await sql.query("UPDATE node SET external_ids=$2, codes_auto=$3, codes_checked_at=now(), updated_at=now() WHERE id=$1", [r.id, all, newAuto]);
      if (added.length) { mapped++; codesAdded += added.length; details.push({ id: r.id, name: r.name, added }); }
    } else {
      await sql.query("UPDATE node SET codes_checked_at=now() WHERE id=$1", [r.id]);
    }
  }
  const [{ remaining }] = (await sql.query(
    `SELECT count(*)::int AS remaining FROM node WHERE type = ANY($1) AND codes_checked_at IS NULL`,
    [TYPES_WITH_TARGETS],
  )) as Array<{ remaining: number }>;
  return { scanned, mapped, codesAdded, remaining, details, diag: DIAG };
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
