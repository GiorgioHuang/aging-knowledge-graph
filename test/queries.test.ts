import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import * as Q from "../src/queries.ts";

const g = loadGraph();

test("CQ1: exercise is a high-certainty protective factor for fall rate, with citations", () => {
  const rows = Q.whatAffects(g, "ga:fall-rate", { protective: true });
  const ex = rows.find((r) => r.subject === "Exercise (physical activity)");
  assert.ok(ex, "exercise should appear among protective factors for fall rate");
  assert.equal(ex!.certainty, "high");
  assert.ok(ex!.sources.some((s) => s.startsWith("DOI:") || s.startsWith("PMID:")));
});

test("CQ13: the vitamin D contradiction is represented", () => {
  const cs = Q.conflicts(g);
  assert.equal(cs.length, 2);
  // both contradictions involve the historical 'reduces falls' claim fc-h1
  assert.ok(cs.every((c) => c.b.claim === "fc-h1"));
});

test("CQ22: comparative-effectiveness claim carries a comparator", () => {
  const rows = Q.comparative(g);
  assert.ok(rows.some((r) => r.claim === "sc-9" && r.comparator));
});

test("CQ16/24: gaps surface the unverified placeholders", () => {
  const ids = Q.gaps(g).map((r) => r.claim).sort();
  // fc-6/fc-h1/sc-6 are unverified placeholders; mech-1/mech-2 are the P1
  // skeleton mechanism edges (structure seeded, evidence to be harvested).
  assert.deepEqual(ids, ["fc-6", "fc-h1", "mech-1", "mech-2", "sc-6"]);
});

test("CQ20: loneliness is a cross-domain hub (mental health, mortality, dementia)", () => {
  const rows = Q.neighbourhood(g, "ga:loneliness");
  const objects = new Set(rows.map((r) => r.object));
  assert.ok(objects.has("Depressive disorder"));
  assert.ok(objects.has("All-cause mortality"));
  assert.ok(objects.has("Dementia"));
});
