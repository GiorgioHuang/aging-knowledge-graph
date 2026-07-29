import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { listNodes, listClaims, path } from "../src/queries.ts";

const g = loadGraph();

test("P1 schema: intervention_component + operates_through/contributes_to are modelled", () => {
  const comps = listNodes(g, { type: "intervention_component" });
  assert.ok(comps.some((n) => n.id === "ga:structured-life-review"), "a component node exists");
  // component part_of an intervention (definitional)
  assert.equal(listClaims(g, { type: "part_of", subject: "ga:structured-life-review", object: "ga:reminiscence-therapy" }).length, 1);
  // intervention operates_through a mechanism; mechanism contributes_to an outcome
  assert.equal(listClaims(g, { type: "operates_through", subject: "ga:reminiscence-therapy", object: "ga:self-continuity" }).length, 1);
  assert.equal(listClaims(g, { type: "contributes_to", subject: "ga:self-continuity", object: "ga:wellbeing" }).length, 1);
});

test("path finds a shortest connecting chain across claim directions", () => {
  // reminiscence-therapy --operates_through--> self-continuity --contributes_to--> wellbeing
  const r = path(g, "ga:reminiscence-therapy", "ga:wellbeing");
  assert.equal(r.found, true);
  assert.equal(r.length, 2);
  assert.equal(r.steps[0].to.id, "ga:self-continuity");
  assert.equal(r.steps[1].to.id, "ga:wellbeing");
  assert.equal(r.steps[0].relationship, "operates_through");
});

test("path traverses against a claim's direction when needed (undirected)", () => {
  // A scale measures an outcome (scale->outcome); reaching the scale FROM the
  // outcome means following that claim backwards — forward should be false.
  const r = path(g, "ga:wellbeing", "ga:who5");
  assert.equal(r.found, true);
  const last = r.steps[r.steps.length - 1];
  assert.equal(last.to.id, "ga:who5");
  assert.equal(last.forward, false, "measures claim followed against its direction");
});

test("path returns not-found for unknown nodes and unreachable pairs", () => {
  assert.equal(path(g, "ga:nope", "ga:wellbeing").found, false);
  const self = path(g, "ga:wellbeing", "ga:wellbeing");
  assert.equal(self.found, true);
  assert.equal(self.length, 0);
});
