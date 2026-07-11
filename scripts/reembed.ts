// Healthy Aging Knowledge — re-embed all rows with the active embedder (CLI).
// Logic lives in src/reembed.ts. Run this AFTER switching EMBEDDINGS_PROVIDER
// (the vector space + dimension change, so every row must be recomputed).
//
//   DRY RUN (default, no DB needed):  npm run db:reembed
//   APPLY (real embedder):            EMBEDDINGS_PROVIDER=voyage \
//                                     EMBEDDINGS_API_KEY=… \
//                                     DATABASE_URL=… npm run db:reembed -- --apply
//   (pull secrets: gcloud secrets versions access latest --secret=DATABASE_URL)
//
// Applying with the offline HashingEmbedder is refused unless --force (it would
// overwrite real vectors with the placeholder space).

import { isDbConfigured } from "../src/db.ts";
import { getEmbedder } from "../src/embeddings.ts";
import { reembedAll } from "../src/reembed.ts";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  if (apply && !isDbConfigured()) { console.log(JSON.stringify({ skipped: "DATABASE_URL not set" })); return; }

  const emb = getEmbedder();
  if (apply && emb.id.startsWith("hashing") && !force) {
    console.error("Refusing to re-embed with the offline HashingEmbedder (id " + emb.id + ").");
    console.error("Set EMBEDDINGS_PROVIDER (voyage|openai) + EMBEDDINGS_API_KEY first, or pass --force to accept the placeholder embedder.");
    process.exit(2);
  }

  const r = await reembedAll({ apply });
  console.log(JSON.stringify({ ...r, mode: apply ? "applied" : "dry-run (use -- --apply to execute)" }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
