import { test } from "node:test";
import assert from "node:assert/strict";
import { titleSimilarity, bestTitleMatch, resolveCitation, isNonArticleArtifact, type ResolveDeps } from "../src/citeresolve.ts";

test("titleSimilarity is high for the same paper, low for unrelated", () => {
  const a = "Exercise for preventing falls in older people living in the community";
  assert.ok(titleSimilarity(a, "Exercise for preventing falls in older people living in the community.") > 0.95);
  assert.ok(titleSimilarity(a, "Exercise for preventing falls in older people") >= 0.6); // subtitle/length diff
  assert.ok(titleSimilarity(a, "KP1019 modulates amyloid-beta peptide aggregation") < 0.3);
});

test("bestTitleMatch picks the closest above threshold, else undefined", () => {
  const cands = [
    { id: "1", title: "Gene selection and cancer classification using support vector machines" },
    { id: "2", title: "Exercise for preventing falls in older people living in the community" },
  ];
  assert.equal(bestTitleMatch("Exercise for preventing falls in older people living in the community", cands)?.id, "2");
  assert.equal(bestTitleMatch("A totally different unrelated paper about quantum optics", cands), undefined);
});

// The exact failure we saw live: a real-sounding quote with a PMID that resolves
// but points to an off-topic paper. With resolution-by-title that never happens —
// a wrong-title candidate is rejected; the correct one is found by search.
test("resolveCitation confirms by title via PubMed, ignoring off-topic hits", async () => {
  const deps: ResolveDeps = {
    pubmedSearch: async () => ["26159165", "99999999"],
    pubmedTitles: async () => [
      { pmid: "26159165", title: "Gene selection and cancer classification using bioinformatics" }, // the wrong paper
      { pmid: "99999999", title: "Social relationships and risk of dementia: a meta-analysis of cohort studies" },
    ],
    crossrefSearch: async () => [],
  };
  const r = await resolveCitation({ title: "Social relationships and risk of dementia: a meta-analysis of cohort studies" }, deps);
  assert.equal(r?.source_id, "PMID:99999999");
  assert.equal(r?.via, "pubmed");
});

// The sarcopenia case: the title matched an EWGSOP2 *erratum* stub (no abstract);
// the resolver must skip errata/corrections and pick the real article.
test("resolveCitation skips errata/corrections and picks the real article", async () => {
  const deps: ResolveDeps = {
    pubmedSearch: async () => ["31081853", "30312372"],
    pubmedTitles: async () => [
      { pmid: "31081853", title: "Sarcopenia: revised European consensus on definition and diagnosis", pubtypes: ["Published Erratum"] },
      { pmid: "30312372", title: "Sarcopenia: revised European consensus on definition and diagnosis", pubtypes: ["Journal Article", "Practice Guideline"] },
    ],
    crossrefSearch: async () => [],
  };
  const r = await resolveCitation({ title: "Sarcopenia: revised European consensus on definition and diagnosis" }, deps);
  assert.equal(r?.source_id, "PMID:30312372"); // not the erratum stub
});

test("isNonArticleArtifact flags Crossref peer-review reports by type or DOI shape", () => {
  assert.ok(isNonArticleArtifact("DOI:10.1111/jan.15084/v3/review1", "peer-review"));
  assert.ok(isNonArticleArtifact("DOI:10.1111/jan.15084/v3/review1")); // DOI shape alone
  assert.ok(isNonArticleArtifact("DOI:10.1/x", "component"));
  assert.ok(!isNonArticleArtifact("DOI:10.1111/jan.15084", "journal-article"));
});

// The DSME case seen live: the resolver matched a peer-review REPORT
// (DOI …/v3/review1, title mirrors the reviewed article) instead of the paper.
// It must skip the review artifact and resolve to the real article.
test("resolveCitation skips Crossref peer-review reports and picks the article", async () => {
  const deps: ResolveDeps = {
    pubmedSearch: async () => [],
    pubmedTitles: async () => [],
    crossrefSearch: async () => [
      { doi: "DOI:10.1111/jan.15084/v3/review1", title: "Structured diabetes self-management education and glycaemic control", type: "peer-review" },
      { doi: "DOI:10.1111/jan.15084", title: "Structured diabetes self-management education and glycaemic control", type: "journal-article" },
    ],
  };
  const r = await resolveCitation({ title: "Structured diabetes self-management education and glycaemic control" }, deps);
  assert.equal(r?.source_id, "DOI:10.1111/jan.15084"); // not the /review1 artifact
  assert.equal(r?.via, "crossref");
});

test("resolveCitation falls back to Crossref, and returns undefined on no match", async () => {
  const crossrefOnly: ResolveDeps = {
    pubmedSearch: async () => [],
    pubmedTitles: async () => [],
    crossrefSearch: async () => [{ doi: "DOI:10.1/x", title: "The MIND diet and cognitive decline in older adults" }],
  };
  const r = await resolveCitation({ title: "The MIND diet and cognitive decline in older adults" }, crossrefOnly);
  assert.equal(r?.source_id, "DOI:10.1/x");
  assert.equal(r?.via, "crossref");

  const nothing: ResolveDeps = {
    pubmedSearch: async () => ["1"],
    pubmedTitles: async () => [{ pmid: "1", title: "Completely unrelated paper on marine biology" }],
    crossrefSearch: async () => [{ doi: "DOI:10.2/y", title: "Another unrelated paper on astrophysics" }],
  };
  assert.equal(await resolveCitation({ title: "Mediterranean diet and cardiovascular cognitive outcomes" }, nothing), undefined);
});

test("resolveCitation refuses to match an over-generic title", async () => {
  const deps: ResolveDeps = {
    pubmedSearch: async () => ["1"],
    pubmedTitles: async () => [{ pmid: "1", title: "Aging" }],
    crossrefSearch: async () => [],
  };
  assert.equal(await resolveCitation({ title: "Aging" }, deps), undefined); // < 2 tokens
});
