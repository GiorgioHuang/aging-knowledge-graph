import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { HashingEmbedder, buildIndex, searchMemory, cosine } from "../src/embeddings.ts";

test("HashingEmbedder is deterministic and L2-normalized", async () => {
  const e = new HashingEmbedder();
  const [a] = await e.embed(["falls in older adults"]);
  const [b] = await e.embed(["falls in older adults"]);
  assert.deepEqual(a, b);
  assert.equal(a.length, e.dim);
  const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
  assert.ok(Math.abs(cosine(a, b) - 1) < 1e-9);
});

const g = loadGraph();

test("semantic search ranks fall-related items for a fall query", async () => {
  const index = await buildIndex(g);
  const hits = await searchMemory(index, "preventing falls in elderly people", { k: 5 });
  const ids = hits.map((h) => h.id);
  // the Fall rate node and/or the exercise->fall claim should surface near the top
  assert.ok(ids.includes("ga:fall-rate") || ids.includes("fc-3"), `got: ${ids.join(", ")}`);
  assert.ok(hits[0].score >= hits[hits.length - 1].score); // sorted desc
});

test("semantic search ranks loneliness for a loneliness query", async () => {
  const index = await buildIndex(g);
  // the graph now also holds loneliness-themed theory/gap/question nodes, so widen
  // to the top node results — the core concept nodes must still surface.
  const hits = await searchMemory(index, "social isolation and loneliness", { k: 8, owner: "node" });
  assert.ok(hits.some((h) => h.id === "ga:loneliness" || h.id === "ga:social-isolation"), `got: ${hits.map((h) => h.id).join(", ")}`);
});

test("owner filter restricts results to nodes", async () => {
  const index = await buildIndex(g);
  const hits = await searchMemory(index, "exercise", { k: 5, owner: "node" });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.ownerType === "node"));
});

test("hits carry a nodeId to open (node = itself, claim = its subject)", async () => {
  const index = await buildIndex(g);
  const nodeHits = await searchMemory(index, "exercise", { k: 5, owner: "node" });
  assert.ok(nodeHits.every((h) => h.nodeId === h.id));
  const claimHits = await searchMemory(index, "preventing falls in elderly people", { k: 8, owner: "claim" });
  assert.ok(claimHits.length > 0);
  // a claim's nodeId points at a real node (its subject), not the claim id
  assert.ok(claimHits.every((h) => g.nodes.has(h.nodeId) && h.nodeId !== h.id));
});
