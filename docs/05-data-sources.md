# 05 · Data Sources & Standards

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

The graph is only as trustworthy as its sources. This document specifies where
knowledge comes from, how it maps to standard health ontologies, and the
openness/provenance rules that keep the resource credible and reusable.

## 中文摘要

图谱的可信度取决于其数据源。本文件说明知识的来源（PubMed、WHO、CDC、加拿大临床实践指南等）、
如何映射到标准词表（**开放优先**：MONDO、HPO、MeSH、RxNorm、LOINC、ROR、ORCID 等为主，
SNOMED CT/ICD-11/ATC 仅作受限的可选引用），以及保证资源可信、可复用的开放与来源（provenance）规则。
完整的逐节点映射与许可规则见 **[`10-standards-alignment.md`](10-standards-alignment.md)**。
原则：优先权威、开放可用的来源；尊重各来源的许可与署名；保留完整出处链。这些为未来阶段的能力，按路线图逐步接入。

---

## Source integrations (planned)

Ordered roughly by priority; all are **future-phase** capabilities (see the
[roadmap](06-roadmap.md)) — V0 starts with manual curation.

| Source | What it provides | Notes |
|--------|------------------|-------|
| **PubMed** | Biomedical literature (papers, abstracts, MeSH) | ✅ Connector shipped (`src/pubmedharvest.ts`); E-utilities API |
| **WHO** | Global guidelines, reports (e.g. healthy ageing) | ✅ Guideline connector shipped (`src/guidelineharvest.ts`) |
| **CDC** | US public-health guidance & data | ✅ via the guideline connector — falls, physical activity, etc. |
| **Canadian clinical practice guidelines** | Region-specific guidance | ✅ via the guideline connector; relevant to the founder's CCA/Canada context |
| **Clinical practice guidelines (general)** | Consensus recommendations | ✅ via the guideline connector; high evidence strength |

Each ingested item becomes a **Paper/Research/Organization node** plus
**evidence records** on the edges it supports — never free-floating facts.

### Connectors (shipped)

Two data-source connectors run from `/admin` (token-gated) and write new claims
`unverified`, so the Reviewer still checks grounding:

- **PubMed** (`POST /admin/harvest`) — search recent higher-quality evidence for
  a query and extract claims **grounded in each abstract**; the source is a real
  PMID by construction. A `kind` flag chooses the publication-type filter:
  `evidence` (reviews / meta-analyses / RCTs, the default) or **`guideline`**
  (`guideline[pt]`) — the latter **discovers practice guidelines by topic** (WHO /
  USPSTF / society guidelines that PubMed indexes), so the curator needn't know a
  specific document, and coverage scales with search rather than manual entry.
- **Landmark-guideline canon** (`POST /admin/harvest-canon`) — one action sweeps a
  curated list of well-known geriatrics/healthy-aging guidelines
  (`seed/guideline-canon.json`) through the PubMed guideline harvester. The canon
  stores **search queries, not identifiers** — PubMed's `guideline[pt]` search
  supplies the real PMID, so nothing is ever hardcoded or invented. Batched by
  `(offset, count)` so a long sweep is many short requests, not one that times out.
- **Clinical guideline (bring-your-own)** (`POST /admin/harvest-guideline`) —
  extract recommendation claims from ONE specific guideline you already have,
  including ones PubMed does not index. Provide the document as pasted **text**
  (required for PDFs — no zero-dep PDF parsing) or an **HTML URL** we fetch and
  strip; the source id is the guideline's **DOI** (preferred) or **URL** as a
  CURIE. Each claim carries a **verbatim quote** and is typically a `recommends`
  edge with `study_design: guideline`. This is the targeted supplement; the
  PubMed guideline mode + canon are how you get broad coverage.

## Ontology & standards mapping

To be interoperable and clinically meaningful, GraceAge nodes carry
`external_ids[]` mapping to standard vocabularies. The policy is **open-first**:
primary mappings use fully open, redistributable vocabularies, with
license-restricted ones kept as optional references only.

| Aspect | Summary |
|--------|---------|
| **Primary (open) codes** | MONDO (disease), HPO (symptom), MeSH (index), RxNorm prescribable subset (drug), ChEBI/FoodOn (compounds/food), GO (mechanism), LOINC (scales/observations), ROR (org), ORCID (expert), DOI/PMID (paper) |
| **Secondary (optional, restricted)** | SNOMED CT, ICD-11 crosswalks, ATC — referenced but **not** shipped in the open dataset |
| **Identifier format** | CURIEs (e.g. `MONDO:0005010`), via Bioregistry / identifiers.org |
| **FHIR** | The data-*exchange* layer (resource shapes + terminology bindings), **not** a node code system |

> Full per-node-type mappings, licensing rules, and lookup services are specified
> in **[`10-standards-alignment.md`](10-standards-alignment.md)**.

Mapping is incremental: a node is useful without a code, better with one. Codes
enable cross-walking to external systems and downstream GraceAge pillars.

## Openness, licensing & provenance

- **Open by default.** The graph is intended as an open research resource; a
  specific open license for code and data is selected in **V0**.
- **Respect source licenses.** Store only what each source's license permits
  (e.g. metadata + quotes vs. full text); always attribute.
- **Full provenance chain.** Every claim traces to a source id (DOI / PubMed id
  / URL) and, where possible, a verbatim quote — see the evidence model in
  [`02-knowledge-model.md`](02-knowledge-model.md).
- **Reproducibility.** Ingestion is scripted and versioned so the dataset can be
  rebuilt and cited (feeding the *GraceAge Data* pillar).
