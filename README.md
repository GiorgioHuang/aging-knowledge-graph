# Healthy Aging Knowledge

> **Building AI for Aging Well.**
> An open, evidence-traceable knowledge graph for healthy aging.
> **Live:** https://ack.icareu.cc

**Healthy Aging Knowledge** (this repository, `aging-knowledge-graph`) is the
**knowledge / "Core"** pillar of the **GraceAge** research ecosystem. Its goal
is to build the world's best **open knowledge graph about aging well** — a
connected, machine-readable, evidence-backed map of everything we know about
gerontology, health informatics, and healthy aging.

The repository began as **founding documents** (a Product Charter and
specification) and is now a **live service**: a Postgres + pgvector backend, a
curated, evidence-backed seed graph, a queryable **REST + MCP** API with
natural-language search, a token-gated write path with a curation UI, and
continuously-running Curator/Reviewer agents. *What to build and why* was defined
before *how*, so the platform can grow incrementally over a multi-year roadmap.

---

## Documentation map

| Doc | Purpose |
|-----|---------|
| [`docs/00-charter.md`](docs/00-charter.md) | Product Charter: vision, users, philosophy, success, non-goals |
| [`docs/01-ecosystem-context.md`](docs/01-ecosystem-context.md) | The GraceAge ecosystem and how Knowledge connects |
| [`docs/02-knowledge-model.md`](docs/02-knowledge-model.md) | The ontology: domains, node types, relationships, evidence |
| [`docs/03-architecture.md`](docs/03-architecture.md) | Tech stack, data model, API-first design |
| [`docs/04-ai-capabilities.md`](docs/04-ai-capabilities.md) | Extraction, linking, evidence scoring, search, RAG |
| [`docs/05-data-sources.md`](docs/05-data-sources.md) | PubMed/WHO/CDC ingestion; FHIR & SNOMED CT mapping |
| [`docs/06-roadmap.md`](docs/06-roadmap.md) | Phased V0→V3 multi-year roadmap |
| [`docs/07-development-principles.md`](docs/07-development-principles.md) | The "constitution" for contributors |
| [`docs/08-competency-questions.md`](docs/08-competency-questions.md) | The questions the graph must answer (validates the model) |
| [`docs/09-domain-skeleton.md`](docs/09-domain-skeleton.md) | Broad, shallow skeleton across all 15 domains |
| [`docs/10-standards-alignment.md`](docs/10-standards-alignment.md) | Open-first mapping of nodes to standard vocabularies |
| [`docs/11-worked-example.md`](docs/11-worked-example.md) | Curated, cited falls/exercise chain — end-to-end model test |
| [`docs/12-worked-example-social.md`](docs/12-worked-example-social.md) | Curated, cited social/loneliness/depression chain — model test |
| [`docs/13-api.md`](docs/13-api.md) | REST + MCP surface (how to query the graph) |
| [`docs/14-semantic-search.md`](docs/14-semantic-search.md) | Semantic search + Neon/pgvector backend |
| [`docs/15-deployment.md`](docs/15-deployment.md) | Deploy to Cloud Run (calling Neon) |
| [`docs/16-curation.md`](docs/16-curation.md) | Write path & curation UI (token-gated) |
| [`docs/17-agents.md`](docs/17-agents.md) | Curator + Reviewer agents (continuous, cited expansion) |
| [`docs/glossary.md`](docs/glossary.md) | Bilingual glossary of key terms |

---

## Status

- **Stage:** **Live.** Deployed on Cloud Run behind a custom domain, backed by
  Neon (Postgres + pgvector): **https://ack.icareu.cc** (e.g. `/health`,
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

## Quickstart

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

## Repository layout

```
docs/                 Charter & specification (00–17 + glossary)
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

## Development

Before changing the model, read
[`docs/07-development-principles.md`](docs/07-development-principles.md): a model
change means updating **`docs/02` + the migration + `seed/ontology.json` + the
validator** together. Run `npm run validate && npm test && npm run db:verify`
before committing. Pull the next unit of work from
[`docs/06-roadmap.md`](docs/06-roadmap.md).

## License

Open by design (**open by default**):
- **Code** — MIT (see [`LICENSE`](LICENSE)).
- **Data & docs** — CC BY 4.0 (see [`DATA-LICENSE.md`](DATA-LICENSE.md)).

The open dataset carries only open-licensed vocabulary codes; see
[`docs/10-standards-alignment.md`](docs/10-standards-alignment.md).
