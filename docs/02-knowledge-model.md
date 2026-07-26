# 02 · Knowledge Model (Ontology)

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

This is the heart of the specification: how knowledge is represented. It defines
the **knowledge domains** we cover, the **node types**, the **relationship
types**, the **claim model** (every edge is a first-class, qualified assertion),
and the **evidence model** that grades and traces every claim. Code, schema, and
AI extraction must all conform to this model. Extending the model is allowed but
governed — see [`07-development-principles.md`](07-development-principles.md).

The model is **validated by the competency questions** in
[`08-competency-questions.md`](08-competency-questions.md): a change is only "done"
when the questions it targets become answerable.

## 中文摘要

本文件是规格说明的核心：定义知识如何被表示。包括我们覆盖的**知识领域**、**节点类型**、
**关系类型**、**主张模型**（每条边都是一等的、带限定词的断言），以及为每条主张分级与
溯源的**证据模型**。代码、数据库 schema 与 AI 抽取都必须遵循此模型。

关键设计：
- 节点类型从 13 扩展到 **17**，新增 **Outcome（结局）/ Population（人群）/ Guideline（指南）/ Mechanism（机制）**。
- 关系类型从 7 扩展到约 **14**，新增 `prevents / increases_risk_of / reduces_risk_of / is_a / part_of / recommends / diagnoses / has_mechanism`，并把泛化的 `related` 降级为临时占位。
- **边即主张（Claim）**：每条边携带 人群 / 场景 / 效应方向 / 效应量 / 剂量 / **GRADE 确定性** / 证据，让"维生素D→跌倒"能按人群与剂量给出不同甚至相反的结论。`recommends` 类主张另带**推荐强度（rec_strength）**，与证据确定性分属两个维度。
主张还可带**对照（comparator）**：缺省为"对照组"，当对照指向另一干预节点时即表达**比较效力**
（"A 比 B 更有效"），无需单独的 `more_effective_than` 关系。
- 证据对齐学术标准：每条证据记录其 **研究设计（CEBM 等级）**，每条主张记其 **GRADE 确定性**。

模型由 [`08-competency-questions.md`](08-competency-questions.md) 的能力问题来验证。

---

## 1. Knowledge domains

The graph spans these interlinked domains of healthy aging:

- Gerontology
- Health informatics
- Nutrition
- Exercise / physical activity
- Sleep
- Mental health
- Frailty
- Falls
- Dementia & Alzheimer's disease
- Caregiving
- Palliative care
- Rehabilitation
- AI in healthcare
- Digital health
- Behavior change

Domains are **tags/facets**, not silos — a node can belong to several, and the
value of the graph is precisely in the **cross-domain links** (e.g. exercise ↔
falls ↔ frailty). A broad, shallow map of each domain lives in
[`09-domain-skeleton.md`](09-domain-skeleton.md).

## 2. Node types

Every concept is a **node** with a stable ID, a type, a canonical name, and
type-specific attributes. Common attributes on every node: `id`, `type`,
`name`, `aliases[]`, `domains[]`, `description`, `external_ids[]` (open-first
**CURIEs**, e.g. `MONDO:0005010`, `MESH:D012640` — see the per-node-type mapping
in [`10-standards-alignment.md`](10-standards-alignment.md)),
`created_at`, `updated_at`.

