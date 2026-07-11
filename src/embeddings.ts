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

/** L2-normalize a vector (unit length), so cosine == dot product and vectors
 *  from any embedder are directly comparable. */
export function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
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

// ---- real (API) embedder — guarded; activates only when configured ----
// OpenAI-compatible protocol (Bearer auth, {model,input} → {data:[{embedding}]}),
// which Voyage AI (Anthropic-recommended) and OpenAI both speak. Batches to the
// provider's input cap, retries transient errors, and L2-normalizes the result.

const PROVIDER_PRESETS: Record<string, { url: string; model: string; dim: number }> = {
  voyage: { url: "https://api.voyageai.com/v1/embeddings", model: "voyage-3-lite", dim: 512 },
  openai: { url: "https://api.openai.com/v1/embeddings", model: "text-embedding-3-small", dim: 1536 },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Provider-wide request pacing. Free tiers are strict (Voyage: 3 RPM / 10k TPM),
// and EVERY writer shares one budget, so pace requests globally: at most one
// every `EMBEDDINGS_MIN_INTERVAL_MS` (derived from EMBEDDINGS_MAX_RPM). A single
// query embed goes out immediately; a burst (a harvest, a re-embed) is spaced so
// it doesn't trip 429s. Unset ⇒ no artificial pacing (paid tiers).
const MIN_INTERVAL = process.env.EMBEDDINGS_MIN_INTERVAL_MS
  ? Number(process.env.EMBEDDINGS_MIN_INTERVAL_MS)
  : (process.env.EMBEDDINGS_MAX_RPM ? Math.ceil(60000 / Number(process.env.EMBEDDINGS_MAX_RPM)) : 0);
let paceChain: Promise<void> = Promise.resolve();
let lastCallAt = 0;
function pace(): Promise<void> {
  if (!MIN_INTERVAL) return Promise.resolve();
  const mine = paceChain.then(async () => {
    const wait = MIN_INTERVAL - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  paceChain = mine.catch(() => {}); // keep the chain alive regardless
  return mine;
}

class RemoteEmbedder implements Embedder {
  id: string;
  dim: number;
  private url: string;
  private key: string;
  private model: string;
  private batch: number;
  constructor(url: string, key: string, model: string, dim: number, batch = 96) {
    this.url = url;
    this.key = key;
    this.model = model;
    this.dim = dim;
    this.batch = batch;
    this.id = `remote:${model}`;
  }
  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batch) {
      const vecs = await this.call(texts.slice(i, i + this.batch));
      for (const v of vecs) out.push(l2normalize(v));
    }
    return out;
  }
  private async call(input: string[]): Promise<number[][]> {
    let lastErr = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      await pace(); // respect the global request budget before every attempt
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const res = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.key}` },
          body: JSON.stringify({ model: this.model, input }),
          signal: ctrl.signal,
        });
        if (res.status === 429) {
          // Rate limited: wait the server's Retry-After (or ~a minute) then retry.
          const ra = Number(res.headers.get("retry-after")) || 0;
          lastErr = "rate limited (429)";
          clearTimeout(timer);
          await sleep(ra > 0 ? ra * 1000 : Math.min(60000, 5000 * (attempt + 1)));
          continue;
        }
        if (res.status >= 500) { lastErr = `status ${res.status}`; continue; }
        if (!res.ok) throw new Error(`embeddings provider error ${res.status}`);
        const json = (await res.json()) as { data: { embedding: number[]; index?: number }[] };
        // Sort by index so the returned order matches the input order.
        const rows = json.data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        return rows.map((d) => d.embedding);
      } catch (e) {
        lastErr = (e as Error).message || "fetch failed";
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`embeddings provider failed: ${lastErr}`);
  }
}

/** The active embedder. A real (API) embedder is used when EMBEDDINGS_PROVIDER
 *  + EMBEDDINGS_API_KEY are set (e.g. `voyage` or `openai`, or a custom
 *  EMBEDDINGS_URL/MODEL/DIM); otherwise the zero-config offline HashingEmbedder,
 *  so search and tests always run. NOTE: switching embedders changes the vector
 *  space AND dimension — re-embed every row with scripts/reembed.ts after. */
export function getEmbedder(): Embedder {
  const provider = (process.env.EMBEDDINGS_PROVIDER ?? "").toLowerCase();
  const key = process.env.EMBEDDINGS_API_KEY;
  if (provider && key) {
    const preset = PROVIDER_PRESETS[provider];
    const url = process.env.EMBEDDINGS_URL ?? preset?.url ?? PROVIDER_PRESETS.openai.url;
    const model = process.env.EMBEDDINGS_MODEL ?? preset?.model ?? PROVIDER_PRESETS.openai.model;
    const dim = Number(process.env.EMBEDDINGS_DIM ?? preset?.dim ?? PROVIDER_PRESETS.openai.dim);
    return new RemoteEmbedder(url, key, model, dim);
  }
  return new HashingEmbedder();
}

/** True when the active provider is request-paced (a rate limit is configured).
 *  Callers on the hot write path skip inline embedding then, deferring it to the
 *  batch re-embed Job — otherwise a burst of writes would each block ~one
 *  interval and stall (or time out) the request. */
export function embeddingIsPaced(): boolean {
  return MIN_INTERVAL > 0;
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
