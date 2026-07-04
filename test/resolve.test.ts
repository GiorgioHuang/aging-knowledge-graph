import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, tokenSet, jaccard, bestMatch, NodeResolver, type ExistingNode } from "../src/resolve.ts";

test("canonical lowercases, drops parentheticals/punctuation/stopwords", () => {
  assert.equal(canonical("Exercise (physical activity)"), "exercise");
  assert.equal(canonical("Risk of Falls"), "risk falls");
  assert.equal(canonical("Vitamin-D"), "vitamin d");
});

test("tokenSet stems simple plurals; jaccard is order-independent", () => {
  assert.deepEqual([...tokenSet("Falls")], [...tokenSet("fall")]);
  assert.equal(jaccard(tokenSet("Fall risk"), tokenSet("Risk of falls")), 1); // reordered + plural ≡
  assert.equal(jaccard(tokenSet("a"), tokenSet("a")), 1);
});

const nodes: ExistingNode[] = [
  { id: "ga:exercise", name: "Exercise", type: "exercise", aliases: ["physical activity"] },
  { id: "ga:fall-rate", name: "Fall rate", type: "outcome" },
  { id: "ga:depression", name: "Depression", type: "outcome" },
];

test("bestMatch folds surface variants of the same concept + type", () => {
  assert.equal(bestMatch({ name: "exercise", type: "exercise" }, nodes)?.id, "ga:exercise");
  assert.equal(bestMatch({ name: "Physical Activity", type: "exercise" }, nodes)?.id, "ga:exercise"); // via alias
  assert.equal(bestMatch({ name: "Fall rates", type: "outcome" }, nodes)?.id, "ga:fall-rate"); // plural variant
  // distinct concept "Risk of falls" (risk≠rate) must NOT fold into "Fall rate"
  assert.equal(bestMatch({ name: "Risk of falls", type: "outcome" }, nodes), undefined);
});

test("bestMatch refuses cross-type merges and distinct concepts", () => {
  // same name, different type → no auto-merge (avoid destroying information)
  assert.equal(bestMatch({ name: "Exercise", type: "intervention" }, nodes), undefined);
  // unrelated concept → new node
  assert.equal(bestMatch({ name: "Loneliness", type: "outcome" }, nodes), undefined);
});

test("NodeResolver grows within a run and records aliases", () => {
  const r = new NodeResolver(nodes);
  assert.equal(r.resolve({ name: "exercise", type: "exercise" })?.id, "ga:exercise");
  // a new concept resolves to nothing, then is added and matches next time
  assert.equal(r.resolve({ name: "Sarcopenia", type: "disease" }), undefined);
  r.add({ id: "ga:sarcopenia", name: "Sarcopenia", type: "disease" });
  assert.equal(r.resolve({ name: "sarcopenia", type: "disease" })?.id, "ga:sarcopenia");
  // noteAlias makes a new surface form matchable; refuses the node's own name
  assert.equal(r.noteAlias("ga:fall-rate", "falls"), true);
  assert.equal(r.resolve({ name: "Falls", type: "outcome" })?.id, "ga:fall-rate");
  assert.equal(r.noteAlias("ga:fall-rate", "Fall rate"), false); // equals name
});
