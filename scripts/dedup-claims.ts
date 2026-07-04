// GraceAge Knowledge — one-time merge of duplicate edges (CLI wrapper).
// Logic lives in src/dedup.ts (so it also runs online via POST /admin/dedup).
//
//   DRY RUN (default):  DATABASE_URL='postgres://…' npm run db:dedup
//   APPLY:              DATABASE_URL='postgres://…' npm run db:dedup -- --apply
//   (pull the URL: DATABASE_URL=$(gcloud secrets versions access latest --secret=DATABASE_URL))

import { isDbConfigured } from "../src/db.ts";
import { dedupClaims } from "../src/dedup.ts";

async function main(): Promise<void> {
  if (!isDbConfigured()) { console.log(JSON.stringify({ skipped: "DATABASE_URL not set" })); return; }
  const r = await dedupClaims({ apply: process.argv.includes("--apply") });
  for (const line of r.details) console.log(line);
  const { details, ...summary } = r;
  console.log(JSON.stringify({ ...summary, mode: r.mode === "dry-run" ? "dry-run (use -- --apply to execute)" : "applied" }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
