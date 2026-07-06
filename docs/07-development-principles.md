# 07 · Development Principles

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

The "constitution" for everyone building this repo — human contributors and the
AI coding agent alike. These rules keep a multi-year, AI-developed project
coherent. Read this before changing anything.

## 中文摘要

这是本仓库的"开发宪法"，面向人类贡献者与 AI 编程代理。核心规则：一切**模块化**、
一切**暴露 API**、一切**AI 就绪**；**文档优先**；schema 变更走**版本化迁移**；
扩展节点/关系类型需"文档 + schema + 抽取规则"三者同步更新；所有写入必须记录来源
（人 vs. 模型）；AI 早期只做"提议"，由人审核。代理在动手前应先读本文件，再从路线图领取
下一个工作单元。

---

## The three core rules

1. **Everything is modular.** Independent, replaceable pieces — storage, AI
   providers, ingestion connectors, and UI must all be swappable behind
   interfaces. No hard-wiring to a single vendor or model.
2. **Everything exposes an API.** Every entity is reachable through a stable,
   documented API *before* it gets a UI. The MCP surface is a first-class
   consumer (agents are users too).
3. **Everything is AI-ready.** Structured, schema-conformant data; embeddings
   where useful; provenance on every write so AI can read, extend, and audit
   the graph safely.

## Documentation-first

- The `docs/` charter is the **source of truth**. If behavior and docs diverge,
  fix one deliberately — don't let them drift.
- Changing the knowledge model, architecture, or roadmap means **updating the
  corresponding doc in the same change** as the code.

## Governing the knowledge model

To add/modify a **node type** or **relationship type**, update all three
together, in one change:

1. [`02-knowledge-model.md`](02-knowledge-model.md) (the definition),
2. the database schema (a versioned **migration**), and
3. the AI **extractor** rules/prompts that emit it.

This keeps the model, storage, and AI in lockstep. Never add a type in code
without documenting it.

> **As of V0, code exists, so the rule is active.** A model change must update,
> in one change: (1) [`02-knowledge-model.md`](02-knowledge-model.md), (2) the
> migration in `db/migrations/`, (3) the seed vocabularies `seed/ontology.json`,
> and (4) the validator in `src/model.ts`. Run `npm run validate && npm test &&
> npm run db:verify` before committing. (The AI extractor does not exist yet; its
> rules join this list when it lands.)

## Data & provenance discipline

- **Evidence is mandatory** on edges; unverified edges must be flagged
  `status: unverified`, not hidden (see [`02`](02-knowledge-model.md)).
- **Record who/what wrote it** — `extracted_by` is human or a model id on every
  AI-created node/edge.
- **AI proposes, humans approve** in early phases; increase autonomy only as
  evidence scoring proves reliable.

## Engineering conventions

- **Versioned migrations** for every schema change; never edit applied
  migrations.
- **Abstraction layers** for storage and model providers (rule 1).
- **Tests** for the data layer and extraction-output validation; reject invalid
  (non-schema-conformant) extractor output rather than patching it silently.
- **TypeScript** end-to-end; clear module boundaries; small, reviewable changes.
- Match the surrounding code's style and naming once code exists.

## How the AI agent should work here

1. Read this file + [`00-charter.md`](00-charter.md) for intent and non-goals.
2. Pull the next unit of work from the current phase in
   [`06-roadmap.md`](06-roadmap.md) — don't skip phases.
3. Keep changes modular and API-first; update the relevant doc in the same
   commit; record provenance.
4. Prefer extending the existing model over inventing parallel structures.
