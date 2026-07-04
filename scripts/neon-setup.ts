// Provision Neon over HTTPS (443) using @neondatabase/serverless.
//   db:setup   -> destructive reset (drop + rebuild)
//   db:ensure  -> provision only if empty (safe for deploy pipelines)
// Pass --ensure for the non-destructive variant; default is force reset.
//   DATABASE_URL=postgres://... node --experimental-strip-types scripts/neon-setup.ts [--ensure]
import { ensureProvisioned } from "../src/bootstrap.ts";
import { loadGraph } from "../src/model.ts";
import { search } from "../src/store.ts";

if (!process.env.DATABASE_URL) throw new Error("set DATABASE_URL");
const force = !process.argv.includes("--ensure");

console.log(`==> provisioning Neon (${force ? "force reset" : "ensure-if-empty"})`);
const result = await ensureProvisioned({ force });
console.log("==>", JSON.stringify(result));

if (result.provisioned) {
  console.log("==> sample pgvector search: 'falling in the elderly'");
  console.log(JSON.stringify(await search(loadGraph(), "falling in the elderly", { k: 5 }), null, 2));
}
console.log("\nNeon setup OK (pgvector live over HTTPS).");
