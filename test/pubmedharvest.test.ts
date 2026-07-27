import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtractPrompt, guidelineCanon, priorityTopics } from "../src/pubmedharvest.ts";

test("buildExtractPrompt embeds the abstract, vocabulary, and existing nodes", () => {
  const meta = { source_id: "PMID:1", exists: true, title: "Exercise and falls", journal: "JAMA", year: "2020", study_design: "rct", abstract: "In older adults, exercise reduced the rate of falls by 20%." };
  const p = buildExtractPrompt(meta, [{ id: "ga:exercise", name: "Exercise", type: "exercise" }]);
  assert.match(p, /Exercise and falls/);
  assert.match(p, /reduced the rate of falls/);        // the abstract text is present to ground extraction
  assert.match(p, /node types:/);
  assert.match(p, /relationship types:/);
  assert.match(p, /ga:exercise \(exercise\): Exercise/); // existing node offered for reuse
  assert.match(p, /raw JSON array/);
});

test("guidelineCanon loads landmark guideline queries (topics, not fabricated ids)", () => {
  const canon = guidelineCanon();
  assert.ok(canon.length >= 10, "a meaningful canon is present");
  for (const e of canon) {
    assert.ok(e.label && e.query, "each entry has a label and a query");
    // The canon must NOT hardcode identifiers — PubMed resolves the real PMID.
    assert.doesNotMatch(e.query, /\bPMID\b|\bDOI\b|\b\d{7,9}\b/, `${e.label} query carries no baked-in id`);
  }
});

test("priorityTopics loads the platform's priority research queries (topics, not fabricated ids)", () => {
  const topics = priorityTopics();
  assert.ok(topics.length >= 10, "a meaningful priority-topics list is present");
  for (const e of topics) {
    assert.ok(e.label && e.query, "each entry has a label and a query");
    assert.doesNotMatch(e.query, /\bPMID\b|\bDOI\b|\b\d{7,9}\b/, `${e.label} query carries no baked-in id`);
  }
  // The platform's core domain (loneliness) must be represented.
  assert.ok(topics.some((e) => /loneliness/i.test(e.query)), "loneliness is a priority topic");
});