| Node type | Represents | Example | Notable attributes |
|-----------|------------|---------|--------------------|
| **Disease / Condition** | A disease or health condition | Sarcopenia, Alzheimer's | ICD/SNOMED code, prevalence |
| **Symptom** | An observable sign/symptom | Gait instability | severity, body system |
| **Outcome** | A measurable endpoint/result studied | Fall rate, ADL independence, quality of life, mortality | measure, direction-of-good, time horizon |
| **Population / Cohort** | A defined group a claim applies to | Community-dwelling older adults; frail elderly; LTC residents; people with MCI | age range, setting, inclusion criteria |
| **Intervention** | A treatment/program (umbrella) | Fall-prevention program | category, setting |
| **Exercise** | A specific physical activity | Resistance training | intensity, frequency |
| **Nutrition** | A food/nutrient/diet pattern | Protein intake, vitamin D | dosage, RDA |
| **Drug** | A medication/compound | Bisphosphonates | mechanism, ATC code |
| **Mechanism / Process** | A biological/behavioral pathway explaining *why* an edge holds | Muscle protein synthesis; social engagement | type (biological/behavioral) |
| **Scale** | A measurement instrument | SPPB, MMSE, Tinetti | range, validity |
| **Tool** | A software/device/method | Wearable accelerometer | modality, vendor |
| **Research** | A study/experiment/trial | RCT on strength training | design, n, year |
| **Paper** | A single publication | A specific journal article | DOI, authors, year, venue |
| **Guideline** | A consensus recommendation document | WHO healthy-ageing guideline | issuer, year, grade scheme |
| **Expert** | A researcher/clinician | (named individual) | affiliation, ORCID |
| **Organization** | An institution/body | WHO, CDC | type, country |
| **Technology** | A technique/approach | RAG, LLM, FHIR | category |
| **Theory** | An explanatory theory | Cognitive discrepancy model of loneliness | proponent, field |
| **Model** | A conceptual/logic model | Behaviour-change logic model | components |
| **Knowledge gap** | A recorded gap in evidence/theory | "digital reminiscence for loneliness is under-studied" | domains, description |
| **Research question** | A question a gap generates | "does digital reminiscence reduce loneliness vs usual activities?" | domains |

**Theory / Model / Knowledge gap / Research question** were added so the graph
can support intervention-research workflows (Problem → Theory → Mechanism →
Intervention → Outcome → Measurement, plus evidence gaps). See
[`18-research-platform-readiness.md`](18-research-platform-readiness.md).

**Two concepts modeled as qualifiers/roles, not node types** (to avoid type
bloat):
- **Setting** (home / community / LTC / hospital / rehab) is a **claim
  qualifier** (controlled vocabulary), and may also appear on Population.
- **Risk factor** is a **role**, not a type — *any* node can be a risk factor,
  expressed through the `increases_risk_of` relationship.

> The type list is **extensible** but additions require updating this doc +
> schema migration + extractor rules together (see development principles).

## 3. Relationship types (edges)

Knowledge lives in the **edges**, and every edge is a **Claim** (section 4) with
a `type`, a direction, a source node, a target node, qualifiers, and evidence.
Core relationship types:

