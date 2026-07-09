// Healthy Aging Knowledge — zero-dependency REST API over the curated graph.
// Read-only. Powered by the shared registry (registry.ts).
//   node --experimental-strip-types src/http.ts          # listens on $PORT or 8787
import { createServer as nodeCreateServer, type Server, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadGraph } from "./model.ts";
import { loadGraphAsync } from "./store.ts";
import { isDbConfigured } from "./db.ts";
import { ensureProvisioned } from "./bootstrap.ts";
import { registry, byName } from "./registry.ts";
import { handleRpc, type RpcRequest } from "./mcp-core.ts";
import {
  createNode, createClaim, createEvidence,
  updateNode, updateClaim, deleteNode, deleteClaim, deleteEvidence,
} from "./writes.ts";
import { importBatch, importCsv, fetchPubmed } from "./import.ts";
import { reviewQueue, reviewQueueCount, reviewStats, decideClaim } from "./review.ts";
import { repairClaim } from "./reviewer.ts";
import { dedupClaims } from "./dedup.ts";
import { requeueFailedTopics } from "./topics.ts";
import { agentModelConfig, setAgentModel } from "./settings.ts";
import { validateContact, saveContactMessage, listContactMessages } from "./contact.ts";
import { notifyContact, telegramConfigured } from "./notify.ts";
import { answerQuestion } from "./ask.ts";
import { isLlmConfigured } from "./llm.ts";
import { graphClaimQuality } from "./quality.ts";
import { saveAskLog, listAskLogs } from "./asklog.ts";
import { processGapQuestions } from "./gaptopics.ts";
import { mapUnmappedNodes, listUnmappedNodes, diagnoseNode } from "./codemap.ts";
import { AGENTS, type AgentName } from "./models.ts";
import * as Q from "./queries.ts";
import type { Graph } from "./types.ts";

const here = dirname(fileURLToPath(import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
}

/** The token presented on a request, via `Authorization: Bearer <t>` or HTTP
 *  Basic auth (the password half). Basic support lets the management UI reuse
 *  the browser's cached login credentials — no separate token field needed. */
function presentedToken(req: IncomingMessage): string | null {
  const h = String(req.headers["authorization"] ?? "");
  if (h.startsWith("Bearer ")) return h.slice(7);
  if (h.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
      return decoded.slice(decoded.indexOf(":") + 1);
    } catch { return null; }
  }
  return null;
}

/** True when the request carries the configured CURATOR_TOKEN (Bearer or Basic). */
function hasCuratorToken(req: IncomingMessage): boolean {
  const token = process.env.CURATOR_TOKEN;
  return Boolean(token) && presentedToken(req) === token;
}

/** Gate the management UIs (/admin, /review) so they are not publicly browsable.
 *  Serves openly when no CURATOR_TOKEN is configured (local/dev); otherwise
 *  challenges with HTTP Basic auth. The browser then caches those credentials
 *  and attaches them to the page's API calls too, so one login covers everything. */
function requireManagementAuth(req: IncomingMessage, res: import("node:http").ServerResponse): boolean {
  if (!process.env.CURATOR_TOKEN) return true; // no token set → nothing to protect (dev)
  if (hasCuratorToken(req)) return true;
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="Healthy Aging Knowledge management", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
  });
  res.end("Management area — authentication required.");
  return false;
}

// Coarse per-IP rate limiter for the LLM-backed /ask endpoint (cost/abuse
// guard). Per-instance and in-memory — Cloud Run may run several instances, so
// this is a deterrent, not a hard quota. Tunable via ASK_RATE_PER_MIN.
const askHits = new Map<string, number[]>();
function askAllowed(ip: string): boolean {
  const max = Number(process.env.ASK_RATE_PER_MIN) || 6;
  const now = Date.now();
  if (askHits.size > 5000) askHits.clear(); // bound memory on churn
  const recent = (askHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= max) { askHits.set(ip, recent); return false; }
  recent.push(now);
  askHits.set(ip, recent);
  return true;
}

export interface ServerState {
  graph: Graph;
  backend: "seed" | "neon";
  reload?: () => Promise<void>;
  dbError?: string; // why the DB is unavailable, when configured but not connected
}

