// Healthy Aging Knowledge — backend selection.
// Offline (no DATABASE_URL): load the graph from seed/ and search in-memory.
// Neon (DATABASE_URL set): load the graph from Postgres and push vector search
// down to pgvector.

import { loadGraph } from "./model.ts";
import { isDbConfigured, getSql } from "./db.ts";
import { getEmbedder, buildIndex, searchMemory, type SearchHit } from "./embeddings.ts";
import type { Graph, Node, Claim, Evidence } from "./types.ts";

/** Load the graph from Neon if configured, else from the seed files. */
export async function loadGraphAsync(): Promise<Graph> {
  if (!isDbConfigured()) return loadGraph();
  const sql = await getSql();
  const [nodes, claims, evidence, contradictions] = await Promise.all([
    sql<Node>`SELECT id, type, name, description, aliases, domains, external_ids FROM node`,
    sql<Claim & { subject_id: string; object_id: string; population_id?: string; mechanism_id?: string }>`
      SELECT id, type, subject_id, object_id, population_id, mechanism_id, setting, direction,
             effect_value, effect_measure, effect_note, comparator, dose, certainty, rec_strength, status
      FROM claim`,
    sql<Evidence & { claim_id: string; source_node_id?: string }>`
      SELECT id, claim_id, source_id, source_node_id, quote, study_design, confidence, extracted_by FROM evidence`,
    sql<{ id: string; subject_claim_id: string; object_claim_id: string }>`
      SELECT id, subject_claim_id, object_claim_id FROM claim_relation WHERE type = 'contradicts'`,
  ]);

  const claimEvidence = new Map<string, string[]>();
  for (const e of evidence) (claimEvidence.get(e.claim_id) ?? claimEvidence.set(e.claim_id, []).get(e.claim_id)!).push(e.id);

  return {
    ontology: loadGraph().ontology, // vocabularies stay file-sourced
    nodes: new Map(nodes.map((n) => [n.id, { ...n, external_ids: n.external_ids ?? [] }])),
    claims: new Map(
      claims.map((c) => [
        c.id,
        {
          id: c.id, type: c.type, subject: c.subject_id, object: c.object_id,
          population: c.population_id ?? undefined, mechanism: c.mechanism_id ?? undefined,
          setting: c.setting, direction: c.direction, effect_value: c.effect_value,
          effect_measure: c.effect_measure, effect_note: c.effect_note, comparator: c.comparator,
          dose: c.dose, certainty: c.certainty, rec_strength: c.rec_strength, status: c.status,
          evidence: claimEvidence.get(c.id) ?? [],
        } as Claim,
      ]),
    ),
    evidence: new Map(evidence.map((e) => [e.id, { ...e, claim: e.claim_id, source_node: e.source_node_id ?? undefined }])),
    contradictions: contradictions.map((r) => ({ id: r.id, subject_claim: r.subject_claim_id, object_claim: r.object_claim_id })),
  };
}

/** Semantic search: pgvector when configured, else the in-memory index. */
export async function search(
  g: Graph,
  query: string,
  opts: { k?: number; owner?: "node" | "claim" } = {},
): Promise<SearchHit[]> {
  const k = opts.k ?? 5;
  if (!isDbConfigured()) {
    const index = await buildIndex(g);
    return searchMemory(index, query, { k, owner: opts.owner });
  }
  const sql = await getSql();
  const [qv] = await getEmbedder().embed([query]);
  const literal = `[${qv.join(",")}]`; // pgvector text format
  const rows = opts.owner
    ? await sql<{ owner_type: string; owner_id: string; score: number }>`
        SELECT owner_type, owner_id, 1 - (vector <=> ${literal}::vector) AS score
        FROM embedding WHERE owner_type = ${opts.owner}
        ORDER BY vector <=> ${literal}::vector LIMIT ${k}`
    : await sql<{ owner_type: string; owner_id: string; score: number }>`
        SELECT owner_type, owner_id, 1 - (vector <=> ${literal}::vector) AS score
        FROM embedding ORDER BY vector <=> ${literal}::vector LIMIT ${k}`;
  const nm = (id?: string) => (id ? g.nodes.get(id)?.name ?? id : "");
  return rows.map((r) => {
    const isNode = r.owner_type === "node";
    const claim = isNode ? undefined : g.claims.get(r.owner_id);
    return {
      ownerType: r.owner_type as "node" | "claim",
      id: r.owner_id,
      name: isNode ? nm(r.owner_id) : claim ? `${nm(claim.subject)} → ${nm(claim.object)}` : r.owner_id,
      nodeId: isNode ? r.owner_id : claim?.subject,
      score: Number(Number(r.score).toFixed(4)),
    };
  });
}
