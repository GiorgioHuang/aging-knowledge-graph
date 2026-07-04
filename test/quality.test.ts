import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreClaim, parseSampleSize, designBase, tierOf } from "../src/quality.ts";

test("designBase ranks strongest designs highest, unknown lowest", () => {
  assert.ok(designBase("systematic_review_or_meta_analysis") > designBase("rct"));
  assert.ok(designBase("rct") > designBase("cohort"));
  assert.ok(designBase("cohort") > designBase("case_report"));
  assert.equal(designBase(undefined), designBase("something_unknown"));
});

test("parseSampleSize pulls the largest n= / participants figure", () => {
  assert.equal(parseSampleSize(["a trial with n = 1,234 people"]), 1234);
  assert.equal(parseSampleSize(["enrolled 12,345 participants", "n=50"]), 12345);
  assert.equal(parseSampleSize(["no numbers here"]), undefined);
});

test("scoreClaim: meta-analysis + replication scores High", () => {
  const q = scoreClaim({
    evidence: [
      { source_id: "DOI:1", study_design: "systematic_review_or_meta_analysis", quote: "pooled 5,000 participants" },
      { source_id: "PMID:2", study_design: "rct" },
      { source_id: "PMID:3", study_design: "cohort" },
    ],
  });
  assert.equal(q.tier, "high");
  assert.ok(q.score >= 75);
  assert.equal(q.bestDesign, "systematic_review_or_meta_analysis");
  assert.equal(q.sources, 3);
});

test("scoreClaim: single expert opinion is weak", () => {
  const q = scoreClaim({ evidence: [{ source_id: "URL:x", study_design: "expert_opinion" }] });
  assert.ok(q.tier === "low" || q.tier === "very_low");
  assert.equal(q.sources, 1);
});

test("scoreClaim: a conflict downgrades the score", () => {
  const base = scoreClaim({ evidence: [{ source_id: "PMID:1", study_design: "rct" }] });
  const conflicted = scoreClaim({ evidence: [{ source_id: "PMID:1", study_design: "rct" }], conflicted: true });
  assert.equal(conflicted.score, Math.max(0, base.score - 20));
  assert.ok(conflicted.conflicted);
  assert.ok(conflicted.reasons.some((r) => /conflict/i.test(r)));
});

test("no evidence → very_low", () => {
  const q = scoreClaim({ evidence: [] });
  assert.equal(q.tier, "very_low");
  assert.equal(tierOf(q.score), "very_low");
});
