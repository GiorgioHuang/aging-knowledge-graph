# 10 · Standards Alignment (open-first)

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

To be credible and interoperable, GraceAge nodes map to **authoritative standard
vocabularies** instead of invented terms. This document specifies *which*
vocabulary each [node type](02-knowledge-model.md#2-node-types) maps to, the
identifier format (`external_ids[]`), and the licensing rules that keep the
published dataset **freely redistributable**.

**Policy: open-first.** Primary mappings use fully open, redistributable
vocabularies. SNOMED CT, ICD-11 crosswalks, and ATC are **optional secondary
references only** (license-restricted) and are never embedded in the public open
dump. Licensing facts here were verified on the web (June 2026); see §4.

## 中文摘要

为保证可信与可互操作，GraceAge 的节点映射到**权威标准词表**而非自创术语。本文件规定每种
[节点类型](02-knowledge-model.md#2-node-types)映射到哪个词表、标识格式（`external_ids[]`），
以及保证公开数据集**可自由再分发**的许可规则。

**策略：开放优先。** 主映射一律用完全开放、可再分发的词表（MONDO、HPO、MeSH、RxNorm 可处方子集、
ChEBI、FoodOn、GO、LOINC、ROR、ORCID、DOI/PMID 等）。**SNOMED CT、ICD-11 映射、ATC 因许可受限，
仅作可选次级引用，绝不进入公开数据集**。一条硬规则：**公开数据集只再分发开放编码**；受限编码在
查询时经授权服务解析，或干脆不进开放包。许可信息已于 2026-06 联网核实（见 §4）。

节点无编码仍然有效（标记为未映射）；AI 自动链接（见 [`04`](04-ai-capabilities.md)）会提出候选
CURIE 供人工审核。

---

## 1. Principles

- **Reuse over invent.** Prefer an existing standard code to a GraceAge-only term.
- **A node is useful without a code, better with one.** Mapping is incremental;
  unmapped nodes are valid but flagged.
- **Open codes in the open dump.** The redistributable dataset carries only
  open-licensed identifiers. Restricted ones (SNOMED/ICD-11 maps/ATC) are
  optional references resolved at query time, not shipped.
- **CURIEs everywhere.** Identifiers are compact prefixed IDs (§2), resolvable via
  community registries.

## 2. Identifier format — CURIEs

`external_ids[]` entries are **CURIEs** (compact URIs): `PREFIX:local_id`.

```
MONDO:0005010        HP:0002360         MESH:D012640
RXNORM:310965        CHEBI:15377        FOODON:00001234
GO:0006412           LOINC:44261-6      ROR:03vek6s52
ORCID:0000-0002-1825-0097              DOI:10.1001/jama.2018.12345
PMID:29677301        PMCID:PMC5980846
# optional, secondary / license-restricted:
SNOMED:22298006      ICD11:BA00         ATC:M05BA
```

- **Prefix authority:** [Bioregistry](https://bioregistry.io) (canonical
  prefixes & metadata).
- **Resolver:** [identifiers.org](https://identifiers.org) (turn a CURIE into a
  resolvable URL).
- A node may carry several CURIEs (one primary + secondary cross-references).

## 3. Per-node-type mapping

**Primary = open & redistributable. Secondary = optional, may be license-restricted.**

| Node type | Primary (open) | Secondary (optional) |
|-----------|----------------|----------------------|
| **Disease / Condition** | **MONDO** + MeSH | SNOMED, ICD-11, ICD-10 |
| **Symptom** | **HPO** + MeSH | SNOMED |
| **Outcome** | **LOINC** (observable) + MeSH; COMET core-outcome-set ref; else internal | SNOMED |
| **Population / Cohort** | internal (composed: age + condition + setting); OMOP/OHDSI cohort ref | SNOMED (situations) |
| **Intervention** | **MAxO** (medical actions) + MeSH | SNOMED (procedure) |
| **Exercise** | MeSH + MAxO; internal | SNOMED |
| **Nutrition** | **ChEBI** (nutrient) + **FoodOn** (food) + MeSH | USDA FDC; ATC (if drug-like) |
| **Drug** | **RxNorm** (prescribable subset) + ChEBI | ATC, SNOMED |
| **Mechanism / Process** | **GO** (biological) + **BCIO** (behavioral) + MeSH | — |
| **Scale** | **LOINC** (instruments) + MeSH | SNOMED (assessment scales) |
| **Tool** | internal + MeSH (devices) | SNOMED (devices) |
| **Research** | internal id; design via MeSH publication types | — |
| **Paper** | **DOI** + **PMID** (+ PMCID) | — |
| **Guideline** | issuer **ROR** + DOI/URL + year (no code) | — |
| **Expert** | **ORCID** | Wikidata |
| **Organization** | **ROR** | Wikidata, GRID (legacy) |
| **Technology** | MeSH where applicable + internal | — |

> Behavior-change interventions/mechanisms additionally use **BCIO** (Behaviour
> Change Intervention Ontology) / **BCT Taxonomy v1**.

## 4. Licensing & redistribution (verified, June 2026)

| Vocabulary | License / access | Use here |
|------------|------------------|----------|
| **MONDO** | CC BY 3.0 (OBO Foundry); bundles xrefs to SNOMED/ICD/MeSH/OMIM/Orphanet | Primary disease; also our bridge to reach SNOMED/ICD *without* licensing them |
| **HPO** | Open (permissive) | Primary symptom/phenotype |
| **MeSH** | NLM, **public domain** | Cross-cutting index, freely shippable |
| **RxNorm** | NLM free; full files need a (free) UMLS account; **Prescribable Subset is license-free**; `SAB=RXNORM` codes usable without UMLS | Use the **prescribable subset** for the open dump |
| **ChEBI** | CC BY 4.0 | Freely shippable |
| **FoodOn** | CC BY 3.0 | Freely shippable |
| **GO** | CC BY 4.0 | Freely shippable |
| **LOINC** | Free with LOINC license (attribution); includes assessment instruments (PHQ-9, etc.) | Ship LOINC codes per attribution terms |
| **ROR** | **CC0** (open API + dump) | Freely shippable |
| **ORCID** | Open | Freely shippable |
| **DOI / PMID / PMCID** | Open identifiers | Freely shippable |
| **ICD-11** | **CC BY-ND 3.0 IGO** — codes usable & citable, *no adaptation* | Store codes (cited, unmodified). ⚠️ **A crosswalk "our concept ↔ ICD-11" and translations require a separate WHO agreement** — do **not** ship an ICD-11 mapping table in the open dump |
| **ATC** | WHO Collaborating Centre (Oslo); **redistribution restricted** | Reference only; prefer RxNorm + ChEBI |
| **SNOMED CT** | Affiliate license; Canada via **Infoway** (free account, annual reconfirm); **redistribution restricted** | Secondary only; reach via MONDO/HPO xrefs; **never** in the open dump |

**The rule:** the public open dataset contains **only open-licensed codes**.
Anything license-restricted is either resolved at query time through a service the
user is licensed for, or omitted from the redistributable release.

## 5. Lookup & crosswalk services

**Implemented** (`src/codemap.ts`): an automated resolver attaches open CURIEs by
node type (§3) — MONDO/HP/GO/ChEBI/FoodOn via **EBI OLS4**, **MeSH** via NLM
E-utilities, **RxNorm** (drugs) via NLM RxNav, **ROR** (organisations) via the ROR
API, and **ORCID** (experts) via the ORCID public API. It never trusts an LLM for
an identifier: a code is accepted only when the authority's own label/synonym
matches the node's name or an alias (ORCID additionally requires a *unique* exact
name match, since person names collide). When no exact label matches, an optional
**AI disambiguation** step (a small model, on by default) picks the best of the
authority's *real* returned candidates — it can only choose from that list, so it
still can't invent an identifier — which lifts recall on descriptive node names.
Run it from the **Maintenance** panel in
`/admin` (a button that loops batches to completion) or via `POST /admin/map-codes`
(token-gated; `{limit, force}`). Resolved codes are merged into `external_ids` and
shown as authority links in the node view. Only open-licence codes are attached —
SNOMED/ICD/ATC are never written to the data.

How a curator finds a CURIE manually:

- **[Bioregistry](https://bioregistry.io)** — canonical prefixes & metadata.
- **EBI [OLS](https://www.ebi.ac.uk/ols4)** (Ontology Lookup Service) — search
  MONDO/HPO/GO/ChEBI/FoodOn/MAxO terms.
- **NCBO [BioPortal](https://bioportal.bioontology.org)** — broad ontology search
  + mappings.
- **UMLS Metathesaurus** — cross-vocabulary mapping (license required; use for
  lookup, not for shipping restricted codes).
- **MONDO/HPO built-in xrefs** — the open path to SNOMED/ICD identifiers without
  holding those licenses ourselves.

## 6. FHIR's role (not a code system)

FHIR is the **data-exchange / interoperability layer** — resource shapes and
*terminology bindings* — **not** a node vocabulary. The standards in §3 are the
*codes*; FHIR is *how* a system would exchange data that references them (and how
the GraceAge Companion's FHIR-ready features would bind to these vocabularies).
See [`03-architecture.md`](03-architecture.md) and
[`05-data-sources.md`](05-data-sources.md).

## 7. Workflow

1. Codes are added **incrementally** during curation/extraction — not required up
   front.
2. The AI **auto-linking** step (see [`04`](04-ai-capabilities.md#2-auto-linking--deduplication))
   proposes candidate CURIEs (primary first) for human review.
3. A node with no code is valid but carries `status` indicating it is unmapped, so
   gaps are visible and fixable.
4. Secondary/restricted codes (SNOMED/ICD-11/ATC) are stored as references but
   excluded from the open export per §4.
