import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { topicFromJudgement } from "../src/gaptopics.ts";

const domain = loadGraph().ontology.domains[0]; // a real in-scope domain

test("topicFromJudgement accepts a relevant, in-scope, non-duplicate topic", () => {
  const t = topicFromJudgement({ relevant: true, topic: "Tai chi for fall prevention in older adults", domain }, []);
  assert.equal(t, "Tai chi for fall prevention in older adults");
});

test("topicFromJudgement rejects irrelevant / not-judged questions", () => {
  assert.equal(topicFromJudgement({ relevant: false, topic: "Best pizza in Naples", domain }, []), null);
  assert.equal(topicFromJudgement(undefined, []), null);
  assert.equal(topicFromJudgement({ relevant: true }, []), null); // missing topic/domain
});

test("topicFromJudgement rejects an invalid (out-of-vocabulary) domain", () => {
  assert.equal(topicFromJudgement({ relevant: true, topic: "Sauna bathing and longevity in elders", domain: "not_a_domain" }, []), null);
});

test("topicFromJudgement drops a duplicate of an existing topic", () => {
  const topic = "Vitamin D supplementation and falls in older adults";
  assert.equal(topicFromJudgement({ relevant: true, topic, domain }, [topic]), null);
});
