# 04 · AI Capabilities

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

Healthy Aging Knowledge is AI-native: AI builds and maintains the graph at scale,
while provenance keeps it auditable. This document specifies the AI capabilities,
each as purpose → inputs/outputs → strategy. They map onto the AI services layer
in [`03-architecture.md`](03-architecture.md) and conform to the
[knowledge model](02-knowledge-model.md).

## 中文摘要

Healthy Aging Knowledge 是 AI 原生的：AI 大规模地构建与维护图谱，而来源（provenance）保证其可审计。
核心 AI 能力包括：从论文中**自动抽取**实体与关系、**自动链接与去重**、**证据评分**、
**来源追溯**、**语义搜索**与**图谱 RAG 问答**、**知识演化/时间线**追踪、**自动打标签**。
每项能力都遵循知识模型，并记录抽取者（人 vs. 模型）。默认使用最新、最强的 Claude 模型
（如 Opus 4.x / Sonnet 4.x）进行代理式抽取与推理。

---

## Capability catalog

### 1. Entity & relationship extraction
- **Purpose:** Read papers/guidelines and emit candidate nodes + typed edges.
- **In → Out:** Document text → structured `{nodes[], claims[], evidence[]}`
  conforming to [`02-knowledge-model.md`](02-knowledge-model.md). Each claim is
  extracted with its **qualifiers** (population, setting, direction, dose) and
  each evidence record with its `study_design`.
- **Strategy:** LLM with a strict schema (tool/function calling); verbatim
  `quote` captured for each claim; output staged for review, never written blind.

### 2. Auto-linking & deduplication
- **Purpose:** Connect new entities to existing nodes; merge duplicates/aliases.
- **In → Out:** Candidate node → matched existing node id or "new".
- **Strategy:** Embedding similarity (pgvector) + alias/external-id matching +
  LLM disambiguation for ambiguous cases.

### 3. Evidence scoring
- **Purpose:** Assign each claim a **GRADE certainty** (High/Moderate/Low/Very
  Low) over its body of evidence.
- **In → Out:** Claim + its evidence records (each with a `study_design` ≈ CEBM
  level) → aggregate `certainty` (GRADE) + per-record confidence.
- **Strategy:** Study-design hierarchy (systematic review/meta-analysis > RCT >
  cohort > case-control > case report > expert opinion), consistency/directness,
  count/agreement of sources, and **contradicts** links all factor in. Population
  and dose qualifiers keep conflicting claims separate rather than averaged. See
  the [evidence model](02-knowledge-model.md#5-evidence-model-graded--traceable).

### 4. Source tracing / provenance
- **Purpose:** Make every claim auditable back to its source.
- **In → Out:** Node/edge → its evidence chain (paper, DOI, quote, extractor).
- **Strategy:** Provenance is recorded at write time (see evidence model);
  surfaced in API + UI so any answer can be cited.

### 5. Semantic search ✅ *(implemented)*
- **Purpose:** Find concepts by meaning, not just keywords.
- **In → Out:** Natural-language query → ranked nodes/claims with scores.
- **Strategy:** embeddings + cosine ranking. Offline default is a zero-dep
  hashing embedder; **pgvector** on Neon for production; pluggable neural provider
  (OpenAI/Voyage). See [`14-semantic-search.md`](14-semantic-search.md). Exposed
  as the `search` query over REST/MCP/CLI.

### 6. RAG over the graph
- **Purpose:** Answer questions grounded in the graph, **with citations**.
- **In → Out:** Question → answer + cited evidence + traversed subgraph.
- **Strategy:** Retrieve relevant nodes/edges/evidence, then LLM synthesis
  constrained to retrieved context; always return sources.

### 7. Knowledge evolution / timeline
- **Purpose:** Track how knowledge changes over time.
- **In → Out:** Concept → timeline of evidence (e.g. consensus shifts).
- **Strategy:** Use evidence `created_at`/publication year + versioned edges to
  show how support for a claim grew, weakened, or was contradicted.

### 8. Automatic tagging
- **Purpose:** Assign domains/facets to nodes consistently.
- **In → Out:** Node → `domains[]` and other facets.
- **Strategy:** LLM classification against the fixed domain list in
  [`02-knowledge-model.md`](02-knowledge-model.md).

## Operating principles for AI features

- **Schema-constrained output.** Extractors must emit valid model-conformant
  structures; invalid output is rejected, not patched silently.
- **Human-in-the-loop early.** In V1–V2, AI proposes; a curator approves.
  Autonomy increases only as evidence scoring proves reliable.
- **Provenance of the extraction itself.** Every AI-created node/edge records
  the model id in `extracted_by` — so we can audit and re-run when models
  improve.
- **Model choice.** Default to the latest, most capable Claude models for
  extraction/reasoning; keep the provider abstracted so models can be swapped
  or compared.
