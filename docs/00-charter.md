# 00 · Product Charter

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

This is the founding document of Healthy Aging Knowledge. It defines *why* this
project exists and what success looks like. It changes rarely; everything else
in `docs/` should remain consistent with it.

## 中文摘要

本文件是 Healthy Aging Knowledge 的奠基文档，定义项目**为何存在**以及**成功的样子**。
核心愿景：建立一个关于健康老龄化的、世界一流的、开放且可追溯证据的知识图谱。
主要用户先是创建者本人——在多年经验积累之后，找到了个人兴趣与一项长期事业的契合点，
投身于健康老龄化研究；随后扩展到研究者、CCA 学生、照护者与临床人员。核心理念是"万物互联、证据可溯"。明确的**非目标**包括：它不是聊天机器人、
不是通用笔记应用、不是封闭数据集。

---

## Vision

Build the **world's best open knowledge graph about aging well** — a connected,
evidence-traceable map of the concepts, interventions, evidence, and people that
shape healthy aging. Where most knowledge about aging lives in scattered papers,
guidelines, and clinicians' heads, Healthy Aging Knowledge makes it **explicit,
linked, and queryable** — by humans and by AI.

## Mission

Turn the dispersed literature and practice of gerontology and health
informatics into a **living, machine-readable graph** that:

1. Represents knowledge as **nodes and relationships**, not isolated documents.
2. Attaches **evidence and provenance** to every claim.
3. Stays **open** and reusable as research infrastructure.
4. Powers downstream GraceAge products (the research OS, the AI companion).

## Target users

**Primary (now):**
- The founder — building long-term research infrastructure at the intersection
  of a genuine personal interest and a long-term commitment to healthy-aging
  research, drawing on years of accumulated experience.

**Later:**
- **Researchers** in gerontology, public health, and health informatics.
- **CCA students** and educators (the Learn pillar).
- **Caregivers** seeking evidence-based, trustworthy guidance.
- **Clinicians and health professionals**.

## Core philosophy

- **Everything connects.** Research is not isolated documents; every concept is
  a node, every claim is an edge.
- **Evidence is first-class.** Every relationship carries its evidence, source,
  and a confidence/quality signal. Unsupported claims are visible as such.
- **Open by default.** This is shared research infrastructure, not a moat.
- **AI-native, human-trustworthy.** AI extracts and links knowledge at scale;
  provenance keeps it auditable and trustworthy.

## Success criteria

A pragmatic, multi-year view of what "good" looks like:

| Horizon | Looks like |
|---------|------------|
| **Year 1** | A working schema and seed ontology; hundreds of curated, evidence-linked nodes/edges across core domains; basic graph + search UI. |
| **Year 2** | AI-assisted extraction from papers; thousands of nodes with evidence scoring and source tracing; RAG-backed Q&A over the graph. |
| **Year 3** | Synced with external sources (PubMed, guidelines); mapped to standard ontologies (FHIR, SNOMED CT); a citable, **public open dataset** used in the founder's own research and by others. |

Underlying signal: this is not a portfolio demo but **durable scientific
infrastructure** — the work has value in itself, as the expression of a genuine,
long-term commitment to healthy-aging research.

## Non-goals (explicit)

To keep scope honest, Healthy Aging Knowledge is **not**:

- ❌ **A chatbot / conversational companion.** That is the separate *GraceAge
  Companion* pillar. Knowledge may *power* it, but is not it.
- ❌ **A generic note-taking app.** That overlaps with *GraceAge OS*; Knowledge
  is specifically the structured, evidence-backed graph.
- ❌ **A closed or proprietary dataset.** Openness and reusability are core.
- ❌ **A clinical decision-making tool / medical device.** It is a research and
  knowledge resource, not a regulated clinical product, and gives no medical
  advice.
- ❌ **A one-off portfolio demo.** It is durable, evolving infrastructure.
