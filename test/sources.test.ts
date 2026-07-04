import { test } from "node:test";
import assert from "node:assert/strict";
import { stripTags, mapStudyDesign, paperNode, type SourceMeta } from "../src/sources.ts";

test("stripTags removes JATS/HTML and collapses whitespace", () => {
  assert.equal(stripTags("<jats:p>Hello   <b>world</b></jats:p>"), "Hello world");
});

test("mapStudyDesign maps pubtypes, then title hints, to the enum", () => {
  assert.equal(mapStudyDesign(["Journal Article", "Meta-Analysis"]), "systematic_review_or_meta_analysis");
  assert.equal(mapStudyDesign(["Randomized Controlled Trial"]), "rct");
  assert.equal(mapStudyDesign(["Observational Study"]), "cohort");
  assert.equal(mapStudyDesign([], undefined, "A randomized controlled trial of exercise"), "rct");
  assert.equal(mapStudyDesign([], undefined, "A systematic review and meta-analysis"), "systematic_review_or_meta_analysis");
  assert.equal(mapStudyDesign(["Journal Article"], undefined, "Some unrelated title"), undefined);
});

test("paperNode builds a CURIE-id node from metadata; refuses when unverified", () => {
  const meta: SourceMeta = {
    source_id: "PMID:25910392", exists: true, pmid: "25910392", doi: "DOI:10.1001/x",
    title: "Exercise and falls", journal: "JAMA", year: "2015", authors: ["A B", "C D", "E F", "G H"],
  };
  const pn = paperNode(meta)!;
  assert.equal(pn.id, "pmid:25910392");
  assert.equal(pn.type, "paper");
  assert.deepEqual(pn.external_ids, ["PMID:25910392", "DOI:10.1001/x"]);
  assert.match(pn.description!, /JAMA · 2015 · A B, C D, E F$/); // first 3 authors only
  // DOI-only source → doi: id
  assert.equal(paperNode({ source_id: "DOI:10.1/y", exists: true, doi: "DOI:10.1/y", title: "T" })!.id, "doi:10.1/y");
  // unverified or titleless → no node
  assert.equal(paperNode({ source_id: "PMID:1", exists: false, title: "T" }), undefined);
  assert.equal(paperNode({ source_id: "PMID:1", exists: true }), undefined);
});