export function createServer(state: ServerState = { graph: loadGraph(), backend: "seed" }): Server {
  return nodeCreateServer(async (req, res) => {
    try {
      const g = state.graph;
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const q = url.searchParams;

      // MCP over HTTP: a single JSON-RPC request per POST.
      if (path === "/mcp" && req.method === "POST") {
        let rpc: RpcRequest;
        try {
          rpc = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        }
        const out = await handleRpc(g, rpc);
        if (!out) { res.writeHead(202); return res.end(); }
        return send(res, 200, out);
      }

      // ---- writes (token-gated, Neon-backed): POST create, PUT update, DELETE ----
      const wm = path.match(/^\/(nodes|claims|evidence)(?:\/(.+))?$/);
      if (wm && (req.method === "POST" || req.method === "PUT" || req.method === "DELETE")) {
        const resource = wm[1];
        const rid = wm[2] ? decodeURIComponent(wm[2]) : "";
        if (!isDbConfigured()) return send(res, 503, { error: "writes require a database (DATABASE_URL); this instance is read-only" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "writes are disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });

        let result;
        if (req.method === "DELETE") {
          if (!rid) return send(res, 400, { error: "id required in path" });
          result = resource === "nodes" ? await deleteNode(rid) : resource === "claims" ? await deleteClaim(rid) : await deleteEvidence(rid);
        } else {
          let body: Record<string, unknown>;
          try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
          if (req.method === "POST") {
            if (rid) return send(res, 400, { error: "POST to the collection (no id in path)" });
            result = resource === "nodes" ? await createNode(body) : resource === "claims" ? await createClaim(body) : await createEvidence(body);
          } else { // PUT
            if (!rid) return send(res, 400, { error: "id required in path for PUT" });
            if (resource === "nodes") result = await updateNode(rid, body);
            else if (resource === "claims") result = await updateClaim(rid, body);
            else return send(res, 405, { error: "PUT not supported for evidence; DELETE + POST instead" });
          }
        }
        if (!result.ok) return send(res, result.status, { errors: result.errors });
        if (state.reload) await state.reload();
        return send(res, req.method === "POST" ? 201 : 200, result.data);
      }

      // ---- bulk import (token-gated, Neon-backed) ----
      if ((path === "/import" || path === "/import/csv") && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "import requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "writes are disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const text = await readBody(req);
        let summary;
        if (path === "/import/csv") {
          const kind = q.get("kind");
          if (kind !== "nodes" && kind !== "claims") return send(res, 400, { error: "use ?kind=nodes or ?kind=claims" });
          summary = await importCsv(kind, text);
        } else {
          let body: { nodes?: unknown[]; claims?: unknown[]; evidence?: unknown[] };
          try { body = JSON.parse(text || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
          summary = await importBatch(body);
        }
        if (state.reload) await state.reload();
        return send(res, 200, summary);
      }

      // ---- PubMed citation lookup (token-gated helper; external fetch) ----
      if (path.startsWith("/pubmed/") && req.method === "GET") {
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "lookup disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const r = await fetchPubmed(decodeURIComponent(path.slice("/pubmed/".length)));
        return r.ok ? send(res, 200, r.data) : send(res, r.status, { error: r.error });
      }

      // ---- per-agent model config (read open; changes token-gated) ----
      if (path === "/agents/config" && req.method === "GET") {
        return send(res, 200, await agentModelConfig());
      }
      if (path === "/agents/config" && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "changing models requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "model changes are disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        let body: Record<string, unknown>;
        try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
        for (const a of AGENTS) {
          if (a in body) {
            const v = body[a];
            await setAgentModel(a as AgentName, v == null || v === "" ? null : String(v));
          }
        }
        return send(res, 200, await agentModelConfig());
      }

      // ---- maintenance: merge duplicate edges (token-gated; ?apply=true) ----
      if (path === "/admin/dedup" && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "dedup requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "dedup is disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const apply = q.get("apply") === "true";
        const r = await dedupClaims({ apply });
        if (apply && state.reload) await state.reload();
        return send(res, 200, r);
      }

      // ---- maintenance: re-queue failed topics (token-gated) ----
      if (path === "/admin/requeue-failed" && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        return send(res, 200, { requeued: await requeueFailedTopics() });
      }

      // ---- public read-only browse page (clickable citations) ----
      if (path === "/browse" || path === "/browse.html") {
        const html = readFileSync(join(here, "..", "public", "browse.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      // ---- project about / introduction page ----
      if (path === "/about" || path === "/about.html") {
        const html = readFileSync(join(here, "..", "public", "about.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      // ---- grounded Q&A: retrieve claims + evidence, LLM answers with citations ----
      if (path === "/ask" && req.method === "POST") {
        if (!isLlmConfigured()) return send(res, 503, { error: "Q&A is not configured (ANTHROPIC_API_KEY not set)" });
        let body: Record<string, unknown> = {};
        try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
        const question = typeof body.question === "string" ? body.question.trim() : "";
        if (!question) return send(res, 400, { error: "question is required" });
        if (question.length > 500) return send(res, 400, { error: "question is too long (max 500 characters)" });
        const xff = String(req.headers["x-forwarded-for"] ?? "");
        const ip = (xff.split(",")[0].trim() || req.socket.remoteAddress || "").slice(0, 64);
        const ua = String(req.headers["user-agent"] ?? "").slice(0, 300);
        if (!askAllowed(ip)) return send(res, 429, { error: "too many questions — please wait a minute and try again" });
        const started = Date.now();
        try {
          const result = await answerQuestion(g, question);
          // Best-effort log (awaited: Cloud Run throttles CPU after the response).
          await saveAskLog({
            question, answer: result.answer, model: result.model || undefined, ok: true,
            claimIds: result.claims.map((c) => c.id), citations: result.citations,
            numClaims: result.claims.length, ip, userAgent: ua, latencyMs: Date.now() - started,
            inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens,
          });
          return send(res, 200, result);
        } catch (e) {
          const msg = (e as Error).message;
          await saveAskLog({ question, ok: false, error: msg, ip, userAgent: ua, latencyMs: Date.now() - started });
          return send(res, 502, { error: `the answering model failed: ${msg}` });
        }
      }
      // ---- Q&A log: maintainer only (token-gated) ----
      if (path === "/ask/log" && req.method === "GET") {
        if (!isDbConfigured()) return send(res, 503, { error: "the Q&A log requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const limit = Number(q.get("limit") ?? 100);
        return send(res, 200, await listAskLogs(Number.isFinite(limit) ? limit : 100));
      }
      // ---- close the loop: triage answerable-gap questions into topics (token-gated) ----
      if (path === "/admin/gap-topics" && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "requires a database (DATABASE_URL)" });
        if (!isLlmConfigured()) return send(res, 503, { error: "requires ANTHROPIC_API_KEY (the relevance judge)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        try {
          return send(res, 200, await processGapQuestions({}));
        } catch (e) {
          return send(res, 502, { error: `gap triage failed: ${(e as Error).message}` });
        }
      }

      // ---- standards mapping: explain why one node did/didn't get a code ----
      if (path === "/admin/node-codes-preview" && req.method === "GET") {
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const node = Q.getNode(g, decodeURIComponent(q.get("id") ?? ""));
        if (!node) return send(res, 404, { error: "unknown node" });
        try {
          return send(res, 200, await diagnoseNode(node, { llm: q.get("llm") !== "0" && isLlmConfigured() }));
        } catch (e) {
          return send(res, 502, { error: `preview failed: ${(e as Error).message}` });
        }
      }

      // ---- standards mapping: list eligible nodes that still have no code ----
      if (path === "/admin/unmapped-nodes" && req.method === "GET") {
        if (!isDbConfigured()) return send(res, 503, { error: "requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        try {
          return send(res, 200, await listUnmappedNodes({ limit: Number(q.get("limit")) || 500 }));
        } catch (e) {
          return send(res, 502, { error: `listing failed: ${(e as Error).message}` });
        }
      }

      // ---- standards mapping: attach open CURIEs (MONDO/HP/GO/ChEBI/FoodOn/MeSH)
      //      to nodes by resolving their names against OLS/MeSH (no LLM). ----
      if (path === "/admin/map-codes" && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "requires a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        let body: Record<string, unknown> = {};
        try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
        try {
          // reset clears the checked flag once (first round); remap strips &
          // re-resolves each visited node every round. `force` sets both (legacy).
          const out = await mapUnmappedNodes({
            limit: Number(body.limit) || 25,
            reset: Boolean(body.reset ?? body.force),
            remap: Boolean(body.remap ?? body.force),
            llm: body.llm !== false,
          });
          if (state.reload) await state.reload();
          return send(res, 200, out);
        } catch (e) {
          return send(res, 502, { error: `code mapping failed: ${(e as Error).message}` });
        }
      }

      // ---- contact form: public submit (stored in Postgres) ----
      if (path === "/contact" && req.method === "POST") {
        let body: Record<string, unknown> = {};
        try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
        // Honeypot: bots fill hidden fields humans never see. Pretend success so
        // they don't learn to adapt, but store nothing.
        if (typeof body.website === "string" && body.website.trim() !== "") return send(res, 200, { ok: true });
        const v = validateContact(body);
        if (!v.ok) return send(res, 400, { error: v.error });
        if (!isDbConfigured()) return send(res, 503, { error: "the contact form requires a database (DATABASE_URL)" });
        try {
          const ua = String(req.headers["user-agent"] ?? "").slice(0, 300);
          // Client IP: behind Cloud Run's proxy the real client is the first hop
          // in X-Forwarded-For; fall back to the socket address locally.
          const xff = String(req.headers["x-forwarded-for"] ?? "");
          const ip = (xff.split(",")[0].trim() || req.socket.remoteAddress || "").slice(0, 64);
          const r = await saveContactMessage({ ...v.value, userAgent: ua });
          // Best-effort push to Telegram. Awaited (Cloud Run throttles CPU after
          // the response) but never fails the request — the message is saved.
          await notifyContact({ id: r.id, ...v.value, userAgent: ua, ip });
          return send(res, 200, { ok: true, id: r.id });
        } catch {
          return send(res, 500, { error: "could not save your message — please try again later" });
        }
      }
      // ---- contact inbox: maintainer only (token-gated) ----
      if (path === "/contact/messages" && req.method === "GET") {
        if (!isDbConfigured()) return send(res, 503, { error: "contact messages require a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const limit = Number(q.get("limit") ?? 100);
        return send(res, 200, await listContactMessages(Number.isFinite(limit) ? limit : 100));
      }

      // ---- human review console (management UI — not publicly browsable) ----
      if (path === "/review" || path === "/review.html") {
        if (!requireManagementAuth(req, res)) return;
        const html = readFileSync(join(here, "..", "public", "review.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      if (path === "/review/queue" && req.method === "GET") {
        if (!isDbConfigured()) return send(res, 503, { error: "the review queue requires a database (DATABASE_URL)" });
        const limit = Number(q.get("limit") ?? 50);
        const offset = Number(q.get("offset") ?? 0);
        const status = q.get("status") ?? undefined;
        const search = q.get("q") ?? undefined;
        const [items, total] = await Promise.all([
          reviewQueue({ status, limit: Number.isFinite(limit) ? limit : 50, offset: Number.isFinite(offset) ? offset : 0, q: search }),
          reviewQueueCount(status ?? "needs_refinement", search ?? ""),
        ]);
        return send(res, 200, { items, total, limit: Number.isFinite(limit) ? limit : 50, offset: Number.isFinite(offset) ? offset : 0 });
      }
      if (path === "/review/stats" && req.method === "GET") {
        if (!isDbConfigured()) return send(res, 503, { error: "review stats require a database (DATABASE_URL)" });
        return send(res, 200, await reviewStats());
      }
      const rdm = path.match(/^\/review\/(.+)\/(approve|reject|repair)$/);
      if (rdm && req.method === "POST") {
        if (!isDbConfigured()) return send(res, 503, { error: "review actions require a database (DATABASE_URL)" });
        const token = process.env.CURATOR_TOKEN;
        if (!token) return send(res, 403, { error: "review actions are disabled (CURATOR_TOKEN not set)" });
        if (!hasCuratorToken(req)) return send(res, 401, { error: "unauthorized" });
        const id = decodeURIComponent(rdm[1]);
        if (rdm[2] === "repair") {
          const r = await repairClaim(id);
          if (!r) return send(res, 404, { error: `claim '${id}' not found` });
          if (state.reload) await state.reload();
          return send(res, 200, r);
        }
        let body: { certainty?: string; note?: string } = {};
        try { body = JSON.parse((await readBody(req)) || "{}"); } catch { return send(res, 400, { error: "invalid JSON" }); }
        const result = await decideClaim(id, rdm[2] as "approve" | "reject", body);
        if (!result.ok) return send(res, result.status, { errors: result.errors });
        if (state.reload) await state.reload();
        return send(res, 200, result.data);
      }

      // ---- curation UI (management UI — not publicly browsable) ----
      if (path === "/admin" || path === "/admin.html") {
        if (!requireManagementAuth(req, res)) return;
        const html = readFileSync(join(here, "..", "public", "admin.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      if (/^\/(logo|logo-dark|logo-mark|favicon)\.svg$/.test(path) && req.method === "GET") {
        const svg = readFileSync(join(here, "..", "public", path.slice(1)), "utf8");
        res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=3600" });
        return res.end(svg);
      }
      if (path === "/ontology") return send(res, 200, g.ontology);
      if (path === "/graph") {
        // Context links: population / mechanism (claim qualifiers) and paper
        // (evidence source) aren't claim subject/object, so they have no concept
        // edge and would float. Connect each to the subject+object of the claim it
        // qualifies/supports. The UI hides these context nodes by default and shows
        // them (with these dashed links) on toggle, so the concept graph stays clean.
        const contextEdges: { source: string; target: string; kind: string }[] = [];
        const seen = new Set<string>();
        const link = (sourceId: string | undefined, conceptId: string | undefined, kind: string) => {
          if (!sourceId || !conceptId || !g.nodes.has(sourceId) || !g.nodes.has(conceptId)) return;
          const key = `${sourceId}->${conceptId}`;
          if (seen.has(key)) return;
          seen.add(key);
          contextEdges.push({ source: sourceId, target: conceptId, kind });
        };
        for (const c of g.claims.values()) {
          if (c.population) { link(c.population, c.subject, "population"); link(c.population, c.object, "population"); }
          if (c.mechanism) { link(c.mechanism, c.subject, "mechanism"); link(c.mechanism, c.object, "mechanism"); }
        }
        for (const e of g.evidence.values()) {
          if (!e.source_node) continue;
          const c = g.claims.get(e.claim);
          if (c) { link(e.source_node, c.subject, "paper"); link(e.source_node, c.object, "paper"); }
        }
        // Claims that are party to a contradiction (claim_relation 'contradicts').
        const conflicted = new Set<string>();
        for (const ct of g.contradictions) { conflicted.add(ct.subject_claim); conflicted.add(ct.object_claim); }
        return send(res, 200, {
          nodes: [...g.nodes.values()].map((n) => ({ id: n.id, name: n.name, type: n.type, domains: n.domains ?? [] })),
          edges: [...g.claims.values()].map((c) => ({
            id: c.id, type: c.type, source: c.subject, target: c.object,
            direction: c.direction, certainty: c.certainty, status: c.status, dose: c.dose, comparator: c.comparator,
            conflict: conflicted.has(c.id) || undefined,
            quality: graphClaimQuality(g, c),
          })),
          contextEdges,
        });
      }

      if (path === "/" || path === "/index.html") {
        const html = readFileSync(join(here, "..", "public", "home.html"), "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(html);
      }
      if (path === "/api") {
        return send(res, 200, {
          service: "graceage-knowledge",
          backend: state.backend,
          ui: { home: "/", browse: "/browse", about: "/about" },
          management: { curation: "/admin", review: "/review" }, // token-gated (HTTP Basic), not public
          read: ["/health", "/queries", "/query/:name", "/nodes", "/nodes/:id", "/claims", "/ontology", "/review/queue", "/review/stats", "/agents/config", "/contact/messages", "/ask/log", "POST /mcp"],
          write: ["POST /ask", "POST /nodes", "POST /claims", "POST /evidence", "POST /contact", "POST /review/:id/approve", "POST /review/:id/reject", "POST /review/:id/repair", "POST /agents/config", "POST /admin/dedup", "POST /admin/requeue-failed", "POST /admin/gap-topics", "POST /admin/map-codes"],
        });
      }
      if (path === "/health") {
        // db: "connected" when serving Neon; "error" when a DATABASE_URL is set
        // but the connection/provisioning failed (we fall back to seed); "not
        // configured" when no DATABASE_URL is present (e.g. local/offline).
        const db = !isDbConfigured() ? "not_configured" : state.backend === "neon" ? "connected" : "error";
        return send(res, 200, {
          status: "ok",
          backend: state.backend,
          db,
          ...(db === "error" ? { db_error: state.dbError ?? "database not reachable yet" } : {}),
          telegram: telegramConfigured() ? "configured" : "not_configured",
          llm: isLlmConfigured() ? "configured" : "not_configured",
          counts: { nodes: g.nodes.size, claims: g.claims.size, evidence: g.evidence.size, contradictions: g.contradictions.length },
        });
      }
      if (path === "/queries") {
        return send(res, 200, registry.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })));
      }
      if (path.startsWith("/query/")) {
        const name = decodeURIComponent(path.slice("/query/".length));
        const def = byName.get(name);
        if (!def) return send(res, 404, { error: `unknown query '${name}'`, available: [...byName.keys()] });
        const args: Record<string, unknown> = {};
        for (const [k, v] of q.entries()) args[k] = v;
        return send(res, 200, await def.run(g, args));
      }
      if (path === "/nodes") {
        return send(res, 200, Q.listNodes(g, { type: q.get("type") ?? undefined, domain: q.get("domain") ?? undefined, q: q.get("q") ?? undefined }));
      }
      if (path.startsWith("/nodes/") && path.endsWith("/detail")) {
        const id = decodeURIComponent(path.slice("/nodes/".length, -"/detail".length));
        const d = Q.nodeDetail(g, id);
        return d ? send(res, 200, d) : send(res, 404, { error: `unknown node '${id}'` });
      }
      if (path.startsWith("/nodes/")) {
        const id = decodeURIComponent(path.slice("/nodes/".length));
        const node = Q.getNode(g, id);
        return node ? send(res, 200, node) : send(res, 404, { error: `unknown node '${id}'` });
      }
      if (path === "/claims") {
        return send(res, 200, Q.listClaims(g, {
          type: q.get("type") ?? undefined, status: q.get("status") ?? undefined,
          certainty: q.get("certainty") ?? undefined, subject: q.get("subject") ?? undefined, object: q.get("object") ?? undefined,
        }));
      }
      return send(res, 404, { error: `not found: ${path}` });
    } catch (err) {
      return send(res, 500, { error: (err as Error).message });
    }
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Provision + load the graph from Neon and flip the server to the "neon"
 *  backend. Retries indefinitely with backoff so a transient DB outage doesn't
 *  strand the instance on seed; records the last error for /health. Never
 *  rejects (the loop only exits on success). */
async function warmToNeon(state: ServerState): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await ensureProvisioned({ force: false });
      state.graph = await loadGraphAsync();
      state.backend = "neon";
      state.dbError = undefined;
      console.log(`neon ready: ${r.provisioned ? `provisioned ${JSON.stringify(r.counts)}` : r.reason}`);
      return;
    } catch (err) {
      state.dbError = (err as Error).message;
      console.error(`neon init failed (attempt ${attempt}); serving seed meanwhile: ${(err as Error).message}`);
      await delay(Math.min(30_000, 2_000 * attempt));
    }
  }
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 8787);
  const state: ServerState = { graph: loadGraph(), backend: "seed" };

  // With a DB configured, prefer to come up ALREADY on Neon so a visitor never
  // briefly sees the tiny seed graph on a cold start. We wait up to
  // STARTUP_DB_WAIT_MS for the first warmup (Cloud Run's startup probe allows
  // far longer), but if Neon is slow/unreachable we start on seed anyway — so
  // the site is never down — while warmToNeon keeps retrying in the background
  // and flips to Neon the moment it succeeds.
  if (isDbConfigured()) {
    state.reload = async () => { state.graph = await loadGraphAsync(); state.backend = "neon"; };
    const warmMs = Number(process.env.STARTUP_DB_WAIT_MS ?? 20_000);
    await Promise.race([warmToNeon(state), delay(warmMs)]); // warmer keeps running if the wait wins
  }

  createServer(state).listen(port, () =>
    console.log(`Healthy Aging Knowledge API on http://localhost:${port} (backend: ${state.backend})`),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
