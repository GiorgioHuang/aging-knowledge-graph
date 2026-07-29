import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph, validate } from "../src/model.ts";

test("seed graph loads with expected counts", () => {
  const g = loadGraph();
  assert.equal(g.nodes.size, 60);
  assert.equal(g.claims.size, 54);
  assert.equal(g.evidence.size, 25);
  assert.equal(g.contradictions.length, 2);
});

test("seed graph validates with zero errors", () => {
  const r = validate(loadGraph());
  assert.deepEqual(r.errors, [], `unexpected errors:\n${r.errors.join("\n")}`);
});

test("validator catches an unknown relationship type", () => {
  const g = loadGraph();
  g.claims.get("fc-1")!.type = "bogus_rel";
  const r = validate(g);
  assert.ok(r.errors.some((e) => e.includes("unknown relationship type")));
});

test("validator enforces evidence on curated non-definitional claims", () => {
  const g = loadGraph();
  const c = g.claims.get("fc-3")!; // reduces_risk_of (not definitional)
  c.evidence = [];
  const r = validate(g);
  assert.ok(r.errors.some((e) => e.includes("no evidence")));
});

test("validator allows definitional claims without evidence", () => {
  const g = loadGraph();
  // fc-1 is_a has no evidence and must stay valid
  const r = validate(g);
  assert.ok(!r.errors.some((e) => e.includes("fc-1")));
});

test("validator flags rec_strength on a non-recommends claim", () => {
  const g = loadGraph();
  g.claims.get("fc-2")!.rec_strength = "USPSTF A";
  const r = validate(g);
  assert.ok(r.errors.some((e) => e.includes("rec_strength only allowed")));
});
