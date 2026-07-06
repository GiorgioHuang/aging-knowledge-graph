# Healthy Aging Knowledge

> **Building AI for Aging Well.**
> An open, evidence-traceable knowledge graph for healthy aging.
> **Live:** https://ack.icareu.ca

**Healthy Aging Knowledge** (this repository, `aging-knowledge-graph`) is the
**knowledge / "Core"** pillar of the **GraceAge** research ecosystem. Its goal
is to build the world's best **open knowledge graph about aging well** — a
connected, machine-readable, evidence-backed map of everything we know about
gerontology, health informatics, and healthy aging.

The repository began as **founding documents** (the Product Charter and
specification) and is now in **V0**: a Postgres schema, a curated, evidence-backed
seed graph, and a queryable API + validator — all verified. We defined *what to
build and why* before *how*, so an AI agent can develop the platform continuously
over the next ~3 years.

---

## 中文摘要

**Healthy Aging Knowledge** 是 **GraceAge** 研究生态系统中的 **知识 / 核心（Core）** 支柱。
目标是构建一个关于"健康老龄化（Aging Well）"的、世界一流的、开放的 **知识图谱**——
一张连接的、机器可读的、有证据支撑的知识地图，涵盖老年学、健康信息学与健康老龄化。

本仓库始于**奠基性文档**（产品宪章与规格说明），现已进入 **V0**：Postgres schema、
一份有证据支撑的策展种子图谱、以及可查询的 API 与校验器，且均已验证。先定义"做什么、为什么"，
再谈"怎么做"，以便 AI 编程代理在未来约三年里持续开发该平台。Node ≥ 22.18 直接运行；
离线路径零安装，唯一依赖（Neon 驱动）仅在设置 `DATABASE_URL` 时懒加载（见下方 Quickstart）。

---

## Documentation map / 文档导航

| Doc | Purpose | 用途 |
|-----|---------|------|
| [`docs/00-charter.md`](docs/00-charter.md) | Product Charter: vision, users, philosophy, success, non-goals | 产品宪章：愿景、用户、理念、成功标准、非目标 |
| [`docs/01-ecosystem-context.md`](docs/01-ecosystem-context.md) | The GraceAge ecosystem and how Knowledge connects | GraceAge 生态系统及知识图谱的连接方式 |
| [`docs/02-knowledge-model.md`](docs/02-knowledge-model.md) | The ontology: domains, node types, relationships, evidence | 本体模型：领域、节点类型、关系、证据 |
| [`docs/03-architecture.md`](docs/03-architecture.md) | Tech stack, data model, API-first design | 技术栈、数据模型、API 优先设计 |
| [`docs/04-ai-capabilities.md`](docs/04-ai-capabilities.md) | Extraction, linking, evidence scoring, search, RAG | 抽取、链接、证据评分、搜索、RAG |
| [`docs/05-data-sources.md`](docs/05-data-sources.md) | PubMed/WHO/CDC ingestion; FHIR & SNOMED CT mapping | 数据源接入；FHIR 与 SNOMED CT 映射 |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | Phased V0→V3 multi-year roadmap | 分阶段的多年路线图（V0→V3） |
| [`docs/07-development-principles.md`](docs/07-development-principles.md) | The "constitution" for contributors and the AI agent | 贡献者与 AI 代理的"开发宪法" |
| [`docs/08-competency-questions.md`](docs/08-competency-questions.md) | The questions the graph must answer (validates the model) | 图谱必须能回答的问题（用于验证模型） |
| [`docs/09-domain-skeleton.md`](docs/09-domain-skeleton.md) | Broad, shallow skeleton across all 15 domains | 覆盖全部 15 个领域的浅层骨架 |
| [`docs/10-standards-alignment.md`](docs/10-standards-alignment.md) | Open-first mapping of nodes to standard vocabularies | 节点到标准词表的开放优先映射 |
| [`docs/11-worked-example.md`](docs/11-worked-example.md) | Curated, cited falls/exercise chain — end-to-end model test | 已策展、可引用的跌倒/运动链——端到端模型测试 |
| [`docs/12-worked-example-social.md`](docs/12-worked-example-social.md) | Curated, cited social/loneliness/depression chain — model test | 已策展、可引用的社交/孤独/抑郁链——模型测试 |
| [`docs/13-api.md`](docs/13-api.md) | REST + MCP surface (how to query the graph) | REST 与 MCP 接口（如何查询图谱） |
| [`docs/14-semantic-search.md`](docs/14-semantic-search.md) | Semantic search + Neon/pgvector backend | 语义检索 + Neon/pgvector 后端 |
| [`docs/15-deployment.md`](docs/15-deployment.md) | Deploy to Cloud Run (calling Neon) | 部署到 Cloud Run（调用 Neon） |
| [`docs/16-curation.md`](docs/16-curation.md) | Write path & curation UI (token-gated) | 写路径与策展界面（令牌保护） |
| [`docs/17-agents.md`](docs/17-agents.md) | Curator + Reviewer agents (continuous, cited expansion) | 扩充与审核智能体（持续、可引用） |
| [`docs/glossary.md`](docs/glossary.md) | Bilingual glossary of key terms | 关键术语双语词汇表 |

