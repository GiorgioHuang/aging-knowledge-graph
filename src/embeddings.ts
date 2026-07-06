// Healthy Aging Knowledge — embeddings + semantic search.
// Default embedder is a ZERO-DEPENDENCY, deterministic, offline hashing
// vectorizer (no network, no API key) so semantic search runs and tests in any
// environment. A guarded remote adapter (OpenAI-compatible) activates only when
// configured. The same embedder powers in-memory search and the pgvector query
// vector (see src/store.ts).

import type { Graph, Node, Claim } from "./types.ts";

export const EMBED_DIM = 256;

export interface Embedder {
  id: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

// ---- text rendering (what we embed) ----

export function nodeText(n: Node): string {
  return [n.name, ...(n.aliases ?? []), ...(n.domains ?? []), n.description ?? ""].join(" ");
}

export function claimText(g: Graph, c: Claim): string {
  const name = (id?: string) => (id ? g.nodes.get(id)?.name ?? id : "");
  return [
    name(c.subject), c.type.replace(/_/g, " "), name(c.object),
    c.population ? `in ${name(c.population)}` : "",
    c.direction ?? "", c.comparator ?? "",
  ].filter(Boolean).join(" ");
}

// ---- offline hashing embedder (default) ----

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  const grams: string[] = [];
  for (const w of words) {
    grams.push(w);
    const p = `#${w}#`;
    for (let i = 0; i + 3 <= p.length; i++) grams.push(p.slice(i, i + 3)); // char 3-grams
  }
  return grams;
}

export class HashingEmbedder implements Embedder {
  id = `hashing-${EMBED_DIM}`;
  dim = EMBED_DIM;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }
  one(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const tok of tokenize(text)) v[hash32(tok) % this.dim] += 1;
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }
}

// ---- optional remote embedder (guarded; never used offline/in tests) ----

class RemoteEmbedder implements Embedder {
  id: string;
  dim: number;
  private url: string;
  private key: string;
  private model: string;
  constructor(url: string, key: string, model: string, dim: number) {
    this.url = url;
    this.key = key;
    this.model = model;
    this.id = `remote:${model}`;
    this.dim = dim;
  }
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embeddings provider error ${res.status}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

/** Default offline embedder unless EMBEDDINGS_PROVIDER + key are configured. */
export function getEmbedder(): Embedder {
  const provider = process.env.EMBEDDINGS_PROVIDER;
  const key = process.env.EMBEDDINGS_API_KEY;
  if (provider && key) {
    const url = process.env.EMBEDDINGS_URL ?? "https://api.openai.com/v1/embeddings";
    const model = process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small";
    const dim = Number(process.env.EMBEDDINGS_DIM ?? 1536);
    return new RemoteEmbedder(url, key, model, dim);
  }
  return new HashingEmbedder();
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---- in-memory semantic index (offline path) ----

export interface SearchHit {
  ownerType: "node" | "claim";
  id: string;
  name: string;
  score: number;
  nodeId?: string; // a node to open for this hit (the node itself, or a claim's subject)
}

export interface SemanticIndex {
  embedder: Embedder;
  entries: { ownerType: "node" | "claim"; id: string; name: string; nodeId: string; vector: number[] }[];
}

export async function buildIndex(g: Graph, embedder: Embedder = getEmbedder()): Promise<SemanticIndex> {
  const items: { ownerType: "node" | "claim"; id: string; name: string; nodeId: string; text: string }[] = [];
  for (const n of g.nodes.values()) items.push({ ownerType: "node", id: n.id, name: n.name, nodeId: n.id, text: nodeText(n) });
  for (const c of g.claims.values()) {
    const subj = g.nodes.get(c.subject)?.name ?? c.subject;
    const objn = g.nodes.get(c.object)?.name ?? c.object;
    items.push({ ownerType: "claim", id: c.id, name: `${subj} → ${objn}`, nodeId: c.subject, text: claimText(g, c) });
  }
  const vectors = await embedder.embed(items.map((i) => i.text));
  return { embedder, entries: items.map((it, i) => ({ ...it, vector: vectors[i] })) };
}

export async function searchMemory(
  index: SemanticIndex,
  query: string,
  opts: { k?: number; owner?: "node" | "claim" } = {},
): Promise<SearchHit[]> {
  const [qv] = await index.embedder.embed([query]);
  const k = opts.k ?? 5;
  return index.entries
    .filter((e) => !opts.owner || e.ownerType === opts.owner)
    .map((e) => ({ ownerType: e.ownerType, id: e.id, name: e.name, nodeId: e.nodeId, score: Number(cosine(qv, e.vector).toFixed(4)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
