import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { listNodes, listClaims } from "../src/queries.ts";

const g = loadGraph();
const has = (rows: { id?: string }[], id: string) => rows.some((r) => r.id === id);

test("validated measurement instruments are present and linked to their constructs", () => {
  const scales = listNodes(g, { type: "scale" });
  for (const s of ["ga:who5", "ga:wemwbs", "ga:djg-loneliness", "ga:lsns", "ga:mspss", "ga:pil", "ga:ryff-pwb"]) {
    assert.ok(has(scales, s), `scale ${s} present`);
  }
  const measures = listClaims(g, { type: "measures" });
  const measuresPair = (subj: string, obj: string) => measures.some((c) => c.claim && c.subject && c.object) &&
    listClaims(g, { type: "measures", subject: subj, object: obj }).length > 0;
  assert.ok(measuresPair("ga:who5", "ga:wellbeing"), "WHO-5 measures well-being");
  assert.ok(measuresPair("ga:pil", "ga:purpose-in-life"), "PIL measures purpose in life");
  assert.ok(measuresPair("ga:mspss", "ga:social-support"), "MSPSS measures social support");
});

test("reminiscence / life-story are modelled as psychosocial, NOT cognitive training", () => {
  const isA = (subj: string, obj: string) => listClaims(g, { type: "is_a", subject: subj, object: obj }).length > 0;
  assert.ok(isA("ga:reminiscence-therapy", "ga:psychosocial-intervention"), "reminiscence is psychosocial");
  assert.ok(isA("ga:life-story-work", "ga:psychosocial-intervention"), "life-story is psychosocial");
  assert.ok(isA("ga:digital-reminiscence", "ga:reminiscence-therapy"), "digital reminiscence is reminiscence");
  // the platform requires this NOT be treated as cognitive training:
  assert.equal(isA("ga:reminiscence-therapy", "ga:cognitive-training"), false);
  assert.equal(isA("ga:cognitive-training", "ga:psychosocial-intervention"), false);
});

test("core theories are present and inform interventions", () => {
  const theories = listNodes(g, { type: "theory" });
  for (const t of ["ga:self-determination-theory", "ga:socioemotional-selectivity", "ga:cognitive-discrepancy-loneliness"]) {
    assert.ok(has(theories, t), `theory ${t} present`);
  }
  assert.ok(listClaims(g, { type: "informs", subject: "ga:self-determination-theory" }).length > 0, "SDT informs an intervention");
});
