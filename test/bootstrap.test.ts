import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureProvisioned } from "../src/bootstrap.ts";

test("ensureProvisioned is a safe no-op without DATABASE_URL", async () => {
  // Guard: tests must run hermetically (no DB). DATABASE_URL is unset in CI.
  assert.equal(process.env.DATABASE_URL, undefined);
  const r = await ensureProvisioned({ force: false });
  assert.deepEqual(r, { ok: false, provisioned: false, reason: "no DATABASE_URL" });
});
