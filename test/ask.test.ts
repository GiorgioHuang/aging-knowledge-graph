import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGraph } from "../src/model.ts";
import { retrieveClaimsByVector, hydrateClaim, claimLine, buildContext, extractCitedIds } from "../src/ask.ts";

const g = loadGraph();

test("retrieveClaimsByVector returns claims with subject id + evidence for a fall query", async () => {
  const claims = await retrieveClaimsByVector(g, "what prevents falls in older adults", 8);
  assert.ok(claims.length > 0);
  // every claim points at a real subject node (so the UI can open it)
  assert.ok(claims.every((c) => g.nodes.has(c.subjectId)));
  // at least one retrieved claim carries a citation
  assert.ok(claims.some((c) => c.evidence.some((e) => /^(PMID:|DOI:|https?:)/i.test(e.source_id))));
});

test("claimLine renders '<id> | subject — rel → object' for the retriever catalog", () => {
  const c = [...g.claims.values()][0];
  const line = claimLine(g, c);
  assert.ok(line.startsWith(c.id + " | "));
  assert.match(line, /—/);
  assert.match(line, /→/);
});

test("buildContext renders each claim with a [C#] header and its evidence", async () => {
  const claims = [...g.claims.values()].slice(0, 3).map((c) => hydrateClaim(g, c));
  const ctx = buildContext(claims);
  assert.match(ctx, /\[C1\]/);
  assert.match(ctx, /→/);
});

test("extractCitedIds pulls bracketed PMIDs/DOIs (deduped), ignores prose", () => {
  const a = "Exercise reduces falls [PMID:12345678] and improves strength [DOI:10.1/x] — see [PMID:12345678].";
  assert.deepEqual(extractCitedIds(a).sort(), ["DOI:10.1/x", "PMID:12345678"]);
  assert.deepEqual(extractCitedIds("no citations here"), []);
});
