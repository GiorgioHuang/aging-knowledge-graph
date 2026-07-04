import { test } from "node:test";
import assert from "node:assert/strict";
import { filterTopics } from "../src/topicgen.ts";

test("filterTopics keeps only in-scope (valid domain), well-formed, non-duplicate topics", () => {
  const proposed = [
    { topic: "Tai chi for balance and fall prevention in older adults", domain: "falls" },        // ok
    { topic: "Childhood vaccination schedules", domain: "pediatrics" },                            // bad domain → dropped
    { topic: "Vitamin B12 deficiency screening in older adults", domain: "nutrition" },            // ok
    { topic: "short", domain: "frailty" },                                                         // too short → dropped
    { topic: "Quantum computing", domain: "physics" },                                             // bad domain → dropped
    { topic: "Tai Chi for balance and fall prevention in older adults!", domain: "falls" },        // dup of #1 (slug) → dropped
    { topic: "Sleep apnea management in elderly", domain: "sleep" },                               // ok
    { something: "wrong" },                                                                         // malformed → dropped
  ];
  const out = filterTopics(proposed, ["Vitamin B12 deficiency screening in older adults"]); // already-existing → dropped
  const topics = out.map((t) => t.topic);
  assert.ok(topics.includes("Tai chi for balance and fall prevention in older adults"));
  assert.ok(topics.includes("Sleep apnea management in elderly"));
  assert.ok(!topics.some((t) => /Childhood|Quantum/.test(t)));            // out-of-scope domains dropped
  assert.ok(!topics.includes("Vitamin B12 deficiency screening in older adults")); // existing dropped
  assert.equal(new Set(out.map((t) => t.topic.toLowerCase())).size, out.length); // no dups
  assert.ok(out.every((t) => t.priority === 3));
});

test("filterTopics handles non-array input", () => {
  assert.deepEqual(filterTopics(null, []), []);
  assert.deepEqual(filterTopics({ nope: 1 }, []), []);
});
