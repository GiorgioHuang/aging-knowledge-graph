import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, multi } from "../src/csv.ts";
import { loadGraph } from "../src/model.ts";
import { listNodes, listClaims } from "../src/queries.ts";

test("parseCsv handles headers, quotes, embedded commas/newlines", () => {
  const rows = parseCsv('id,name\nga:a,"Hello, world"\nga:b,"line1\nline2"\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { id: "ga:a", name: "Hello, world" });
  assert.equal(rows[1].name, "line1\nline2");
});

test('parseCsv handles "" escapes', () => {
  const rows = parseCsv('id,q\nx,"a ""quoted"" word"\n');
  assert.equal(rows[0].q, 'a "quoted" word');
});

test("multi splits on ; or |", () => {
  assert.deepEqual(multi("a; b |c"), ["a", "b", "c"]);
  assert.deepEqual(multi(""), []);
});

const g = loadGraph();

test("listNodes q matches name/id substring", () => {
  const hits = listNodes(g, { q: "loneliness" });
  assert.ok(hits.some((n) => n.id === "ga:loneliness"));
  assert.ok(listNodes(g, { q: "ga:fall" }).some((n) => n.id === "ga:fall-rate"));
});

test("listClaims filters by certainty and object", () => {
  const high = listClaims(g, { certainty: "high" });
  assert.ok(high.length > 0 && high.every((c) => c.certainty === "high"));
  const toFalls = listClaims(g, { object: "ga:fall-rate" });
  assert.ok(toFalls.length >= 3 && toFalls.every((c) => c.object === "Fall rate (accidental falls)"));
});