---

## Status / 当前状态

- **Stage:** **Live.** Deployed on Cloud Run behind a custom domain, backed by
  Neon (Postgres + pgvector): **https://ack.icareu.ca** (e.g. `/health`,
  `/query/search?q=…`, `POST /mcp`). Postgres schema, curated seed graph (two
  evidence-backed cross-domain chains), validator, **REST + MCP** surface,
  **natural-language search**, and a **token-gated write path + `/admin` curation
  UI**. See [`docs/13-api.md`](docs/13-api.md),
  [`docs/14-semantic-search.md`](docs/14-semantic-search.md),
  [`docs/15-deployment.md`](docs/15-deployment.md),
  [`docs/16-curation.md`](docs/16-curation.md).
- **Deploy:** containerized for **Cloud Run → Neon** (open egress reaches
  pgvector). See [`docs/15-deployment.md`](docs/15-deployment.md).
- **Agents:** a **Curator** continuously expands the graph from a topic queue
  (Claude + real PMID/DOI citations, written as `unverified`) and a **Reviewer**
  verifies every citation against PubMed/Crossref + an LLM judge, promoting to
  `curated` or flagging `needs_refinement` for human review. Runs as a Cloud Run
  Job on a Cloud Scheduler tick. See [`docs/17-agents.md`](docs/17-agents.md).
- **Next:** RAG answer synthesis (Claude) over the expanding graph — see the
  [roadmap](docs/06-roadmap.md).

## Quickstart / 快速开始

Runs on **Node ≥ 22.18** (TypeScript runs directly). The **offline path needs no
install** (the one dependency, the Neon driver, is lazy-loaded only when
`DATABASE_URL` is set).

```bash
npm run validate          # validate the seed graph against the model (docs/02)
npm test                  # tests (node --test) — offline, hermetic
npm run query conflicts   # competency-question query over the graph
npm run query search "preventing falls in older people"   # semantic search
npm run serve             # REST API (http://localhost:8787) — see docs/13-api.md
npm run mcp               # MCP server over stdio (tools for AI agents)
npm run db:verify         # ephemeral Postgres 16: migrate, seed, query

# Neon backend (Postgres + pgvector) — see docs/14-semantic-search.md
export DATABASE_URL="postgres://…@…neon.tech/…?sslmode=require"
npm install               # fetches @neondatabase/serverless (only needed for Neon)
npm run db:setup          # migrate + seed + embeddings + sample vector search
```

## Repository layout / 仓库结构

```
docs/                 Charter & specification (00–12 + glossary)
db/migrations/        Postgres schema (0001 core; 0002 optional pgvector)
seed/                 Curated graph as JSON — single source of truth
  ontology.json         controlled vocabularies (mirrors docs/02 + the schema)
  graph.json            nodes / claims / evidence (the two seed chains)
src/                  TypeScript: types, loader+validator, queries, registry,
                        embeddings (offline + provider), db (Neon), store (backend
                        select + pgvector search), REST (http.ts), MCP (mcp.ts), CLI
scripts/              seed-to-SQL + embeddings-to-SQL; Postgres / Neon setup
test/                 node --test suites (model, queries, embeddings, HTTP, MCP)
```

## For the AI coding agent / 给 AI 编程代理

This repo is developed **incrementally by an AI agent**. Before changing the
model, read [`docs/07-development-principles.md`](docs/07-development-principles.md):
a model change now means updating **`docs/02` + the migration + `seed/ontology.json`
+ the validator** together. Run `npm run validate && npm test && npm run db:verify`
before committing. Pull the next unit of work from [`docs/06-roadmap.md`](docs/06-roadmap.md).

## License / 许可

Open by design (**open by default**):
- **Code** — MIT (see [`LICENSE`](LICENSE)).
- **Data & docs** — CC BY 4.0 (see [`DATA-LICENSE.md`](DATA-LICENSE.md)).

The open dataset carries only open-licensed vocabulary codes; see
[`docs/10-standards-alignment.md`](docs/10-standards-alignment.md).
