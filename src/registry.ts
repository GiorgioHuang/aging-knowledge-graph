// Healthy Aging Knowledge — shared query registry.
// One source of truth for the callable read-only queries, powering the CLI
// (cli.ts), the REST API (http.ts) and the MCP server (mcp.ts).

import type { Graph } from "./types.ts";
import * as Q from "./queries.ts";
import { search } from "./store.ts";

export interface JsonSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface QueryDef {
  name: string; // snake_case; MCP tool = `graceage_${name}`
  description: string;
  inputSchema: JsonSchema;
  run: (g: Graph, args: Record<string, unknown>) => unknown | Promise<unknown>;
}

const int = (v: unknown, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const bool = (v: unknown): boolean => v === true || v === "true" || v === "1";
const obj = (props: JsonSchema["properties"], required: string[] = []): JsonSchema => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

export const registry: QueryDef[] = [
  {
    name: "what_affects",
    description:
      "What affects an outcome/disease node, with direction, GRADE certainty and citations. Set protective=true to keep only protective relationships (reduces_risk_of/improves/treats/prevents).",
    inputSchema: obj(
      {
        object: { type: "string", description: "object node id, e.g. ga:fall-rate" },
        protective: { type: "boolean", description: "only protective relationships" },
      },
      ["object"],
    ),
    run: (g, a) => Q.whatAffects(g, String(a.object), { protective: bool(a.protective) }),
  },
  {
    name: "high_certainty_about",
    description: "High (GRADE) certainty claims touching a node (as subject or object).",
    inputSchema: obj({ node: { type: "string", description: "node id" } }, ["node"]),
    run: (g, a) => Q.highCertaintyAbout(g, String(a.node)),
  },
  {
    name: "conflicts",
    description: "Where the evidence conflicts (contradicts links), with the scoping that explains it.",
    inputSchema: obj({}),
    run: (g) => Q.conflicts(g),
  },
  {
    name: "gaps",
    description: "Data-quality gaps: claims that are unverified / needs_refinement / skeleton.",
    inputSchema: obj({}),
    run: (g) => Q.gaps(g),
  },
  {
    name: "knowledge_gaps",
    description:
      "Knowledge gaps for research planning: first-class knowledge_gap nodes with the research questions they generate and the topics they concern. Give a topic (node id or name substring) to focus, and to also surface weak/unverified/indirect evidence touching that topic — answering 'what is missing or weakly supported for X?'. Omit topic to list every gap.",
    inputSchema: obj({ topic: { type: "string", description: "topic node id or name substring (optional)" } }),
    run: (g, a) => Q.knowledgeGaps(g, { topic: str(a.topic) }),
  },
  {
    name: "for_population",
    description: "Every claim scoped to a given population node.",
    inputSchema: obj({ population: { type: "string", description: "population node id" } }, ["population"]),
    run: (g, a) => Q.forPopulation(g, String(a.population)),
  },
  {
    name: "neighbourhood",
    description: "Every claim that touches a node (its cross-domain neighbourhood).",
    inputSchema: obj({ node: { type: "string", description: "node id" } }, ["node"]),
    run: (g, a) => Q.neighbourhood(g, String(a.node)),
  },
  {
    name: "comparative",
    description: "Comparative-effectiveness claims (those carrying an active comparator).",
    inputSchema: obj({}),
    run: (g) => Q.comparative(g),
  },
  {
    name: "path",
    description:
      "Shortest connecting path between two nodes, in one call — traces the platform's Problem→Theory→Mechanism→Intervention→Outcome→Measurement chain even though its hops run in different claim directions (traversal is undirected). Each step returns the relationship, direction, GRADE certainty, status and evidence sources; `forward` says whether the claim was followed with or against its own direction. Bounded by max_hops (default 6).",
    inputSchema: obj(
      {
        from: { type: "string", description: "start node id, e.g. ga:loneliness" },
        to: { type: "string", description: "end node id, e.g. ga:ucla" },
        max_hops: { type: "number", description: "max path length in edges (default 6, max 12)" },
      },
      ["from", "to"],
    ),
    run: (g, a) => Q.path(g, String(a.from), String(a.to), { maxHops: int(a.max_hops, 6) }),
  },
  {
    name: "search",
    description:
      "Natural-language semantic search over nodes and claims (cosine similarity). Optionally limit to owner='node' or 'claim'. Returns ranked hits with scores.",
    inputSchema: obj(
      {
        q: { type: "string", description: "natural-language query" },
        k: { type: "number", description: "max results (default 5)" },
        owner: { type: "string", description: "filter: node | claim", enum: ["node", "claim"] },
      },
      ["q"],
    ),
    run: (g, a) => search(g, String(a.q), { k: int(a.k, 5), owner: str(a.owner) as "node" | "claim" | undefined }),
  },
  {
    name: "get_node",
    description: "Fetch a single node by id.",
    inputSchema: obj({ id: { type: "string", description: "node id" } }, ["id"]),
    run: (g, a) => Q.getNode(g, String(a.id)),
  },
  {
    name: "node_detail",
    description: "Full detail for a node: outgoing/incoming claims with evidence, plus cross-domain neighbours.",
    inputSchema: obj({ id: { type: "string", description: "node id" } }, ["id"]),
    run: (g, a) => Q.nodeDetail(g, String(a.id)),
  },
  {
    name: "list_nodes",
    description: "List nodes, optionally filtered by type, domain, and a name/alias/id substring (q).",
    inputSchema: obj({
      type: { type: "string", description: "node type, e.g. outcome" },
      domain: { type: "string", description: "domain, e.g. falls" },
      q: { type: "string", description: "substring match on name/alias/id" },
    }),
    run: (g, a) => Q.listNodes(g, { type: str(a.type), domain: str(a.domain), q: str(a.q) }),
  },
  {
    name: "list_claims",
    description: "List claims, filtered by relationship type, status, certainty, subject, object.",
    inputSchema: obj({
      type: { type: "string", description: "relationship type, e.g. reduces_risk_of" },
      status: { type: "string", description: "claim status, e.g. curated" },
      certainty: { type: "string", description: "GRADE certainty, e.g. high" },
      subject: { type: "string", description: "subject node id" },
      object: { type: "string", description: "object node id" },
    }),
    run: (g, a) => Q.listClaims(g, { type: str(a.type), status: str(a.status), certainty: str(a.certainty), subject: str(a.subject), object: str(a.object) }),
  },
];

export const byName = new Map(registry.map((q) => [q.name, q]));
