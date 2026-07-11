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

  const sql = await getSql();
  // Cutover (sequential; search is briefly degraded until the index is rebuilt).
  await sql.query("DROP INDEX IF EXISTS embedding_vector_idx", []);
  await sql.query("DELETE FROM embedding", []);
  await sql.query(`ALTER TABLE embedding ALTER COLUMN vector TYPE vector(${embedder.dim})`, []);

  const items = [
    ...nodes.map((n) => ({ ownerType: "node" as const, id: n.id, text: nodeText(n) })),
    ...claims.map((c) => ({ ownerType: "claim" as const, id: c.id, text: claimText(g, c) })),
  ];
  for (let i = 0; i < items.length; i += batch) {
    const chunk = items.slice(i, i + batch);
    const vecs = await embedder.embed(chunk.map((x) => x.text));
    for (let j = 0; j < chunk.length; j++) {
      const it = chunk[j];
      await sql.query(
        `INSERT INTO embedding (id, owner_type, owner_id, model, vector) VALUES ($1,$2,$3,$4,$5::vector)
         ON CONFLICT (id) DO UPDATE SET vector = EXCLUDED.vector, model = EXCLUDED.model`,
        [`emb-${it.ownerType}-${it.id}`, it.ownerType, it.id, embedder.id, `[${vecs[j].join(",")}]`],
      );
      summary.written++;
    }
  }
  await sql.query("CREATE INDEX embedding_vector_idx ON embedding USING hnsw (vector vector_cosine_ops)", []);
  summary.applied = true;
  return summary;
}
