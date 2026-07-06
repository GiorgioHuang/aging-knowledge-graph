# Glossary · 术语表

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

Bilingual definitions of key terms used across these docs.

## 中文摘要

本文件为各文档中关键术语的双语（英文 + 中文）定义，方便研究者、学生与照护者统一理解。

---

## Platform & method terms

| Term | 中文 | Definition |
|------|------|-----------|
| **Knowledge graph** | 知识图谱 | A network of concepts (nodes) connected by typed, meaningful relationships (edges). |
| **Node** | 节点 | A single concept/entity in the graph (e.g. a disease, exercise, paper). |
| **Edge / Relationship** | 边 / 关系 | A typed, directed link between two nodes (e.g. *treats*, *causes*). |
| **Claim / Assertion** | 主张 / 断言 | A first-class, reified edge carrying qualifiers (population, setting, direction, dose), certainty, and evidence — not just a bare link. |
| **Ontology** | 本体 | The formal model defining what node and relationship types exist and their meaning. |
| **Competency question** | 能力问题 | A question the graph must be able to answer; used to design and validate the model. |
| **Domain** | 领域 | A facet/topic area a node belongs to (e.g. nutrition, falls); nodes can have several. |
| **Evidence record** | 证据记录 | The source + quote + study design + confidence attached to a claim. |
| **Study design** | 研究设计 | The type of study backing an evidence record (RCT, cohort, …), ≈ Oxford CEBM level. |
| **GRADE** | GRADE 证据分级 | A recognized scheme rating a claim's overall certainty of evidence: High / Moderate / Low / Very Low. |
| **Recommendation strength** | 推荐强度 | How strongly a guideline advises an action (e.g. USPSTF A/B/C/D/I; GRADE strong/weak) — a separate axis from evidence certainty. Stored as `rec_strength`. |
| **Comparator** | 对照 | What a claim's effect is measured against (placebo / usual care / another intervention). An active comparator turns a claim into comparative effectiveness ("A more than B"). Stored as `comparator`. |
| **Provenance** | 来源 / 溯源 | The traceable origin of a piece of data — who or what created it and from where. |
| **Evidence scoring** | 证据评分 | Assigning a claim its GRADE certainty over its body of evidence. |
| **Semantic search** | 语义搜索 | Finding information by meaning (via embeddings), not exact keywords. |
| **Embedding** | 向量嵌入 | A numeric vector representing meaning, enabling similarity search (pgvector). |
| **RAG** | 检索增强生成 | Retrieval-Augmented Generation — answering questions grounded in retrieved, cited data. |
| **MCP** | 模型上下文协议 | Model Context Protocol — exposing tools/data so AI agents can use them. |
| **FHIR** | — | A standard for exchanging healthcare data between systems (an exchange layer, not a code system). |
| **SNOMED CT** | — | A comprehensive clinical terminology used to code diseases, symptoms, procedures (license-restricted; secondary here). |
| **CURIE** | 紧凑标识符 | A compact prefixed identifier, `PREFIX:local_id` (e.g. `MONDO:0005010`), resolvable via a registry. |
| **MONDO** | Mondo 疾病本体 | An open (CC BY) disease ontology that unifies SNOMED/ICD/MeSH/OMIM/Orphanet; primary code for disease nodes. |
| **OBO Foundry** | OBO 本体联盟 | A community of interoperable, openly licensed biomedical ontologies (MONDO, HPO, GO, ChEBI, FoodOn…). |
| **Bioregistry** | — | The canonical registry of CURIE prefixes and ontology metadata. |

## Aging & health terms

| Term | 中文 | Definition |
|------|------|-----------|
| **Aging well / Healthy aging** | 健康老龄化 | Maintaining function, independence, and wellbeing in older age. |
| **Gerontology** | 老年学 | The scientific study of aging and older adults. |
| **Health informatics** | 健康信息学 | The use of information/technology to improve health and care. |
| **Frailty** | 衰弱 | A state of reduced reserve and increased vulnerability in older adults. |
| **Sarcopenia** | 肌少症 | Age-related loss of muscle mass and strength. |
| **Falls** | 跌倒 | A major cause of injury/loss of independence in older adults. |
| **Dementia** | 痴呆 | A decline in cognitive function affecting daily life. |
| **Alzheimer's disease** | 阿尔茨海默病 | The most common cause of dementia. |
| **Palliative care** | 姑息治疗 / 安宁疗护 | Care focused on comfort and quality of life in serious illness. |
| **Rehabilitation** | 康复 | Interventions to restore function after illness/injury. |
| **Caregiving** | 照护 | Support provided to those who need help with daily living. |
| **Scale (instrument)** | 量表 | A validated tool to measure a construct (e.g. SPPB, MMSE). |
| **Outcome** | 结局指标 | A measurable endpoint a study cares about (fall rate, ADL independence, quality of life, mortality). |
| **Population / Cohort** | 人群 / 队列 | A defined group a claim applies to (e.g. community-dwelling older adults, frail elderly). |
| **Guideline** | 指南 | A consensus recommendation document (e.g. from WHO/CDC), distinct from a single paper. |
| **Mechanism** | 机制 | The biological/behavioral pathway explaining *why* a relationship holds. |
| **Behavior change** | 行为改变 | Methods to help people adopt healthier behaviors. |
