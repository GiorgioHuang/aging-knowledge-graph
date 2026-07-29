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

export interface KnowledgeGapRow {
  id: string;
  name: string;
  description?: string;
  domains: string[];
  research_questions: { id: string; name: string }[]; // via `generates`
  concerns: { id: string; name: string; type: string }[]; // topics it `related`-links to
}

export interface KnowledgeGapsResult {
  gaps: KnowledgeGapRow[];
  /** When a topic is given AND resolves to a node: weak/unverified/indirect
   *  claims touching it — the "evidence is thin here" signal, distinct from the
   *  first-class knowledge_gap nodes above. */
  weak_or_unverified?: AnswerRow[];
}

/** First-class knowledge gaps: `knowledge_gap` nodes with the research questions
 *  they `generate` and the topics they `relate` to; when a `topic` is given, also
 *  the weak/unverified evidence touching that topic. Answers "what is missing or
 *  weakly supported for X?". Omit `topic` to list every gap. */
export function knowledgeGaps(g: Graph, opts: { topic?: string } = {}): KnowledgeGapsResult {
  const claims = [...g.claims.values()];
  const gapRow = (n: NonNullable<ReturnType<Graph["nodes"]["get"]>>): KnowledgeGapRow => ({
    id: n.id, name: n.name, description: n.description, domains: n.domains ?? [],
    research_questions: claims
      .filter((c) => c.subject === n.id && c.type === "generates")
      .map((c) => ({ id: c.object, name: nameOf(g, c.object) })),
    concerns: claims
      .filter((c) => c.subject === n.id && c.type === "related")
      .map((c) => ({ id: c.object, name: nameOf(g, c.object), type: g.nodes.get(c.object)?.type ?? "" })),
  });
  let gaps = [...g.nodes.values()].filter((n) => n.type === "knowledge_gap").map(gapRow);

  const topic = opts.topic?.trim().toLowerCase();
  if (!topic) return { gaps };

  // resolve the topic to a node (exact id first, then a name/id substring match)
  const topicNode = g.nodes.get(opts.topic!.trim())
    ?? [...g.nodes.values()].find((n) => n.name.toLowerCase().includes(topic) || n.id.toLowerCase().includes(topic));

  gaps = gaps.filter((gr) =>
    gr.id.toLowerCase().includes(topic) ||
    gr.name.toLowerCase().includes(topic) ||
    (gr.description ?? "").toLowerCase().includes(topic) ||
    gr.domains.some((d) => d.toLowerCase().includes(topic)) ||
    gr.concerns.some((cc) => cc.id.toLowerCase().includes(topic) || cc.name.toLowerCase().includes(topic) || (topicNode ? cc.id === topicNode.id : false)));

  let weak_or_unverified: AnswerRow[] | undefined;
  if (topicNode) {
    const WEAK = new Set(["low", "very_low"]);
    weak_or_unverified = claims
      .filter((c) => (c.subject === topicNode.id || c.object === topicNode.id || c.population === topicNode.id || c.mechanism === topicNode.id))
      .filter((c) => c.status === "unverified" || c.status === "needs_refinement" || c.status === "skeleton" || WEAK.has(String(c.certainty)))
      .map((c) => row(g, c));
  }
  return weak_or_unverified ? { gaps, weak_or_unverified } : { gaps };
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

export interface PathStep {
  from: { id: string; name: string; type: string };
  relationship: string;
  direction?: string;
  forward: boolean; // true if the claim runs from→to, false if traversed against its direction
  claim: string;
  certainty?: string;
  status: string;
  sources: string[];
  to: { id: string; name: string; type: string };
}
export interface PathResult {
  from: { id: string; name: string } | null;
  to: { id: string; name: string } | null;
  found: boolean;
  length: number; // number of hops (edges); 0 when not found
  steps: PathStep[];
}

/** Shortest connecting path between two nodes, treating each claim as an
 *  (undirected) edge between its subject and object — so it can trace the
 *  platform's Problem→Theory→Mechanism→Intervention→Outcome→Measurement chain in
 *  one call even though those hops run in different claim directions. BFS, so the
 *  first path found is shortest; bounded by `maxHops`. Each step carries the
 *  claim's relationship, direction, certainty, status and evidence sources. */
export function path(g: Graph, fromId: string, toId: string, opts: { maxHops?: number } = {}): PathResult {
  const maxHops = Math.max(1, Math.min(12, opts.maxHops ?? 6));
  const noderef = (id: string) => {
    const n = g.nodes.get(id);
    return { id, name: n?.name ?? id, type: n?.type ?? "" };
  };
  const src = g.nodes.get(fromId) ? { id: fromId, name: nameOf(g, fromId) } : null;
  const dst = g.nodes.get(toId) ? { id: toId, name: nameOf(g, toId) } : null;
  const empty: PathResult = { from: src, to: dst, found: false, length: 0, steps: [] };
  if (!src || !dst) return empty;
  if (fromId === toId) return { from: src, to: dst, found: true, length: 0, steps: [] };

  // adjacency: node id -> [{ other, claim, forward }]
  const adj = new Map<string, { other: string; claim: Claim; forward: boolean }[]>();
  const add = (a: string, b: string, c: Claim, forward: boolean) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ other: b, claim: c, forward });
  };
  for (const c of g.claims.values()) {
    if (!g.nodes.has(c.subject) || !g.nodes.has(c.object)) continue;
    add(c.subject, c.object, c, true);
    add(c.object, c.subject, c, false);
  }

  // BFS from src, recording the edge used to reach each node.
  const prev = new Map<string, { from: string; claim: Claim; forward: boolean }>();
  const visited = new Set<string>([fromId]);
  let frontier = [fromId];
  let depth = 0;
  let reached = false;
  while (frontier.length && depth < maxHops && !reached) {
    depth++;
    const next: string[] = [];
    for (const cur of frontier) {
      for (const edge of adj.get(cur) ?? []) {
        if (visited.has(edge.other)) continue;
        visited.add(edge.other);
        prev.set(edge.other, { from: cur, claim: edge.claim, forward: edge.forward });
        if (edge.other === toId) { reached = true; break; }
        next.push(edge.other);
      }
      if (reached) break;
    }
    frontier = next;
  }
  if (!reached) return empty;

  // Reconstruct src→dst.
  const chain: { from: string; claim: Claim; forward: boolean; to: string }[] = [];
  let node = toId;
  while (node !== fromId) {
    const p = prev.get(node)!;
    chain.push({ from: p.from, claim: p.claim, forward: p.forward, to: node });
    node = p.from;
  }
  chain.reverse();
  const steps: PathStep[] = chain.map((s) => ({
    from: noderef(s.from),
    relationship: s.claim.type,
    direction: s.claim.direction,
    forward: s.forward,
    claim: s.claim.id,
    certainty: s.claim.certainty,
    status: s.claim.status,
    sources: sourcesOf(g, s.claim),
    to: noderef(s.to),
  }));
  return { from: src, to: dst, found: true, length: steps.length, steps };
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
