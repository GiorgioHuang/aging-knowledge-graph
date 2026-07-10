# 06 · Roadmap

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

A phased, multi-year plan an AI agent (or contributor) can pull work from. Each
phase has **goals**, **deliverables**, and **exit criteria**. Build in order;
don't skip ahead — later phases assume earlier foundations.

## 中文摘要

这是一个分阶段的多年计划，AI 代理或贡献者可从中领取任务。共四个阶段：
**V0**（schema + 种子本体 + 仓库脚手架）、**V1**（人工策展 UI + 图谱视图 + 搜索）、
**V2**（AI 抽取 + 证据评分 + RAG）、**V3**（外部数据源同步 + 本体映射 + 公开开放数据集）。
每个阶段都有目标、交付物与完成标准。按顺序构建，不要跳阶段。

---

## V0 — Foundation  ✅ *(core done)*
*Goal: a real, queryable schema and a small seed graph.*

- **Deliverables:**
  - ✅ Postgres schema for `node` / `claim` / `evidence` (+ optional `embedding`)
    as versioned migrations (`db/migrations/`), per
    [`03-architecture.md`](03-architecture.md) and [`02`](02-knowledge-model.md).
  - ✅ Seed ontology: node/relationship/domain/qualifier vocabularies encoded as
    data (`seed/ontology.json`).
  - ✅ Hand-curated, evidence-linked seed (`seed/graph.json`): the falls/exercise
    chain ([`11`](11-worked-example.md)) and the social/loneliness chain
    ([`12`](12-worked-example-social.md)), fully sourced.
  - ✅ Queryable API + validator (`src/`) and tests (`test/`); verified against a
    real Postgres 16 (`scripts/verify-postgres.sh`).
  - ✅ Open license chosen: MIT (code) + CC BY 4.0 (data).
  - ⏳ Remaining: Next.js/Supabase app scaffolding (deferred to V1's UI).
- **Exit criteria:** ✅ Schema migrates cleanly; ✅ the seed graph is queryable via
  SQL and the API; ✅ the worked examples render as connected, evidence-bearing
  claims.

## V1 — Curation & viewing
*Goal: humans can grow and explore the graph.*

- **Deliverables:**
  - ✅ Read-only HTTP API + MCP surface for nodes/claims/queries — **API before
    UI** (`src/http.ts`, `src/mcp.ts`, `src/registry.ts`; see
    [`13-api.md`](13-api.md)).
  - ✅ **Write path** (create nodes/claims/evidence) — token-gated, Neon-backed,
    validated; see [`16-curation.md`](16-curation.md).
  - ✅ **Curation UI** at `/admin` to add/edit/delete nodes/claims + a
    force-directed **graph visualization** (`GET /graph`).
  - ✅ Update/delete operations (PUT/DELETE, with referential safety).
  - ✅ Richer keyword/filter search (`/nodes?q=`, `/claims?certainty=&subject=&object=`).
  - ✅ Bulk import (JSON batch + CSV) and a PubMed citation lookup helper.
  - ✅ Node detail view (claims + evidence + neighbours): `GET /nodes/:id/detail`
    + `/admin` panel.
- **Exit criteria:** ✅ A curator can add an evidence-backed claim end-to-end via
  the UI and API. ⏳ Grow to hundreds of nodes across core domains.

## V2 — AI assistance
*Goal: AI scales curation; answers are grounded and cited.*

- **Deliverables:**
  - Entity/relationship **extraction** pipeline (LangGraph) with human review.
  - **Auto-linking & deduplication** (pgvector + LLM disambiguation).
  - **Evidence scoring**; **source tracing** surfaced in API/UI.
  - ✅ **Semantic search** (offline default + Neon/pgvector; see
    [`14`](14-semantic-search.md)), surfaced as a search box on the home page.
  - ✅ **RAG Q&A** — grounded, cited answers over the graph (`POST /ask` + the
    home-page **Ask**): retrieve relevant claims + evidence, the model answers
    using only that context and cites source ids, or says the graph has no
    evidence.
  - ✅ MCP server exposing graph (read); write tools later.
- **Exit criteria:** AI proposes correct, schema-valid extractions that a curator
  approves; a natural-language question returns a cited answer from the graph;
  thousands of nodes with evidence scores.

## V3 — Sources, standards & open dataset
*Goal: a synced, standards-mapped, publicly citable resource.*

- **Deliverables:**
  - ✅ **PubMed connector** — harvest recent higher-quality papers (reviews /
    meta-analyses / RCTs in older adults) for a query and extract claims
    GROUNDED in each abstract, with the real PMID as the source by construction
    (`src/pubmedharvest.ts`, `POST /admin/harvest`, `/admin` "Harvest" form).
    New claims are `unverified` → Reviewer gate.
  - ✅ **Guideline connector** — extract recommendation claims from one clinical
    practice guideline (WHO / CDC / Canadian geriatric societies) from pasted
    text or a fetched HTML page, each grounded in a VERBATIM quote, with the
    guideline's DOI/URL as the source CURIE (`src/guidelineharvest.ts`,
    `POST /admin/harvest-guideline`, `/admin` "Harvest guideline" form). New
    claims are `unverified` → Reviewer gate. See
    [`05-data-sources.md`](05-data-sources.md).
  - ✅ **Standards mapping** — attach open CURIEs to nodes by resolving each
    node's name against the authorities and accepting a code only on a verified
    label match (`src/codemap.ts`): MONDO/HP/GO/ChEBI/FoodOn (EBI OLS4), MeSH
    (NLM), RxNorm (RxNav), ROR (orgs), ORCID (experts). Run from the `/admin`
    Maintenance button or `POST /admin/map-codes`; codes render as authority
    links in the UI. See [`10-standards-alignment.md`](10-standards-alignment.md).
    SNOMED/ICD/ATC stay out of the open data (reached via MONDO/HPO xrefs).
  - Ontology mapping to restricted vocabularies (SNOMED CT via MONDO/HPO xrefs); FHIR bindings.
  - Knowledge-evolution/timeline views.
  - A published, citable **open dataset** (feeds *GraceAge Data*) and public APIs
    consumed by *GraceAge OS* and *Companion*.
- **Exit criteria:** External sources sync reproducibly; nodes carry standard
  codes; the dataset is openly published and used in the founder's own research.

## Beyond V3 (directions)

Graph-database backend (if scale demands), community contribution workflows,
multilingual coverage, deeper integration loops with OS/Companion/Care.
