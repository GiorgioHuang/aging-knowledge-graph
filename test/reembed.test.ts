import { test } from "node:test";
import assert from "node:assert/strict";
import { l2normalize, getEmbedder, HashingEmbedder, embeddingIsPaced } from "../src/embeddings.ts";
import { reembedAll } from "../src/reembed.ts";

test("l2normalize returns a unit vector", () => {
  const v = l2normalize([3, 4]);
  const norm = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  assert.ok(Math.abs(norm - 1) < 1e-9, "length is 1");
  assert.ok(Math.abs(v[0] - 0.6) < 1e-9 && Math.abs(v[1] - 0.8) < 1e-9);
  assert.deepEqual(l2normalize([0, 0]), [0, 0]); // zero vector stays zero, no NaN
});

test("getEmbedder defaults to the offline hashing embedder", () => {
  const saved = { p: process.env.EMBEDDINGS_PROVIDER, k: process.env.EMBEDDINGS_API_KEY };
  delete process.env.EMBEDDINGS_PROVIDER; delete process.env.EMBEDDINGS_API_KEY;
  try {
    const e = getEmbedder();
    assert.ok(e instanceof HashingEmbedder);
    assert.equal(e.dim, 256);
    // No EMBEDDINGS_MAX_RPM in the test env ⇒ pacing off ⇒ writes embed inline.
    assert.equal(embeddingIsPaced(), false);
  } finally {
    if (saved.p !== undefined) process.env.EMBEDDINGS_PROVIDER = saved.p;
    if (saved.k !== undefined) process.env.EMBEDDINGS_API_KEY = saved.k;
  }
});

test("getEmbedder picks a real embedder from a provider preset when configured", () => {
  const saved = { p: process.env.EMBEDDINGS_PROVIDER, k: process.env.EMBEDDINGS_API_KEY, d: process.env.EMBEDDINGS_DIM };
  try {
    process.env.EMBEDDINGS_PROVIDER = "voyage";
    process.env.EMBEDDINGS_API_KEY = "test-key";
    delete process.env.EMBEDDINGS_DIM;
    const e = getEmbedder();
    assert.equal(e.id, "remote:voyage-3-lite");
    assert.equal(e.dim, 512);                 // voyage preset dimension
    process.env.EMBEDDINGS_DIM = "1024";      // explicit dim overrides the preset
    assert.equal(getEmbedder().dim, 1024);
  } finally {
    for (const [k, v] of [["EMBEDDINGS_PROVIDER", saved.p], ["EMBEDDINGS_API_KEY", saved.k], ["EMBEDDINGS_DIM", saved.d]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("reembedAll dry-run reports the embedder + row counts without touching a DB", async () => {
  const r = await reembedAll({ apply: false });
  assert.equal(r.applied, false);
  assert.equal(r.written, 0);
  assert.equal(r.mode, "missing");            // incremental top-up is the default
  assert.match(r.embedder, /^hashing-/);      // offline default in tests
  assert.equal(r.dim, 256);
  assert.ok(r.nodes > 0 && r.claims > 0, "counts the seed graph (no DB ⇒ full set)");
});

test("reembedAll dry-run honors an explicit full mode", async () => {
  const r = await reembedAll({ apply: false, mode: "full" });
  assert.equal(r.mode, "full");
  assert.equal(r.applied, false);
});
