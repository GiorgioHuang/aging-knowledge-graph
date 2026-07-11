// Healthy Aging Knowledge — re-embed every node/claim with the ACTIVE embedder.
// Switching embedders (e.g. offline hashing → a real API model) changes both the
// vector SPACE and its DIMENSION, so old vectors become meaningless and the
// pgvector column no longer fits. This performs the cutover: drop the ANN index,
// clear old vectors, resize the column to the new dimension, re-embed all rows,
// then rebuild the index. Dry-run (default) reports what WOULD happen and needs
// no database; --apply performs it.
import { getSql, isDbConfigured } from "./db.ts";
import { loadGraphAsync } from "./store.ts";
import { getEmbedder, nodeText, claimText } from "./embeddings.ts";

/** Run `fn` over items with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, worker));
  return out;
}

export type ReembedMode = "missing" | "full";

export interface ReembedSummary {
  embedder: string;   // active embedder id (e.g. "remote:voyage-3-lite" or "hashing-256")
  dim: number;
  mode: ReembedMode;
  nodes: number;      // nodes to embed (missing: only those lacking a current-model vector)
  claims: number;     // claims to embed
  written: number;
  applied: boolean;
}

/** Re-embed nodes/claims with the active embedder.
 *  - "missing" (default): embed only rows that DON'T yet have a vector under the
 *    current embedder — the cheap top-up after a harvest. Non-destructive; the
 *    existing index/column are untouched (new rows are indexed on insert).
 *  - "full": the cutover for an embedder SWITCH — drop the index, clear, resize
 *    the column to the new dimension, re-embed EVERYTHING, rebuild the index.
 *  Dry-run (apply=false) reports what WOULD be embedded. */
export async function reembedAll({ apply, batch = 96, mode = "missing" }: { apply: boolean; batch?: number; mode?: ReembedMode }): Promise<ReembedSummary> {
  const embedder = getEmbedder();
  const g = await loadGraphAsync();
  let nodes = [...g.nodes.values()];
  let claims = [...g.claims.values()];

  // In "missing" mode, narrow to rows that lack a vector under the current
  // embedder id (covers both brand-new rows and any left over from another
  // embedder). Needs the DB; without it (offline dry-run) we report the full set.
  if (mode === "missing" && isDbConfigured()) {
    const sql = await getSql();
    const have = (await sql.query("SELECT owner_type, owner_id FROM embedding WHERE model = $1", [embedder.id])) as { owner_type: string; owner_id: string }[];
    const seen = new Set(have.map((r) => `${r.owner_type}:${r.owner_id}`));
    nodes = nodes.filter((n) => !seen.has(`node:${n.id}`));
    claims = claims.filter((c) => !seen.has(`claim:${c.id}`));
  }

  const summary: ReembedSummary = { embedder: embedder.id, dim: embedder.dim, mode, nodes: nodes.length, claims: claims.length, written: 0, applied: false };
  if (!apply) return summary;

  const items = [
    ...nodes.map((n) => ({ ownerType: "node" as const, id: n.id, text: nodeText(n) })),
    ...claims.map((c) => ({ ownerType: "claim" as const, id: c.id, text: claimText(g, c) })),
  ];
  // Nothing to do (e.g. incremental top-up with no new rows): no-op, keep the index.
  if (mode === "missing" && items.length === 0) { summary.applied = true; return summary; }

  // 1) Compute ALL vectors FIRST. If the provider fails (bad key, downtime), we
  //    throw here — BEFORE any destructive DDL — so existing vectors stay intact
  //    and the error surfaces cleanly instead of leaving an empty table. Batches
  //    run with bounded concurrency so a large graph's embedding wall-clock stays
  //    well under the gateway timeout (order preserved by index).
  const groups: { ownerType: "node" | "claim"; id: string; text: string }[][] = [];
  for (let i = 0; i < items.length; i += batch) groups.push(items.slice(i, i + batch));
  const groupVecs = await mapLimit(groups, 4, (grp) => embedder.embed(grp.map((x) => x.text)));
  const vectors: number[][] = groupVecs.flat();

  // 2) Write. "full" is the destructive cutover (resize the column for a new
  //    dimension, rebuild the index); "missing" just upserts the new rows.
  const sql = await getSql();
  if (mode === "full") {
    await sql.query("DROP INDEX IF EXISTS embedding_vector_idx", []);
    await sql.query("DELETE FROM embedding", []);
    await sql.query(`ALTER TABLE embedding ALTER COLUMN vector TYPE vector(${embedder.dim})`, []);
  }

  const ROWS = 250; // rows per multi-row INSERT (few round-trips, not one per row)
  for (let i = 0; i < items.length; i += ROWS) {
    const slice = items.slice(i, i + ROWS);
    const tuples: string[] = [];
    const params: unknown[] = [];
    slice.forEach((it, j) => {
      const b = params.length;
      tuples.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5}::vector)`);
      params.push(`emb-${it.ownerType}-${it.id}`, it.ownerType, it.id, embedder.id, `[${vectors[i + j].join(",")}]`);
      summary.written++;
    });
    await sql.query(
      `INSERT INTO embedding (id, owner_type, owner_id, model, vector) VALUES ${tuples.join(",")}
       ON CONFLICT (id) DO UPDATE SET vector = EXCLUDED.vector, model = EXCLUDED.model`,
      params,
    );
  }

  if (mode === "full") {
    await sql.query("CREATE INDEX embedding_vector_idx ON embedding USING hnsw (vector vector_cosine_ops)", []);
  }
  summary.applied = true;
  return summary;
}
