# 13 · API & MCP Surface

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

The graph is exposed through two **read-only**, **zero-dependency** surfaces so
other GraceAge pillars (*OS*, *Companion*) and AI agents can consume it:

1. an **HTTP REST API** (`src/http.ts`), and
2. an **MCP server** (`src/mcp.ts`, stdio JSON-RPC).

Both are driven by one shared **query registry** (`src/registry.ts`) over the
curated in-memory graph (`seed/`), so REST, MCP, and the CLI always expose the
same queries. Writes are out of scope here (they arrive with the V1 curation UI).

## 中文摘要

图谱通过两个**只读、零依赖**的面对外开放，供生态内其他支柱（OS、Companion）与 AI 代理调用：
**HTTP REST API**（`src/http.ts`）与 **MCP server**（`src/mcp.ts`，stdio JSON-RPC）。
二者由同一个**查询注册表**（`src/registry.ts`）驱动，因此 REST / MCP / CLI 暴露的查询始终一致。
本轮只读；写操作随 V1 策展 UI 到来。

启动：`npm run serve`（REST，默认端口 8787）/ `npm run mcp`（MCP stdio）。无需安装依赖（Node ≥ 22.18）。

---

## Run

```bash
npm run serve   # REST API on http://localhost:${PORT:-8787}
npm run mcp     # MCP server on stdio (JSON-RPC, newline-delimited)
```

## REST API (GET, JSON)

| Route | Returns |
|-------|---------|
| `/health` | status + counts |
| `/queries` | self-describing list of queries (name, description, JSON Schema) |
| `/query/:name?arg=…` | result of a registry query |
| `/nodes?type=&domain=&q=` | nodes, optionally filtered (q = name/alias/id substring) |
| `/nodes/:id` | a single node (404 if unknown) |
| `/nodes/:id/detail` | a node + its claims (with evidence) + neighbours |
| `/graph` | nodes + edges (ids) for visualization |
| `/claims?type=&status=` | claims (as answer rows), optionally filtered |
| `/` | index of routes |

Example:

```bash
curl "localhost:8787/query/what_affects?object=ga:fall-rate&protective=true"
# -> [{ subject: "Exercise (physical activity)", relationship: "reduces_risk_of",
#       certainty: "high", sources: ["DOI:10.1002/14651858.CD012424.pub2", ...] }, ...]
```

## MCP tools

Each registry query is an MCP tool named `graceage_<name>`. The server implements
`initialize`, `tools/list`, and `tools/call`; `tools/call` returns the result as
JSON text content. Two transports share the same handler (`src/mcp-core.ts`):

- **stdio** (`npm run mcp`) — newline-delimited JSON-RPC; for local agents.
- **HTTP** — `POST /mcp` on the REST server with a JSON-RPC body; for online
  agents (e.g. against the Cloud Run URL).

```bash
curl -X POST "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"graceage_search","arguments":{"q":"loneliness"}}}'
```

Example client config (stdio):

```json
{
  "mcpServers": {
    "graceage-knowledge": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/mcp.ts"]
    }
  }
}
```

## Queries (shared by REST & MCP)

| name / `graceage_<name>` | args | answers (docs/08) |
|--------------------------|------|-------------------|
| `what_affects` | `object`, `protective?` | CQ1/CQ9 — what affects an outcome, with certainty + citations |
| `high_certainty_about` | `node` | CQ14 — High-certainty claims on a topic |
| `conflicts` | — | CQ13 — where evidence conflicts |
| `gaps` | — | CQ16/24 — unverified/placeholder claims |
| `knowledge_gaps` | `topic?` | first-class knowledge_gap nodes + the research questions they generate; with a topic, also weak/unverified evidence touching it |
| `for_population` | `population` | CQ18 — claims scoped to a population |
| `neighbourhood` | `node` | CQ20/21 — a node's cross-domain neighbourhood |
| `comparative` | — | CQ22 — comparative-effectiveness claims |
| `path` | `from`, `to`, `max_hops?` | shortest connecting chain between two nodes (undirected over claim edges) — traces Problem→Theory→Mechanism→Intervention→Outcome→Measurement in one call; each hop carries relationship, certainty, status + sources |
| `search` | `q`, `k?`, `owner?` | natural-language semantic search (see [`14`](14-semantic-search.md)) |
| `get_node` | `id` | fetch one node |
| `node_detail` | `id` | a node's outgoing/incoming claims (with evidence) + neighbours (also `GET /nodes/:id/detail`) |
| `list_nodes` | `type?`, `domain?` | browse nodes |
| `list_claims` | `type?`, `status?` | browse claims |

## Design notes

- **Read-only.** No write endpoints/tools yet (V1 curation UI).
- **Zero dependencies.** `node:http` + a hand-rolled stdio JSON-RPC loop; no
  `express`, no MCP SDK — keeps the project installable-free and testable
  in-container (`test/http.test.ts`, `test/mcp.test.ts`).
- **Swappable backend.** With no `DATABASE_URL` the handlers run over the
  in-memory seed graph; set `DATABASE_URL` (Neon) and the same surface serves
  from Postgres + pgvector — no change to REST/MCP. See
  [`14-semantic-search.md`](14-semantic-search.md).
