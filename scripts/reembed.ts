// Healthy Aging Knowledge — re-embed all rows with the active embedder (CLI).
// Logic lives in src/reembed.ts. Run this AFTER switching EMBEDDINGS_PROVIDER
// (the vector space + dimension change, so every row must be recomputed).
//
//   DRY RUN (default, no DB needed):  npm run db:reembed
//   INCREMENTAL top-up (default):     … DATABASE_URL=… npm run db:reembed -- --apply
//   FULL cutover (embedder switch):   … npm run db:reembed -- --apply --full
//   (pull secrets: gcloud secrets versions access latest --secret=DATABASE_URL)
//
// "missing" (default) embeds only rows lacking a current-embedder vector — the
// cheap post-harvest top-up. "--full" is the destructive cutover for an embedder
// SWITCH (resize the column, re-embed everything, rebuild the index).
// Applying with the offline HashingEmbedder is refused unless --force.

import { isDbConfigured } from "../src/db.ts";
import { getEmbedder } from "../src/embeddings.ts";
import { reembedAll } from "../src/reembed.ts";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const mode = process.argv.includes("--full") ? "full" : "missing";
  if (apply && !isDbConfigured()) { console.log(JSON.stringify({ skipped: "DATABASE_URL not set" })); return; }

  const emb = getEmbedder();
  if (apply && emb.id.startsWith("hashing") && !force) {
    console.error("Refusing to re-embed with the offline HashingEmbedder (id " + emb.id + ").");
    console.error("Set EMBEDDINGS_PROVIDER (voyage|openai) + EMBEDDINGS_API_KEY first, or pass --force to accept the placeholder embedder.");
    process.exit(2);
  }

  const r = await reembedAll({ apply, mode });
  console.log(JSON.stringify({ ...r, run: apply ? "applied" : "dry-run (use -- --apply to execute)" }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
