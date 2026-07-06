// Healthy Aging Knowledge — V0 query API. Answers a subset of the competency
// questions (docs/08) over the in-memory graph. This is the minimal "API"
// for V0; the same questions will later run as SQL / over an HTTP+MCP surface.

import type { Graph, Claim } from "./types.ts";
import { graphClaimQuality, type Quality } from "./quality.ts";

export interface AnswerRow {
  claim: string;
  subject: string;
  relationship: string;
  object: string;
  population?: string;
  direction?: string;
  certainty?: string;
  comparator?: string;
  sources: string[];
  quality: Quality;
}

const PROTECTIVE = new Set(["reduces_risk_of", "improves", "treats", "prevents"]);

function nameOf(g: Graph, id: string): string {
  return g.nodes.get(id)?.name ?? id;
}

function sourcesOf(g: Graph, c: Claim): string[] {
  return (c.evidence ?? []).map((eid) => g.evidence.get(eid)?.source_id ?? eid);
}

function row(g: Graph, c: Claim): AnswerRow {
  return {
    claim: c.id,
    subject: nameOf(g, c.subject),
    relationship: c.type,
    object: nameOf(g, c.object),
    population: c.population ? nameOf(g, c.population) : undefined,
    direction: c.direction,
    certainty: c.certainty,
    comparator: c.comparator,
    sources: sourcesOf(g, c),
    quality: graphClaimQuality(g, c),
  };
}

/** CQ1/CQ9: what affects an outcome/disease (protective by default), with certainty + citations. */
export function whatAffects(g: Graph, objectId: string, opts: { protective?: boolean } = {}): AnswerRow[] {
  const protectiveOnly = opts.protective ?? false;
  return [...g.claims.values()]
    .filter((c) => c.object === objectId && (!protectiveOnly || PROTECTIVE.has(c.type)))
    .map((c) => row(g, c));
}

/** CQ14: only High-certainty claims about a topic node (as subject or object). */
export function highCertaintyAbout(g: Graph, nodeId: string): AnswerRow[] {
  return [...g.claims.values()]
    .filter((c) => (c.subject === nodeId || c.object === nodeId) && c.certainty === "high")
    .map((c) => row(g, c));
}

/** CQ13: where the evidence conflicts, with the scoping that explains it. */
export function conflicts(g: Graph): Array<{ a: AnswerRow; b: AnswerRow }> {
  return g.contradictions.map((ct) => ({
    a: row(g, g.claims.get(ct.subject_claim)!),
    b: row(g, g.claims.get(ct.object_claim)!),
  }));
}

/** CQ16/CQ24: data-quality / gaps — claims not yet evidence-backed. */
export function gaps(g: Graph): AnswerRow[] {
  return [...g.claims.values()]
    .filter((c) => c.status === "unverified" || c.status === "needs_refinement" || c.status === "skeleton")
    .map((c) => row(g, c));
}

/** CQ18: everything known about a node, scoped to a population. */
export function forPopulation(g: Graph, populationId: string): AnswerRow[] {
  return [...g.claims.values()].filter((c) => c.population === populationId).map((c) => row(g, c));
}

/** CQ20/CQ21: every claim that touches a node (its cross-domain neighbourhood). */
export function neighbourhood(g: Graph, nodeId: string): AnswerRow[] {
  return [...g.claims.values()]
    .filter((c) => c.subject === nodeId || c.object === nodeId || c.population === nodeId || c.mechanism === nodeId)
    .map((c) => row(g, c));
}

/** CQ22: comparative-effectiveness claims (those carrying an active comparator). */
export function comparative(g: Graph): AnswerRow[] {
  return [...g.claims.values()].filter((c) => c.comparator !== undefined).map((c) => row(g, c));
}

// ----- browse helpers (for the REST/MCP surface) -----

/** Fetch a single node by id (or null). */
export function getNode(g: Graph, id: string) {
  return g.nodes.get(id) ?? null;
}

/** List nodes, optionally filtered by type, domain, and a name/alias/id substring. */
export function listNodes(g: Graph, filter: { type?: string; domain?: string; q?: string } = {}) {
  const q = filter.q?.toLowerCase();
  return [...g.nodes.values()].filter(
    (n) =>
      (filter.type === undefined || n.type === filter.type) &&
      (filter.domain === undefined || (n.domains ?? []).includes(filter.domain)) &&
      (q === undefined ||
        n.id.toLowerCase().includes(q) ||
        n.name.toLowerCase().includes(q) ||
        (n.aliases ?? []).some((a) => a.toLowerCase().includes(q))),
  );
}

/** List claims (as answer rows), filtered by type, status, certainty, subject, object. */
export function listClaims(
  g: Graph,
  filter: { type?: string; status?: string; certainty?: string; subject?: string; object?: string } = {},
): AnswerRow[] {
  return [...g.claims.values()]
    .filter(
      (c) =>
        (filter.type === undefined || c.type === filter.type) &&
        (filter.status === undefined || c.status === filter.status) &&
        (filter.certainty === undefined || c.certainty === filter.certainty) &&
        (filter.subject === undefined || c.subject === filter.subject) &&
        (filter.object === undefined || c.object === filter.object),
    )
    .map((c) => row(g, c));
}

/** A full detail view of one node: its outgoing/incoming claims (with evidence)
 *  and its cross-domain neighbours. Returns null if the node is unknown. */
export function nodeDetail(g: Graph, id: string) {
  const node = g.nodes.get(id);
  if (!node) return null;
  const evOf = (c: Claim) => (c.evidence ?? [])
    .map((eid) => g.evidence.get(eid))
    .filter((e): e is NonNullable<typeof e> => !!e)
    .map((e) => ({ id: e.id, source_id: e.source_id, study_design: e.study_design, quote: e.quote }));
  const view = (c: Claim, otherId: string) => ({
    claim: c.id, relationship: c.type, direction: c.direction, certainty: c.certainty,
    population: c.population ? nameOf(g, c.population) : undefined, comparator: c.comparator,
    dose: c.dose, effect_note: c.effect_note,
    status: c.status, other: { id: otherId, name: nameOf(g, otherId) }, evidence: evOf(c),
    quality: graphClaimQuality(g, c),
  });
  const claims = [...g.claims.values()];
  const outgoing = claims.filter((c) => c.subject === id).map((c) => view(c, c.object));
  const incoming = claims.filter((c) => c.object === id).map((c) => view(c, c.subject));
  const neighbourIds = new Set<string>();
  for (const c of claims) {
    if (c.subject === id) neighbourIds.add(c.object);
    if (c.object === id) neighbourIds.add(c.subject);
  }
  const neighbours = [...neighbourIds]
    .map((nid) => g.nodes.get(nid))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map((n) => ({ id: n.id, name: n.name, type: n.type, domains: n.domains ?? [] }));
  return {
    node: { id: node.id, name: node.name, type: node.type, domains: node.domains ?? [], external_ids: node.external_ids ?? [], description: node.description },
    outgoing, incoming, neighbours,
  };
}
