# 03 · Architecture

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

This document describes the intended technical architecture: the stack, the data
model, and the **API-first** design that lets both humans and AI agents build on
the graph. It is a target architecture — implementation lands incrementally per
the [roadmap](06-roadmap.md).

## 中文摘要

本文件描述目标技术架构：技术栈、数据模型，以及让人与 AI 代理都能在图谱之上构建的
**API 优先**设计。采用 Next.js + TypeScript + Tailwind 前端，Supabase/Postgres 作为
主存储，pgvector 做向量检索；图谱以关系表 + 边表的方式建模（未来可选专用图数据库）；
通过 OpenAI / Claude / Gemini 提供 AI 能力，LangGraph 编排多步流程，MCP 暴露给代理。
原则：每个实体都有 API，一切模块化、AI 就绪。这是目标架构，按路线图分阶段落地。

---

## Tech stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **Next.js + TypeScript + TailwindCSS** | App Router; PWA-capable |
| Storage | **Supabase / Postgres** | Relational core + row-level security |
| Vectors | **pgvector** | Embeddings for semantic search / RAG |
| AI models | **Claude, OpenAI, Gemini** | Default to the latest, most capable Claude models (e.g. Opus 4.x / Sonnet 4.x) for agentic extraction & reasoning |
| Orchestration | **LangGraph** | Multi-step extraction & enrichment pipelines |
| Agent interface | **MCP** | Expose graph read/write as tools for agents |
| Delivery | **PWA** | Offline-leaning, installable |

> Graph storage starts in Postgres (nodes + edges as tables). A dedicated graph
> database is an **optional future** optimization, not a V0 requirement — keep
> the data-access layer abstracted so it can be swapped.

## Data model (logical)

```
node(id, type, name, aliases[], domains[], description, external_ids[], meta jsonb, created_at, updated_at)
edge(id, type, source_node_id, target_node_id, status, meta jsonb, created_at, updated_at)
evidence(id, edge_id, source_node_id|source_ref, source_id, quote, strength, confidence, extracted_by, created_at)
embedding(id, owner_type, owner_id, vector, model, created_at)   -- pgvector
```

This mirrors the [knowledge model](02-knowledge-model.md) exactly: typed nodes,
typed directed edges, mandatory evidence, and vector embeddings for search. Keep
schema changes as **versioned migrations**.

## Layered architecture

```
┌────────────────────────────────────────────────────────┐
│ Consumers:  Web UI · GraceAge OS · Companion · agents    │
├────────────────────────────────────────────────────────┤
│ API layer:  REST/GraphQL · MCP server (read + write)     │  ← API-first
├────────────────────────────────────────────────────────┤
│ AI services: extraction · linking · scoring · RAG search │  (see 04)
├────────────────────────────────────────────────────────┤
│ Storage:    Postgres (nodes/edges/evidence) · pgvector   │
├────────────────────────────────────────────────────────┤
│ Ingestion:  PubMed/WHO/CDC/guidelines connectors         │  (see 05)
└────────────────────────────────────────────────────────┘
```

## API-first principle

Every entity (node, edge, evidence) is reachable through a **stable, documented
API** before it gets a UI. Two surfaces:

1. **HTTP API** (REST/GraphQL) for apps and external consumers.
2. **MCP server** exposing graph operations as **tools** so AI agents (including
   the one developing this repo, and the Companion's agents) can query and
   extend the graph programmatically.

This is what lets the other GraceAge pillars (see
[`01-ecosystem-context.md`](01-ecosystem-context.md)) build on Knowledge without
duplicating data.

> **Implemented (read-only):** both surfaces exist today — a REST API
> (`src/http.ts`) and an MCP server (`src/mcp.ts`), driven by a shared query
> registry (`src/registry.ts`). See [`13-api.md`](13-api.md). They serve the
> curated in-memory seed graph by default, and **Neon (Postgres + pgvector)** when
> `DATABASE_URL` is set — including semantic search (see
> [`14-semantic-search.md`](14-semantic-search.md)). The Neon driver
> (`@neondatabase/serverless`) is the only dependency and is lazy-loaded.
> (REST today, GraphQL optional later; write path arrives with the V1 curation UI.)

## Cross-cutting concerns

- **Provenance everywhere** — every write records who/what created it (human vs.
  model id).
- **Versioned migrations** for all schema changes.
- **Abstraction at the data layer** so storage (Postgres → graph DB) and model
  providers can evolve without rewrites.
- **Security** — row-level security in Supabase; public read for open data,
  authenticated write.
