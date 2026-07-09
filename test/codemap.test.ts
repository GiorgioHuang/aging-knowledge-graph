import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vocabulariesForType, normTerm, acceptCurie, mergeCodes, codeUrl,
  parseOls, parseMeshSummary, TYPES_WITH_TARGETS,
} from "../src/codemap.ts";

test("vocabulariesForType maps node types to open vocabularies (doc 10 §3)", () => {
  assert.deepEqual(vocabulariesForType("disease").map((t) => t.prefix), ["MONDO", "MESH"]);
  assert.deepEqual(vocabulariesForType("symptom").map((t) => t.prefix), ["HP", "MESH"]);
  assert.deepEqual(vocabulariesForType("nutrition").map((t) => t.prefix), ["CHEBI", "FOODON", "MESH"]);
  assert.deepEqual(vocabulariesForType("mechanism").map((t) => t.prefix), ["GO", "MESH"]);
  // non-term-resolvable types get nothing auto-resolved
  assert.deepEqual(vocabulariesForType("paper"), []);
  assert.deepEqual(vocabulariesForType("population"), []);
  assert.ok(TYPES_WITH_TARGETS.includes("disease") && !TYPES_WITH_TARGETS.includes("paper"));
});

test("normTerm normalises case/punctuation/whitespace", () => {
  assert.equal(normTerm("Vitamin-D  (25-OH)"), "vitamin d 25 oh");
  assert.equal(normTerm("Sarcopenia"), "sarcopenia");
});

test("acceptCurie requires an exact normalised match to name or an alias", () => {
  const cand = { curie: "MONDO:0005010", labels: ["Sarcopenia", "muscle wasting"] };
  assert.ok(acceptCurie(["Sarcopenia"], cand));                       // name matches label
  assert.ok(acceptCurie(["age-related muscle loss", "Muscle Wasting"], cand)); // alias matches synonym
  assert.ok(!acceptCurie(["Frailty"], cand));                         // no match → reject
});

test("mergeCodes keeps existing (curator) codes and appends new ones, de-duped", () => {
  assert.deepEqual(mergeCodes(["SNOMED:1", "MESH:D1"], ["MESH:D1", "MONDO:2"]), ["SNOMED:1", "MESH:D1", "MONDO:2"]);
  assert.deepEqual(mergeCodes([], ["HP:1"]), ["HP:1"]);
});

test("codeUrl builds authority links; unknown prefixes return null", () => {
  assert.equal(codeUrl("MESH:D055948"), "https://meshb.nlm.nih.gov/record/ui?ui=D055948");
  assert.equal(codeUrl("MONDO:0005010"), "http://purl.obolibrary.org/obo/MONDO_0005010");
  assert.equal(codeUrl("HP:0002360"), "http://purl.obolibrary.org/obo/HP_0002360");
  assert.equal(codeUrl("DOI:10.1/x"), "https://doi.org/10.1/x");
  assert.equal(codeUrl("PMID:29677301"), "https://pubmed.ncbi.nlm.nih.gov/29677301/");
  assert.equal(codeUrl("WEIRD:xyz"), null);
  assert.equal(codeUrl("nocolon"), null);
  assert.equal(codeUrl("MESH:"), null);
});

test("parseOls extracts obo_id + labels for the wanted vocab, drops others", () => {
  const json = { response: { docs: [
    { obo_id: "MONDO:0005010", label: "sarcopenia", synonym: ["muscle wasting"], ontology_name: "mondo" },
    { obo_id: "HP:0003198", label: "myopathy", ontology_name: "hp" }, // wrong vocab for a MONDO query
    { label: "no id here" },                                          // no obo_id → skipped
  ] } };
  const cands = parseOls(json, "MONDO");
  assert.equal(cands.length, 1);
  assert.equal(cands[0].curie, "MONDO:0005010");
  assert.deepEqual(cands[0].labels, ["sarcopenia", "muscle wasting"]);
});

test("parseMeshSummary extracts MESH:Dxxxxxx + descriptor terms", () => {
  const json = { result: {
    uids: ["68055948"],
    "68055948": { ds_meshui: "D055948", ds_meshterms: ["Sarcopenia"] },
  } };
  const cands = parseMeshSummary(json);
  assert.deepEqual(cands, [{ curie: "MESH:D055948", labels: ["Sarcopenia"] }]);
  assert.deepEqual(parseMeshSummary({}), []);
});
