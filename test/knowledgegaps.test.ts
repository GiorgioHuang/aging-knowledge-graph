import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { knowledgeGaps, listNodes } from "../src/queries.ts";
import { byName } from "../src/registry.ts";

const g = loadGraph();

test("ontology gained the Theory / Knowledge-Gap vocabulary", () => {
  const o = g.ontology;
  for (const t of ["theory", "model", "knowledge_gap", "research_question"]) assert.ok(o.nodeTypes.includes(t), `nodeType ${t}`);
  for (const r of ["explains", "informs", "generates"]) assert.ok(o.relationshipTypes.includes(r), `relationship ${r}`);
  // structural links don't require evidence
  for (const r of ["explains", "informs", "generates", "related"]) assert.ok(o.definitionalRelationships.includes(r), `${r} is definitional`);
});

test("theory and knowledge_gap nodes are queryable", () => {
  const theories = listNodes(g, { type: "theory" });
  assert.ok(theories.some((n) => n.id === "ga:cognitive-discrepancy-loneliness"));
  const gaps = listNodes(g, { type: "knowledge_gap" });
  assert.ok(gaps.some((n) => n.id === "ga:gap-digital-loneliness"));
});

test("knowledgeGaps lists gaps with their research questions and concerns", () => {
  const { gaps } = knowledgeGaps(g);
  const gap = gaps.find((x) => x.id === "ga:gap-digital-loneliness");
  assert.ok(gap, "seeded gap present");
  assert.ok(gap.research_questions.some((q) => q.id === "ga:rq-digital-loneliness"), "generates a research question");
  assert.ok(gap.concerns.some((c) => c.id === "ga:loneliness"), "relates to the loneliness topic");
});

test("knowledgeGaps(topic) focuses by topic and surfaces weak-evidence signal", () => {
  const r = knowledgeGaps(g, { topic: "loneliness" });
  assert.ok(r.gaps.some((x) => x.id === "ga:gap-digital-loneliness"), "gap matched via its loneliness concern");
  // topic resolved to the ga:loneliness node → weak/unverified list is returned (possibly empty)
  assert.ok(Array.isArray(r.weak_or_unverified), "weak_or_unverified array present for a resolved topic");
  // an unrelated topic yields no matching gaps
  assert.equal(knowledgeGaps(g, { topic: "zzz-nonexistent-topic" }).gaps.length, 0);
});

test("knowledge_gaps is exposed as an MCP/registry tool", () => {
  assert.ok(byName.has("knowledge_gaps"), "registry has knowledge_gaps");
});
