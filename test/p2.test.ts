import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { evidenceLandscape, recommendations } from "../src/queries.ts";

const g = loadGraph();

test("evidence_landscape splits a topic's evidence into direct / indirect / conflicting / weak", () => {
  const el = evidenceLandscape(g, "ga:wellbeing");
  assert.equal(el.topic?.id, "ga:wellbeing");
  // direct: instruments that measure well-being + the mechanism edge into it
  assert.ok(el.summary.direct >= 2, "has direct claims");
  // indirect: reminiscence-therapy --operates_through--> self-continuity, reached
  // via the self-continuity mechanism (not a direct claim on well-being)
  const viaMech = el.indirect.find((i) => i.claim.claim === "mech-1");
  assert.ok(viaMech, "surfaces the mechanism-mediated (indirect) claim");
  assert.equal(viaMech!.via.id, "ga:self-continuity");
  // weak: the skeleton mechanism edge contributes_to well-being
  assert.ok(el.weak.some((r) => r.claim === "mech-2"), "flags the skeleton edge as weak");
});

test("evidence_landscape surfaces contradictions touching the topic", () => {
  const el = evidenceLandscape(g, "ga:fall-rate");
  assert.equal(el.conflicting.length, 2, "the two vitamin-D fall-rate contradictions");
  assert.equal(evidenceLandscape(g, "ga:nope").topic, null);
});

test("recommendations returns authoritative recommends claims, scopable by population/issuer", () => {
  const all = recommendations(g);
  const rec = all.find((r) => r.claim === "fc-7");
  assert.ok(rec, "the USPSTF falls recommendation is present");
  assert.equal(rec!.intervention.id, "ga:exercise");
  assert.equal(rec!.rec_strength, "USPSTF B");
  assert.ok(rec!.sources.length > 0, "carries its guideline source");
  // scoping
  assert.ok(recommendations(g, { population: "ga:pop-community-older" }).some((r) => r.claim === "fc-7"));
  assert.ok(recommendations(g, { issuer: "uspstf" }).some((r) => r.claim === "fc-7"));
  assert.equal(recommendations(g, { issuer: "no-such-issuer" }).length, 0);
});
