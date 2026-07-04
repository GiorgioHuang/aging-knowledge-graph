// Emit `INSERT INTO embedding ...` for every node and claim, using the offline
// embedder (no API key). Pipe into psql:
//   node --experimental-strip-types scripts/embed-to-sql.ts | psql "$DATABASE_URL"

import { loadGraph } from "../src/model.ts";
import { getEmbedder, buildIndex } from "../src/embeddings.ts";

const g = loadGraph();
const embedder = getEmbedder();
const index = await buildIndex(g, embedder);

const out: string[] = ["BEGIN;", "DELETE FROM embedding;"];
for (const e of index.entries) {
  const id = `emb-${e.ownerType}-${e.id}`.replace(/'/g, "''");
  const vec = `[${e.vector.join(",")}]`;
  out.push(
    `INSERT INTO embedding (id, owner_type, owner_id, model, vector) VALUES (` +
      `'${id}', '${e.ownerType}', '${e.id.replace(/'/g, "''")}', '${embedder.id}', '${vec}'::vector);`,
  );
}
out.push("COMMIT;", "");
process.stdout.write(out.join("\n"));
