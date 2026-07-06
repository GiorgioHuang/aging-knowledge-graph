# 14 · Semantic Search & Backend

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

Natural-language search over the graph, plus the **Neon (Postgres + pgvector)**
backend. There are two interchangeable backends behind the same query layer:

- **Offline (default, zero-dep):** no `DATABASE_URL` → the graph loads from
  `seed/` and search runs in-memory with a deterministic offline embedder. Runs
  and tests anywhere, no install, no API key.
- **Neon (production):** `DATABASE_URL` set → the graph loads from Postgres and
  search is pushed down to **pgvector** (`vector <=> query`).

`search` is exposed everywhere the other queries are — REST, MCP, CLI (it joined
the shared registry in [`13-api.md`](13-api.md)).

## 中文摘要

对图谱的**自然语言检索**，外加 **Neon (Postgres + pgvector)** 后端。同一查询层下有两个可互换后端：
- **离线（默认、零依赖）**：未设 `DATABASE_URL` 时，从 `seed/` 加载，用确定性的离线嵌入器在内存里检索。无需安装、无需 key，随处可跑可测。
- **Neon（生产）**：设了 `DATABASE_URL` 时，从 Postgres 加载，检索下推到 **pgvector**（`vector <=> 查询`）。

`search` 已接入共享注册表，REST / MCP / CLI 都能用。嵌入维度默认 **256**（离线嵌入器），换神经
provider 时需与其维度一致（如 OpenAI text-embedding-3-small 为 1536）。

## How it works

- **What gets embedded:** each node (name + aliases + domains) and each claim
  (a sentence like "Loneliness → Depressive disorder, increase") so claims are
  findable by plain language.
- **Embedder (`src/embeddings.ts`):** the default `HashingEmbedder` is a
  dependency-free, deterministic vectorizer (word tokens + character 3-grams
  hashed into a 256-dim L2-normalized vector). Good enough to demonstrate
  meaning-based ranking offline; a neural provider replaces it for quality.
- **Ranking:** cosine similarity (`1 - (vector <=> q)` in pgvector).

## Use it

```bash
# offline (no setup)
npm run query search "preventing falls in older people"
npm run serve   # then: curl "localhost:8787/query/search?q=loneliness&k=5"

# Neon backend
export DATABASE_URL="postgres://USER:PASSWORD@EP.REGION.aws.neon.tech/DB?sslmode=require"
npm install
npm run db:setup                       # migrate 0001+0002, load seed + embeddings, sample search
npm run db:search "falling in the elderly"
```

> Set `DATABASE_URL` as an environment variable/secret — never commit it. With it
> set, the REST/MCP/CLI all transparently use Neon + pgvector.

### Connectivity requirements

`db:setup` uses the **`@neondatabase/serverless` driver over HTTPS (443)** — the
Postgres wire port (5432) is often blocked in sandboxed environments, and the
HTTP driver avoids it. (A psql/5432 variant is kept at `npm run db:setup:psql`.)

In environments with an **egress allowlist** (e.g. Claude Code on the web with a
restricted network policy), the Neon **API host must be allowlisted** — for a
project on `…pooler.c-N.REGION.aws.neon.tech`, allow
`api.c-N.REGION.aws.neon.tech` (the SQL-over-HTTP endpoint). Otherwise the driver
returns `HTTP 403 Host not in allowlist`. Add it in the environment's network
egress settings, or run `db:setup` from an environment with open egress.

## Using a neural embedding provider (optional)

The default is offline. To use real neural embeddings, set:

```bash
EMBEDDINGS_PROVIDER=openai
EMBEDDINGS_API_KEY=sk-...
EMBEDDINGS_MODEL=text-embedding-3-small   # 1536-dim
EMBEDDINGS_DIM=1536                       # must match db/migrations/0002 vector(N)
```

Anthropic recommends **Voyage AI** for embeddings; any OpenAI-compatible
`/v1/embeddings` endpoint works via `EMBEDDINGS_URL`. Re-run `npm run db:setup`
after changing the dimension (the `embedding.vector` column must match).

## Status & honesty

- The **offline path is fully verified in-container** (`test/embeddings.test.ts`,
  `test/http.test.ts`).
- The **Neon/pgvector path** is exercised only when `DATABASE_URL` is provided
  (the project ships the migration, loader, and `db:setup` script for it).

## Next: RAG

This delivers natural-language **retrieval with scores**. The next step is
**RAG answer synthesis** — retrieve top claims + evidence, then have the latest
**Claude** model write a grounded, cited answer. That is a separate round; the
retrieval layer here is its foundation.
