import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/http.ts";

// Hermetic: no DATABASE_URL → review queue/stats/actions are read-only (503),
// and actions are token-gated. The UI must still serve.
const server = createServer();
let base = "";
before(async () => { await new Promise<void>((r) => server.listen(0, r)); base = `http://localhost:${(server.address() as AddressInfo).port}`; });
after(() => server.close());

test("GET /review serves the review console", async () => {
  const res = await fetch(base + "/review");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.match(await res.text(), /Human Review/);
});

test("GET /browse serves the read-only browse page", async () => {
  const res = await fetch(base + "/browse");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.match(await res.text(), /Browse claims/);
});

test("GET /about serves the project about page", async () => {
  const res = await fetch(base + "/about");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  assert.match(await res.text(), /evidence-traceable knowledge graph/);
});

test("POST /contact validates input and requires a database", async () => {
  const post = (body: unknown) => fetch(base + "/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // missing message → 400 (validated before the DB is touched)
  assert.equal((await post({ name: "A" })).status, 400);
  // honeypot filled → pretend success, store nothing (200, no DB needed)
  const hp = await post({ message: "hi", website: "http://spam" });
  assert.equal(hp.status, 200);
  assert.equal((await hp.json()).ok, true);
  // valid message, but no DATABASE_URL in tests → 503
  assert.equal((await post({ message: "a real question about a claim" })).status, 503);
});

test("POST /ask is gated on ANTHROPIC_API_KEY (503 when unset)", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY; // isLlmConfigured() is read per-request
  try {
    const res = await fetch(base + "/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "what prevents falls?" }) });
    assert.equal(res.status, 503);
  } finally {
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
  }
});

test("management pages are gated by Basic auth when CURATOR_TOKEN is set", async () => {
  const prev = process.env.CURATOR_TOKEN;
  process.env.CURATOR_TOKEN = "s3cret-token";
  try {
    const denied = await fetch(base + "/admin");
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate") || "", /Basic/);
    const basic = "Basic " + Buffer.from("admin:s3cret-token").toString("base64");
    assert.equal((await fetch(base + "/admin", { headers: { authorization: basic } })).status, 200);
    assert.equal((await fetch(base + "/review")).status, 401); // review too
    assert.equal((await fetch(base + "/review", { headers: { authorization: "Bearer s3cret-token" } })).status, 200);
  } finally {
    if (prev === undefined) delete process.env.CURATOR_TOKEN; else process.env.CURATOR_TOKEN = prev;
  }
});

test("GET /ask/log needs a database (and is token-gated)", async () => {
  const res = await fetch(base + "/ask/log");
  assert.equal(res.status, 503); // no DB here; live it requires the curator token
});

test("GET /contact/messages needs a database (and is token-gated)", async () => {
  const res = await fetch(base + "/contact/messages");
  assert.equal(res.status, 503); // no DB here; live it requires the curator token
});

test("review queue/stats require a database (503)", async () => {
  assert.equal((await fetch(base + "/review/queue")).status, 503);
  assert.equal((await fetch(base + "/review/stats")).status, 503);
});

test("review actions require a database (503 before auth is even checked)", async () => {
  const r = await fetch(base + "/review/gc:abc/approve", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 503);
  const repair = await fetch(base + "/review/gc:abc/repair", { method: "POST" });
  assert.equal(repair.status, 503); // repair is a recognized action, also DB-gated
  const bad = await fetch(base + "/review/gc:abc/bogus", { method: "POST" });
  assert.equal(bad.status, 404); // only approve|reject|repair match the action route
});

test("GET /agents/config exposes per-agent models (env/default, no DB needed)", async () => {
  delete process.env.CURATOR_MODEL; delete process.env.REVIEWER_MODEL; delete process.env.ANTHROPIC_MODEL;
  const r = await (await fetch(base + "/agents/config")).json();
  assert.equal(r.default, "claude-opus-4-8");
  assert.equal(r.agents.length, 2);
  const curator = r.agents.find((a: { agent: string }) => a.agent === "curator");
  assert.equal(curator.model, "claude-opus-4-8");
  assert.equal(curator.source, "default");
  assert.ok(Array.isArray(r.known) && r.known.length > 0);
});

test("dedup endpoint requires a database (503)", async () => {
  const r = await fetch(base + "/admin/dedup?apply=false", { method: "POST", headers: { "content-type": "application/json" } });
  assert.equal(r.status, 503);
});

test("changing models requires a database (503)", async () => {
  const r = await fetch(base + "/agents/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ curator: "claude-haiku-4-5" }) });
  assert.equal(r.status, 503);
});

test("/api advertises the review console + endpoints", async () => {
  const r = await (await fetch(base + "/api")).json();
  assert.equal(r.management.review, "/review");
  assert.ok(r.read.includes("/review/queue"));
  assert.ok(r.write.includes("POST /review/:id/approve"));
});
