// GraceAge Knowledge — V0 loader + validator.
// Loads the JSON seed and checks it against the ontology and the rules in
// docs/02-knowledge-model.md. Zero dependencies (Node built-ins only).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  Ontology, GraphData, Graph, Node, Claim, Evidence,
} from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "seed");

const CURIE_RE = /^[A-Za-z0-9.]+:.+$/;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadGraph(dir = seedDir): Graph {
  const ontology = readJson<Ontology>(join(dir, "ontology.json"));
  const data = readJson<GraphData>(join(dir, "graph.json"));
  return {
    ontology,
    nodes: new Map(data.nodes.map((n) => [n.id, n])),
    claims: new Map(data.claims.map((c) => [c.id, c])),
    evidence: new Map(data.evidence.map((e) => [e.id, e])),
    contradictions: data.contradictions,
  };
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  counts: { nodes: number; claims: number; evidence: number; contradictions: number };
}

/** Validate the graph against the ontology and the model's design rules. */
export function validate(g: Graph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = g.ontology;
  const set = (xs: string[]) => new Set(xs);
  const nodeTypes = set(o.nodeTypes);
  const relTypes = set(o.relationshipTypes);
  const definitional = set(o.definitionalRelationships);
  const directions = set(o.directions);
  const certainties = set(o.certainties);
  const statuses = set(o.statuses);
  const settings = set(o.settings);
  const designs = set(o.studyDesigns);
  const domains = set(o.domains);
  const prefixes = set(o.knownCuriePrefixes);

  const nodeRef = (id: string | undefined, ctx: string) => {
    if (id === undefined) return;
    if (!g.nodes.has(id)) errors.push(`${ctx}: references unknown node '${id}'`);
  };

  // ----- nodes -----
  for (const n of g.nodes.values()) {
    if (!nodeTypes.has(n.type)) errors.push(`node ${n.id}: unknown type '${n.type}'`);
    for (const d of n.domains ?? []) {
      if (!domains.has(d)) warnings.push(`node ${n.id}: unknown domain '${d}'`);
    }
    for (const c of n.external_ids ?? []) {
      if (!CURIE_RE.test(c)) errors.push(`node ${n.id}: malformed CURIE '${c}'`);
      else if (!prefixes.has(c.split(":")[0])) warnings.push(`node ${n.id}: unknown CURIE prefix in '${c}'`);
    }
  }

  // ----- claims -----
  for (const c of g.claims.values()) {
    if (!relTypes.has(c.type)) errors.push(`claim ${c.id}: unknown relationship type '${c.type}'`);
    nodeRef(c.subject, `claim ${c.id}.subject`);
    nodeRef(c.object, `claim ${c.id}.object`);
    nodeRef(c.population, `claim ${c.id}.population`);
    nodeRef(c.mechanism, `claim ${c.id}.mechanism`);
    if (c.population && g.nodes.get(c.population)?.type !== "population")
      warnings.push(`claim ${c.id}: population '${c.population}' is not a population node`);
    if (c.mechanism && g.nodes.get(c.mechanism)?.type !== "mechanism")
      warnings.push(`claim ${c.id}: mechanism '${c.mechanism}' is not a mechanism node`);
    if (c.direction && !directions.has(c.direction)) errors.push(`claim ${c.id}: bad direction '${c.direction}'`);
    if (c.certainty && !certainties.has(c.certainty)) errors.push(`claim ${c.id}: bad certainty '${c.certainty}'`);
    if (c.setting && !settings.has(c.setting)) errors.push(`claim ${c.id}: bad setting '${c.setting}'`);
    if (!statuses.has(c.status)) errors.push(`claim ${c.id}: bad status '${c.status}'`);
    if (c.rec_strength && c.type !== "recommends")
      errors.push(`claim ${c.id}: rec_strength only allowed on 'recommends' claims`);

    // Evidence-presence rule (docs/02 §4): a curated, non-definitional claim
    // must carry evidence; placeholders may not.
    const ev = c.evidence ?? [];
    const isDefinitional = definitional.has(c.type);
    if (c.status === "curated" && !isDefinitional && ev.length === 0)
      errors.push(`claim ${c.id}: curated non-definitional claim has no evidence`);
    for (const eid of ev) {
      const e = g.evidence.get(eid);
      if (!e) errors.push(`claim ${c.id}: references unknown evidence '${eid}'`);
      else if (e.claim !== c.id) errors.push(`claim ${c.id}: evidence '${eid}' points to a different claim '${e.claim}'`);
    }
  }

  // ----- evidence -----
  for (const e of g.evidence.values()) {
    if (!g.claims.has(e.claim)) errors.push(`evidence ${e.id}: references unknown claim '${e.claim}'`);
    if (!e.source_id || !CURIE_RE.test(e.source_id)) errors.push(`evidence ${e.id}: source_id should be a CURIE (DOI:/PMID:/URL...), got '${e.source_id}'`);
    if (e.study_design && !designs.has(e.study_design)) errors.push(`evidence ${e.id}: bad study_design '${e.study_design}'`);
    if (e.confidence !== undefined && (e.confidence < 0 || e.confidence > 1)) errors.push(`evidence ${e.id}: confidence out of [0,1]`);
  }

  // ----- contradictions -----
  for (const ct of g.contradictions) {
    if (!g.claims.has(ct.subject_claim)) errors.push(`contradiction ${ct.id}: unknown claim '${ct.subject_claim}'`);
    if (!g.claims.has(ct.object_claim)) errors.push(`contradiction ${ct.id}: unknown claim '${ct.object_claim}'`);
    if (ct.subject_claim === ct.object_claim) errors.push(`contradiction ${ct.id}: self-contradiction`);
  }

  return {
    errors,
    warnings,
    counts: {
      nodes: g.nodes.size,
      claims: g.claims.size,
      evidence: g.evidence.size,
      contradictions: g.contradictions.length,
    },
  };
}

export type { Graph, Node, Claim, Evidence };
