// Healthy Aging Knowledge — re-embed every node/claim with the ACTIVE embedder.
// Switching embedders (e.g. offline hashing → a real API model) changes both the
// vector SPACE and its DIMENSION, so old vectors become meaningless and the
// pgvector column no longer fits. This performs the cutover: drop the ANN index,
// clear old vectors, resize the column to the new dimension, re-embed all rows,
// then rebuild the index. Dry-run (default) reports what WOULD happen and needs
// no database; --apply performs it.
import { getSql } from "./db.ts";
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

export interface ReembedSummary {
  embedder: string;   // active embedder id (e.g. "remote:voyage-3-lite" or "hashing-256")
  dim: number;
  nodes: number;
  claims: number;
  written: number;
  applied: boolean;
}

/** Re-embed all nodes and claims. Dry-run (apply=false) only counts what it
 *  would do (no DB writes). apply=true performs the full cutover. */
export async function reembedAll({ apply, batch = 96 }: { apply: boolean; batch?: number }): Promise<ReembedSummary> {
  const embedder = getEmbedder();
  const g = await loadGraphAsync();
  const nodes = [...g.nodes.values()];
  const claims = [...g.claims.values()];
  const summary: ReembedSummary = { embedder: embedder.id, dim: embedder.dim, nodes: nodes.length, claims: claims.length, written: 0, applied: false };
  if (!apply) return summary;

  const items = [
    ...nodes.map((n) => ({ ownerType: "node" as const, id: n.id, text: nodeText(n) })),
    ...claims.map((c) => ({ ownerType: "claim" as const, id: c.id, text: claimText(g, c) })),
  ];

  // 1) Compute ALL vectors FIRST. If the provider fails (bad key, downtime), we
  //    throw here — BEFORE any destructive DDL — so existing vectors stay intact
  //    and the error surfaces cleanly instead of leaving an empty table. Batches
  //    run with bounded concurrency so a large graph's embedding wall-clock stays
  //    well under the gateway timeout (order preserved by index).
  const groups: { ownerType: "node" | "claim"; id: string; text: string }[][] = [];
  for (let i = 0; i < items.length; i += batch) groups.push(items.slice(i, i + batch));
  const groupVecs = await mapLimit(groups, 4, (grp) => embedder.embed(grp.map((x) => x.text)));
  const vectors: number[][] = groupVecs.flat();

  // 2) Cutover. Vectors are in hand, so the DB window is short: drop the index,
  //    clear, resize the column, bulk-insert (few round-trips, not one per row —
  //    a per-row loop over a large graph blows the gateway timeout), rebuild.
  const sql = await getSql();
  await sql.query("DROP INDEX IF EXISTS embedding_vector_idx", []);
  await sql.query("DELETE FROM embedding", []);
  await sql.query(`ALTER TABLE embedding ALTER COLUMN vector TYPE vector(${embedder.dim})`, []);

  const ROWS = 250; // rows per multi-row INSERT
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
  await sql.query("CREATE INDEX embedding_vector_idx ON embedding USING hnsw (vector vector_cosine_ops)", []);
  summary.applied = true;
  return summary;
}
