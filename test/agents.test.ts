import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, isLlmConfigured, DEFAULT_MODEL } from "../src/llm.ts";
import { citationKind, verifyAll, allResolved, type Resolver } from "../src/cite.ts";
import { validateCandidate, normalizeSourceId, makeClaimId, nodeId, type Candidate } from "../src/curator.ts";
import { reviewerStatus } from "../src/reviewer.ts";
import { slugId } from "../src/topics.ts";

// ---- llm.ts (pure parts; no network) ----

test("DEFAULT_MODEL is claude-opus-4-8 and llm is unconfigured offline", () => {
  assert.equal(DEFAULT_MODEL, "claude-opus-4-8");
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(isLlmConfigured(), false);
});

test("extractJson tolerates fences and surrounding prose", () => {
  assert.deepEqual(extractJson('here you go:\n```json\n[{"a":1}]\n```\nthanks'), [{ a: 1 }]);
  assert.deepEqual(extractJson('{"verdict":"approve","reason":"ok"}'), { verdict: "approve", reason: "ok" });
  // nested braces / strings with braces must balance correctly
  assert.deepEqual(extractJson('prefix {"q":"a } b","n":{"x":2}} suffix'), { q: "a } b", n: { x: 2 } });
  assert.throws(() => extractJson("no json here"));
});

// ---- cite.ts (citation gate; injectable resolver) ----

test("citationKind classifies sources", () => {
  assert.equal(citationKind("PMID:25910392"), "PMID");
  assert.equal(citationKind("DOI:10.1001/jama.2020.1"), "DOI");
  assert.equal(citationKind("https://example.org/x"), "URL");
  assert.equal(citationKind("made-up-ref"), "OTHER");
});

test("verifyAll maps through an injected resolver; allResolved is strict", async () => {
  const fake: Resolver = async (s) => s.includes("good");
  const checks = await verifyAll(["PMID:good", "DOI:bad"], fake);
  assert.equal(checks[0].resolved, true);
  assert.equal(checks[1].resolved, false);
  assert.equal(allResolved(checks), false);
  assert.equal(allResolved([]), false); // no citations is never "resolved"
  assert.equal(allResolved(await verifyAll(["PMID:good"], fake)), true);
});

// ---- curator.ts (candidate validation + id generation; pure) ----

const ok: Candidate = {
  subject: { name: "Exercise", type: "exercise" },
  object: { name: "Fall rate", type: "outcome" },
  relationship: "reduces_risk_of",
  direction: "decrease",
  certainty: "high",
  citation: { title: "Exercise for preventing falls in older people living in the community", first_author: "Sherrington", year: "2019" },
};

test("validateCandidate accepts a well-formed candidate", () => {
  assert.deepEqual(validateCandidate(ok), []);
});

test("validateCandidate rejects bad types/relationships/citations", () => {
  assert.ok(validateCandidate({ ...ok, relationship: "bogus" }).some((e) => e.includes("relationship")));
  assert.ok(validateCandidate({ ...ok, subject: { name: "X", type: "nope" } }).some((e) => e.includes("subject.type")));
  assert.ok(validateCandidate({ ...ok, certainty: "kinda" }).some((e) => e.includes("certainty")));
  assert.ok(validateCandidate({ ...ok, citation: { title: "" } }).some((e) => e.includes("title")));
  assert.ok(validateCandidate({ ...ok, citation: { title: "short" } }).some((e) => e.includes("title")));
});

test("normalizeSourceId coerces bare ids to CURIEs", () => {
  assert.equal(normalizeSourceId("25910392"), "PMID:25910392");
  assert.equal(normalizeSourceId("10.1001/jama.2020.1"), "DOI:10.1001/jama.2020.1");
  assert.equal(normalizeSourceId("PMID:1"), "PMID:1");
  assert.equal(normalizeSourceId("https://x.org/y"), "https://x.org/y");
});

test("makeClaimId is stable and order-sensitive; nodeId slugs names", () => {
  assert.equal(makeClaimId("ga:a", "treats", "ga:b"), makeClaimId("ga:a", "treats", "ga:b"));
  assert.notEqual(makeClaimId("ga:a", "treats", "ga:b"), makeClaimId("ga:b", "treats", "ga:a"));
  assert.equal(nodeId("Fall Rate (per year)"), "ga:fall-rate-per-year");
});

// ---- reviewer.ts (decision logic; pure) ----

test("reviewerStatus promotes only when citations resolve AND judge approves", async () => {
  const yes: Resolver = async () => true;
  const no: Resolver = async () => false;
  const good = await verifyAll(["PMID:1"], yes);
  const bad = await verifyAll(["PMID:1"], no);
  assert.equal(reviewerStatus(good, "approve"), "curated");
  assert.equal(reviewerStatus(good, "refine"), "needs_refinement");
  assert.equal(reviewerStatus(bad, "approve"), "needs_refinement"); // fabricated citation can't pass
  assert.equal(reviewerStatus([], "approve"), "needs_refinement");   // no citation can't pass
});

// ---- topics.ts ----

test("slugId is stable and prefixed", () => {
  assert.equal(slugId("Vitamin D & falls!"), "t:vitamin-d-falls");
});
