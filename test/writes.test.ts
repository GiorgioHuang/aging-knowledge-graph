import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/http.ts";

// Hermetic: no DATABASE_URL, so writes must be rejected with 503 (read-only),
// and auth must be enforced when a token is configured. No DB is touched.
const server = createServer();
let base = "";

before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("writes are read-only without a database (503)", async () => {
  delete process.env.CURATOR_TOKEN;
  assert.equal((await post("/nodes", { id: "ga:x", type: "outcome", name: "X" })).status, 503);
});

test("update/delete are also read-only without a database (503)", async () => {
  const put = await fetch(base + "/nodes/ga:exercise", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(put.status, 503);
  const del = await fetch(base + "/nodes/ga:exercise", { method: "DELETE" });
  assert.equal(del.status, 503);
});

test("bulk import is read-only without a database (503)", async () => {
  const r = await post("/import", { nodes: [] });
  assert.equal(r.status, 503);
});

test("PubMed lookup is token-gated (403 when no token)", async () => {
  delete process.env.CURATOR_TOKEN;
  const res = await fetch(base + "/pubmed/25910392");
  assert.equal(res.status, 403);
});

test("GET /nodes?q= filters; /claims?certainty= filters", async () => {
  const nodes = await (await fetch(base + "/nodes?q=loneliness")).json();
  assert.ok(nodes.some((n: { id: string }) => n.id === "ga:loneliness"));
  const claims = await (await fetch(base + "/claims?certainty=high")).json();
  assert.ok(claims.length > 0 && claims.every((c: { certainty: string }) => c.certainty === "high"));
});

test("GET /nodes/:id/detail returns claims, evidence, neighbours", async () => {
  const d = await (await fetch(base + "/nodes/ga:loneliness/detail")).json();
  assert.equal(d.node.id, "ga:loneliness");
  // loneliness -> depression / mortality / dementia (outgoing)
  assert.ok(d.outgoing.some((c: { other: { id: string } }) => c.other.id === "ga:depression"));
  assert.ok(d.neighbours.some((n: { id: string }) => n.id === "ga:mortality"));
  const withEv = d.outgoing.find((c: { evidence: unknown[] }) => c.evidence.length > 0);
  assert.ok(withEv && withEv.evidence[0].source_id);
  const missing = await fetch(base + "/nodes/ga:nope/detail");
  assert.equal(missing.status, 404);
});

test("GET /graph returns nodes and edges with ids", async () => {
  const g = await (await fetch(base + "/graph")).json();
  assert.equal(g.nodes.length, 38);
  assert.equal(g.edges.length, 36);
  const ex = g.edges.find((e: { id: string }) => e.id === "fc-3");
  assert.equal(ex.source, "ga:exercise");
  assert.equal(ex.target, "ga:fall-rate");
});

test("GET /ontology exposes the controlled vocabularies", async () => {
  const o = await (await fetch(base + "/ontology")).json();
  assert.ok(o.nodeTypes.includes("outcome"));
  assert.ok(o.relationshipTypes.includes("reduces_risk_of"));
});

test("GET /admin serves the curation UI", async () => {
  const res = await fetch(base + "/admin");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.match(await res.text(), /Curation/);
});

test("/ serves the home graph explorer; /api lists read and write routes", async () => {
  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") || "", /text\/html/);
  assert.match(await home.text(), /Healthy Aging Knowledge/);
  const r = await (await fetch(base + "/api")).json();
  assert.ok(r.write.includes("POST /claims"));
});