| Relationship | Direction (A → B) | Meaning |
|--------------|-------------------|---------|
| **treats** | Intervention/Drug → Disease/Symptom | A is used to treat existing B |
| **prevents** | Intervention/Drug → Disease/Outcome | A reduces the chance B occurs at all |
| **improves** | Intervention/Exercise/Nutrition → Outcome | A makes outcome B better |
| **worsens** | A → Outcome | A makes outcome B worse |
| **causes** | A → B | A deterministically/contributorily produces B |
| **increases_risk_of** | A → Disease/Outcome | A raises the probability of B (risk factor role) |
| **reduces_risk_of** | A → Disease/Outcome | A lowers the probability of B |
| **diagnoses / assesses** | Scale/Tool → Disease/Outcome | A is used to identify/quantify B |
| **measures** | Scale/Tool → Concept | A quantifies B (generic measurement) |
| **is_a / subtype_of** | A → B | A is a kind of B (taxonomy backbone) |
| **part_of** | A → B | A is a component of B |
| **recommends** | Guideline/Organization → Intervention | A recommends B (carries the guideline's own grade) |
| **explains** | Theory → Mechanism | theory A posits/explains mechanism B (structural) |
| **informs** | Theory/Model → Intervention | theory A informs the design of intervention B (structural) |
| **generates** | Knowledge gap → Research question | gap A gives rise to research question B (structural) |
| **has_mechanism** | Claim/edge → Mechanism | the claim operates via mechanism B |
| **evidence** | Paper/Research/Guideline → Claim | A provides evidence for claim B |
| **contradicts** | Claim → Claim | A's evidence conflicts with B |
| **related** | A ↔ B | Structural/navigational association (definitional, no evidence). Sanctioned for knowledge_gap ↔ the topics it concerns; otherwise a temporary placeholder — see note below |

Direction and semantics are **fixed per type** so the graph is queryable and the
AI extractor is unambiguous. New relationship types follow the same governance as
node types.

> ⚠️ **`related` for empirical claims is a code smell.** As an *evidential* edge
> it is a junk drawer — permitted only as a temporary placeholder (flag
> `status: needs_refinement`, replace with a specific type later). It has **one
> sanctioned structural use**: linking a `knowledge_gap` to the topic(s) it
> concerns, where it is definitional (no evidence required). `explains`,
> `informs` and `generates` (theory/gap scaffolding) are likewise **definitional**
> structural links — the empirical support lives on the intervention→outcome
> claims they point at, not on the structural edge itself.

### Why `is_a` matters

`is_a` / `part_of` give the graph a **skeleton (taxonomy)**. With
"Resistance training *is_a* Exercise", a query about *Exercise* can generalize
over all its subtypes, and a claim about a subtype can be reasoned about at the
parent level. Without it, the graph is flat and far less useful.

## 4. Claim model — every edge is a first-class assertion

An edge is not a bare line between two nodes; it is a **Claim** (a reified
assertion) that can be qualified, graded, evidenced, and contradicted. This is
what lets the same predicate hold *differently* for different people, settings,
or doses — and what makes honest handling of conflicting evidence possible.

```
Claim
├── id
├── type            relationship type (treats, reduces_risk_of, is_a, ...)
├── subject         node id (A)
├── object          node id (B)
├── population      → Population node (for whom; optional but encouraged)
├── setting         home | community | LTC | hospital | rehab | any
├── direction       increase | decrease | no_effect | mixed
├── effect_size     optional { value, measure }  e.g. { -0.23, "RR" }
├── comparator      optional — what the effect is measured against:
│                   a controlled value (placebo | usual_care | no_intervention)
│                   OR a node id for a head-to-head active comparator.
│                   Defaults to "control" if omitted.
├── dose            optional (e.g. "800 IU/day vitamin D")
├── certainty       GRADE: High | Moderate | Low | Very Low   (see §5)
├── rec_strength    optional — for `recommends` claims only: the issuing
│                   guideline's own recommendation grade, verbatim
│                   (e.g. "USPSTF B", "GRADE strong"). NOT the evidence
│                   certainty above — see design rule below.
├── status          curated | unverified | needs_refinement | skeleton
├── evidence[]      → EvidenceRecord (§5)
├── created_at
└── updated_at
```

Design rules:
- A claim with **no** evidence is allowed only as an explicit `status:
  unverified` (or `skeleton`) placeholder, and must be visibly flagged.
- **`contradicts`** claims are kept, not deleted — disagreement in the
  literature is itself knowledge, and is reconciled via population/dose
  qualifiers and certainty, not by silently picking a winner.
- `population`/`setting` scope a claim; an unscoped claim implicitly means
  "older adults, any setting" and should be tightened when evidence allows.
- **An effect is only meaningful relative to a `comparator`.** When the
  comparator is an active intervention node, the claim expresses **comparative
  effectiveness** (e.g. "intervention A reduces loneliness *more than* B"); this
  removes the need for a separate `more_effective_than` relationship. Omitting
  `comparator` means the usual "vs control". (Surfaced by the worked example in
  [`12-worked-example-social.md`](12-worked-example-social.md).)
- **`rec_strength` ≠ `certainty`.** A guideline's *recommendation strength*
  (how strongly it advises an action, e.g. USPSTF A/B/C/D/I or GRADE
  strong/weak) is a separate axis from the *certainty of the evidence* (GRADE
  High…Very Low). A strong recommendation can rest on low-certainty evidence and
  vice versa, so they are stored separately. `rec_strength` is recorded verbatim
  in the issuer's own scheme (the `Guideline` node carries that scheme); it is
  only meaningful on `recommends` claims. (Surfaced by the worked example in
  [`11-worked-example.md`](11-worked-example.md).)

## 5. Evidence model (graded & traceable)

**Every claim carries graded evidence.** This is the defining feature of GraceAge
Knowledge — it is not a graph of opinions, it is a graph of *claims with
traceable, graded support*. We use two recognized scales rather than an ad-hoc
one:

- **Per evidence record — study design / level** (aligned to **Oxford CEBM**):
- **Per claim — overall certainty** (aligned to **GRADE**): `High | Moderate |
  Low | Very Low`, reflecting the *body* of evidence, not a single study.

```
EvidenceRecord
├── source         Paper / Research / Guideline (node or external ref)
├── source_id      DOI / PubMed ID / URL
├── quote          The supporting statement (verbatim where possible)
├── study_design   systematic_review_or_meta_analysis | rct | cohort |
│                  case_control | cross_sectional | case_report |
│                  expert_opinion | guideline   (≈ CEBM level)
├── confidence     0..1 system/curator confidence in this extraction
├── extracted_by   human | model id (provenance of the extraction itself)
└── created_at
```

The claim's **`certainty` (GRADE)** is an aggregate over its evidence records
(study designs, consistency, directness, and presence of `contradicts` links),
not a copy of the single best study. GRADE as used here applies most cleanly to
therapy/prevention questions; prognostic/diagnostic claims may note the adapted
scale used.

## 6. Worked example (using the full model)

A small connected subgraph showing typed nodes, qualified claims, taxonomy, and
graded + conflicting evidence:

```
Nodes
  (Population)  Community-dwelling older adults
  (Population)  Frail older adults
  (Exercise)    Resistance training  ──is_a──▶ (Exercise) Exercise
  (Outcome)     Fall rate
  (Outcome)     Muscle strength
  (Disease)     Sarcopenia
  (Nutrition)   Vitamin D
  (Scale)       SPPB
  (Mechanism)   Muscle protein synthesis

Claims (edges)
  Resistance training ──improves──▶ Muscle strength
      population: older adults | direction: increase | certainty: High (meta-analysis)
      has_mechanism: Muscle protein synthesis
  Resistance training ──reduces_risk_of──▶ Fall rate
      population: community-dwelling older adults | direction: decrease | certainty: Moderate
  Exercise ──treats──▶ Sarcopenia
      certainty: High (systematic review)
  Sarcopenia ──worsens──▶ Muscle strength
      direction: decrease | certainty: High
  SPPB ──assesses──▶ Muscle strength            (also assesses physical function)

  Vitamin D ──reduces_risk_of──▶ Fall rate
      population: vitamin-D-deficient older adults | dose: 800 IU/day | certainty: Low
  Vitamin D ──reduces_risk_of──▶ Fall rate   ◀──contradicts──
      population: vitamin-D-replete older adults | dose: high-dose bolus | direction: increase (harm) | certainty: Low
```

Read as: *resistance training (a kind of exercise) increases muscle strength via
muscle protein synthesis with high certainty, and reduces falls in
community-dwelling older adults with moderate certainty; exercise is an
evidence-based treatment for sarcopenia. Vitamin D's effect on falls is
**conflicting** — it depends on the population and dose, so the two claims are
linked by `contradicts` and each is scoped and graded rather than averaged
away.* Every claim is independently scoped, graded, and citable, so a query like
"what reduces falls in frail older adults, and how strong is the evidence?"
returns **scoped answers with certainty and citations** — see the competency
questions in [`08-competency-questions.md`](08-competency-questions.md).
