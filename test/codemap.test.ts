import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vocabulariesForType, normTerm, acceptCurie, mergeCodes, codeUrl,
  parseOls, parseMeshLookup, parseRxnorm, parseRor, parseOrcid,
  deParen, parenParts, nameVariants, searchTerms,
  buildTermPrompt, parseTermSuggestions, TYPES_WITH_TARGETS,
} from "../src/codemap.ts";

test("vocabulariesForType maps node types to open vocabularies (doc 10 §3)", () => {
  assert.deepEqual(vocabulariesForType("disease").map((t) => t.prefix), ["MONDO", "MESH"]);
  assert.deepEqual(vocabulariesForType("symptom").map((t) => t.prefix), ["HP", "MESH"]);
  assert.deepEqual(vocabulariesForType("nutrition").map((t) => t.prefix), ["CHEBI", "FOODON", "MESH"]);
  assert.deepEqual(vocabulariesForType("mechanism").map((t) => t.prefix), ["GO", "MESH"]);
  assert.deepEqual(vocabulariesForType("drug").map((t) => t.prefix), ["RXNORM", "CHEBI", "MESH"]);
  assert.deepEqual(vocabulariesForType("organization").map((t) => t.prefix), ["ROR"]);
  assert.deepEqual(vocabulariesForType("expert").map((t) => t.prefix), ["ORCID"]);
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

test("name variants handle descriptive 'Term (gloss)' node names", () => {
  assert.equal(deParen("Exercise (physical activity)"), "Exercise");
  assert.deepEqual(parenParts("Fall rate (accidental falls)"), ["accidental falls"]);
  // the canonical MeSH descriptor "Exercise" now matches the node "Exercise (physical activity)"
  assert.deepEqual(nameVariants("Exercise (physical activity)", ["PA"]), ["Exercise (physical activity)", "Exercise", "physical activity", "PA"]);
  assert.ok(acceptCurie(nameVariants("Exercise (physical activity)"), { curie: "MESH:D015444", labels: ["Exercise"] }));
  // search terms are bounded and put the cleaned name first
  assert.deepEqual(searchTerms("Fall rate (accidental falls)", ["falls"]), ["Fall rate", "Fall rate (accidental falls)", "falls"]);
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

test("parseMeshLookup turns the MeSH RDF lookup into MESH:Dxxxxxx candidates", () => {
  const json = [
    { resource: "http://id.nlm.nih.gov/mesh/D000058", label: "Accidental Falls" },
    { resource: "http://id.nlm.nih.gov/mesh/D003693", label: "Delirium" },
  ];
  assert.deepEqual(parseMeshLookup(json), [
    { curie: "MESH:D000058", labels: ["Accidental Falls"] },
    { curie: "MESH:D003693", labels: ["Delirium"] },
  ]);
  assert.deepEqual(parseMeshLookup({}), []);
});

test("parseRxnorm turns exact-name CUIs into RXNORM candidates (name verified by the query)", () => {
  const cands = parseRxnorm({ idGroup: { rxnormId: ["310965"] } }, "ibuprofen");
  assert.deepEqual(cands, [{ curie: "RXNORM:310965", labels: ["ibuprofen"] }]);
  assert.deepEqual(parseRxnorm({ idGroup: {} }, "nope"), []);
});

test("parseRor maps org hits to ROR curies with name/alias/acronym labels", () => {
  const json = { items: [{ id: "https://ror.org/03vek6s52", name: "Harvard University", acronyms: ["HU"], aliases: ["Harvard"] }] };
  assert.deepEqual(parseRor(json), [{ curie: "ROR:03vek6s52", labels: ["Harvard University", "Harvard", "HU"] }]);
  assert.deepEqual(parseRor({ items: [] }), []);
});

test("buildTermPrompt includes the node facts and asks for canonical terms", () => {
  const p = buildTermPrompt({ name: "Fall incidence", type: "outcome", description: "rate of accidental falls" });
  assert.match(p, /Fall incidence/);
  assert.match(p, /outcome/);
  assert.match(p, /rate of accidental falls/);
  assert.match(p, /"terms"/);
});

test("parseTermSuggestions pulls up to 3 non-empty term strings (never ids)", () => {
  assert.deepEqual(parseTermSuggestions('{"terms": ["Accidental Falls"]}'), ["Accidental Falls"]);
  assert.deepEqual(parseTermSuggestions('here: {"terms": ["Alzheimer Disease", "Dementia", "", "x", "y"]}'), ["Alzheimer Disease", "Dementia", "x"]);
  assert.deepEqual(parseTermSuggestions('{"terms": []}'), []);   // no standard term → nothing
  assert.deepEqual(parseTermSuggestions("not json"), []);
});

test("parseOrcid accepts only a unique exact-name match (person collisions are unsafe)", () => {
  const one = { "expanded-result": [{ "orcid-id": "0000-0002-1825-0097", "given-names": "Josiah", "family-names": "Carberry" }] };
  assert.deepEqual(parseOrcid(one, "Josiah Carberry"), [{ curie: "ORCID:0000-0002-1825-0097", labels: ["Josiah Carberry"] }]);
  // two people with the same name → refuse to guess
  const two = { "expanded-result": [
    { "orcid-id": "0000-0002-1825-0097", "given-names": "Josiah", "family-names": "Carberry" },
    { "orcid-id": "0000-0003-0000-0000", "given-names": "Josiah", "family-names": "Carberry" },
  ] };
  assert.deepEqual(parseOrcid(two, "Josiah Carberry"), []);
  assert.deepEqual(parseOrcid({ "expanded-result": null }, "x"), []);
});
