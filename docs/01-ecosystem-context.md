# 01 · Ecosystem Context

> Part of **GraceAge Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

GraceAge Knowledge does not stand alone. It is one pillar of the **GraceAge**
ecosystem — a multi-year research infrastructure spanning a research platform,
an AI companion, caregiver tools, learning, data, and a public lab presence.
This document gives just enough context to understand where Knowledge sits and
how it connects. The other pillars are **out of scope** for this repo's spec.

## 中文摘要

GraceAge Knowledge 是 **GraceAge** 生态系统的一个支柱，而非孤立项目。生态系统包含：
研究平台（OS）、知识图谱（Core/Knowledge，即本仓库）、AI 陪伴（Companion）、
照护平台（Care）、学习（Learn）、研究数据集（Data）、研究网站（Lab）。本文件仅说明
知识图谱在其中的位置及连接方式；其他支柱不在本仓库规格范围内。知识图谱是**共享的语义底座**：
它向 OS 提供结构化的概念与证据，向 Companion 提供可追溯的领域知识。

---

## The GraceAge ecosystem

```
GraceAge
├── OS         Research platform (AI-native research workspace)
├── Core       Knowledge graph        ← THIS REPOSITORY
├── Companion  AI aging companion (helps older adults age well)
├── Care       Caregiver platform
├── Learn      CCA learning
├── Data       Research dataset
└── Lab        Research website / public presence
```

This repository (`aging-knowledge-graph`) is **Core / Knowledge**.

## Where Knowledge fits

Knowledge is the **shared semantic substrate** of the ecosystem. It is the
single, evidence-backed source of "what is known" that other products read from
and (eventually) write back to.

| Pillar | How it connects to Knowledge |
|--------|------------------------------|
| **OS** (research platform) | The OS links its papers, notes, and research questions to Knowledge nodes, so a researcher's workspace is grounded in shared, evidence-traced concepts. |
| **Companion** (AI for older adults) | The Companion's health/memory/emotion agents retrieve evidence-backed guidance from Knowledge instead of free-floating model output — improving trustworthiness and provenance. |
| **Care / Learn** | Caregiver guidance and CCA learning content reference the same nodes and evidence, keeping the whole ecosystem consistent. |
| **Data** | Curated, anonymized, citable slices of the graph become the open research dataset. |

## Connection mechanism (design intent)

Knowledge exposes its content through **stable APIs and an MCP surface** (see
[`03-architecture.md`](03-architecture.md)). Other pillars integrate by:

- **Referencing nodes/edges by stable IDs** (no copy-paste of facts).
- **Querying** via REST/GraphQL APIs and **semantic search / RAG**.
- **Consuming evidence + provenance** so downstream products can cite sources.

> Scope note: This repo specifies only Knowledge. References to OS, Companion,
> etc. exist to ensure Knowledge's APIs and model serve them well — not to
> specify those products here.
