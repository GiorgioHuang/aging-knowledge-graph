import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/http.ts";

const server = createServer();
let base = "";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://localhost:${port}`;
});
after(() => server.close());

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test("GET /health reports counts", async () => {
  const { status, body } = await get("/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.counts.nodes, 38);
  assert.equal(body.counts.claims, 36);
});

test("GET /queries is self-describing", async () => {
  const { body } = await get("/queries");
  const names = body.map((d: { name: string }) => d.name);
  assert.ok(names.includes("what_affects"));
  assert.ok(names.includes("conflicts"));
});

test("GET /query/what_affects returns cited, high-certainty exercise", async () => {
  const { status, body } = await get("/query/what_affects?object=ga:fall-rate&protective=true");
  assert.equal(status, 200);
  const ex = body.find((r: { subject: string }) => r.subject === "Exercise (physical activity)");
  assert.ok(ex && ex.certainty === "high" && ex.sources.length > 0);
});

test("GET /query/conflicts returns the vitamin D contradiction", async () => {
  const { body } = await get("/query/conflicts");
  assert.equal(body.length, 2);
});

test("GET /nodes/:id fetches a node; unknown id 404s", async () => {
  const ok = await get("/nodes/ga:loneliness");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.type, "outcome");
  const missing = await get("/nodes/ga:nope");
  assert.equal(missing.status, 404);
});

test("GET /query/search returns ranked semantic hits (offline path)", async () => {
  const { status, body } = await get("/query/search?q=" + encodeURIComponent("falling in the elderly") + "&k=3");
  assert.equal(status, 200);
  assert.ok(Array.isArray(body) && body.length > 0);
  assert.ok(body[0].score >= body[body.length - 1].score);
  assert.ok("ownerType" in body[0] && "id" in body[0]);
});

test("POST /mcp handles JSON-RPC tools/list and tools/call", async () => {
  const list = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }).then((r) => r.json());
  assert.ok(list.result.tools.some((t: { name: string }) => t.name === "graceage_search"));

  const call = await fetch(base + "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "graceage_conflicts", arguments: {} } }),
  }).then((r) => r.json());
  const payload = JSON.parse(call.result.content[0].text);
  assert.equal(payload.length, 2);
});

test("unknown query 404s with available list", async () => {
  const { status, body } = await get("/query/bogus");
  assert.equal(status, 404);
  assert.ok(Array.isArray(body.available));
});
