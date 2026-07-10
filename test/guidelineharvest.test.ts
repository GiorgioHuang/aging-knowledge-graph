import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGuidelinePrompt, guidelineSourceId } from "../src/guidelineharvest.ts";

test("buildGuidelinePrompt embeds the guideline metadata, text, vocabulary, and existing nodes", () => {
  const meta = { title: "WHO guidelines on falls prevention in older age", issuer: "WHO", year: "2021", source_id: "URL:https://who.int/falls" };
  const text = "WHO recommends offering exercise programmes to community-dwelling older adults to prevent falls.";
  const p = buildGuidelinePrompt(meta, text, [{ id: "ga:exercise", name: "Exercise", type: "exercise" }]);
  assert.match(p, /WHO guidelines on falls prevention/);
  assert.match(p, /Issuing body: WHO/);
  assert.match(p, /recommends offering exercise programmes/);     // the guideline text is present to ground extraction
  assert.match(p, /relationship types:.*recommends/);
  assert.match(p, /ga:exercise \(exercise\): Exercise/);          // existing node offered for reuse
  assert.match(p, /raw JSON array/);
});

test("guidelineSourceId prefers a DOI and normalizes to a CURIE", () => {
  const CURIE = /^[A-Za-z0-9.]+:.+$/;
  assert.equal(guidelineSourceId({ doi: "10.1000/abc", url: "https://who.int/x" }), "DOI:10.1000/abc");
  assert.equal(guidelineSourceId({ doi: "DOI:10.1000/abc" }), "DOI:10.1000/abc");
  assert.equal(guidelineSourceId({ doi: "https://doi.org/10.1000/abc" }), "DOI:10.1000/abc");
  assert.equal(guidelineSourceId({ url: "https://who.int/x" }), "URL:https://who.int/x");
  assert.equal(guidelineSourceId({ url: "URL:https://who.int/x" }), "URL:https://who.int/x");
  assert.equal(guidelineSourceId({}), undefined);
  assert.equal(guidelineSourceId({ url: "not-a-url" }), undefined);
  // whatever it returns must be a valid CURIE the writer accepts
  for (const s of ["10.1/x", "https://who.int/x"].map((v) => guidelineSourceId({ url: v.startsWith("http") ? v : undefined, doi: v.startsWith("http") ? undefined : v }))) {
    assert.ok(CURIE.test(String(s)), `${s} is a CURIE`);
  }
});
