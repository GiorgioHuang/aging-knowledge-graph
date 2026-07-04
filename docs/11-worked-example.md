# 11 · Worked Example — Falls / Exercise / Strength (curated)

> Part of **GraceAge Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

This is the first **promotion of a backbone chain from `skeleton` to curated,
cited claims** — a real, end-to-end test of the model across
[`02` knowledge model](02-knowledge-model.md),
[`08` competency questions](08-competency-questions.md), and
[`10` standards alignment](10-standards-alignment.md). Every claim carries
real evidence (verified DOI/PMID, June 2026), real CURIE codes where confirmed,
GRADE certainty, and population/dose scoping. It doubles as **future V0 seed
data**.

A handful of codes are marked **`⚠ confirm`** — to be resolved against
Bioregistry / EBI OLS during curation, per the incremental workflow in
[`10` §7](10-standards-alignment.md#7-workflow). Codes are never invented; an
unconfirmed code is left explicit rather than guessed.

## 中文摘要

本文件把"运动 → 肌力 → 跌倒"这条跨域主干**从骨架（skeleton）转正为有证据、可引用的主张**，
是对模型（[02](02-knowledge-model.md) / [08](08-competency-questions.md) /
[10](10-standards-alignment.md)）的一次真实端到端测试。每条主张都带：**真实证据**
（已于 2026-06 联网核实的 DOI/PMID）、**CURIE 编码**（已核实者直接给出，未核实者标 `⚠ confirm`，
绝不臆造）、**GRADE 确定性**、以及人群/剂量限定。它同时可作为未来 **V0 的种子数据**。

并附**模型测试报告**（§6）：本例回答了 08 中的哪些能力问题，以及测试中发现的一个真实的模型缺口
（指南的"推荐强度"不同于证据的 GRADE 确定性）。

---

## 1. Scope

Two linked stories that stress the model:
1. **The positive backbone:** progressive resistance training *is a* form of
   exercise; it **increases muscle strength**; exercise **reduces fall rate** in
   community-dwelling older adults — each link scoped and GRADE-graded.
2. **The contradiction:** vitamin D for fall prevention — once assumed
   protective, now **no benefit** (USPSTF 2018) and **harmful at high annual
   doses** (Sanders 2010). This tests `contradicts`, `no_effect`, dose/population
   scoping, and knowledge evolution.

## 2. Nodes

GraceAge internal ids use the `ga:` prefix; `external_ids` use CURIEs (see
[`10` §2](10-standards-alignment.md#2-identifier-format--curies)).

| id | type | name | external_ids | domains |
|----|------|------|--------------|---------|
| `ga:pop-community-older` | Population | Community-dwelling older adults (65+) | internal | gerontology |
| `ga:pop-older-women-70` | Population | Community-dwelling women ≥70 | internal | gerontology |
| `ga:exercise` | Exercise | Exercise (physical activity) | `MESH:D015444` | exercise |
| `ga:resistance-training` | Exercise | Progressive resistance training | `MESH:D055070` | exercise |
| `ga:muscle-strength` | Outcome | Muscle strength | `MESH:D053580` | exercise, frailty |
| `ga:fall-rate` | Outcome | Fall rate (accidental falls) | `MESH:D000058` | falls |
| `ga:sarcopenia` | Disease | Sarcopenia | `MESH:D055948`; `MONDO:⚠ confirm` | frailty |
| `ga:vitamin-d` | Nutrition | Vitamin D | `MESH:D014807`; `CHEBI:⚠ confirm` | nutrition |
| `ga:sppb` | Scale | Short Physical Performance Battery (SPPB) | `LOINC:⚠ confirm` | frailty, rehabilitation |
| `ga:muscle-protein-synthesis` | Mechanism | Muscle protein synthesis | `GO:⚠ confirm` | exercise |
| `ga:uspstf` | Organization | US Preventive Services Task Force | `ROR:⚠ confirm` | health informatics |
| `ga:gdl-uspstf-falls-2018` | Guideline | USPSTF 2018 Falls Prevention Recommendation | `PMID:29710141` | falls |

> Verified CURIEs: `MESH:D000058` (Accidental Falls), `MESH:D055070`
> (Resistance Training), `MESH:D053580` (Muscle Strength). Others are standard
> but marked `⚠ confirm` where not re-verified at source this round.

## 3. Claims (curated)

Each claim follows the [claim model](02-knowledge-model.md#4-claim-model--every-edge-is-a-first-class-assertion).
`evidence` ids reference §5.

```yaml
# C1 — taxonomy backbone (definitional)
- id: ga:c1
  type: is_a
  subject: ga:resistance-training
  object: ga:exercise
  status: curated            # definitional; no empirical evidence needed

# C2 — resistance training increases muscle strength
- id: ga:c2
  type: improves
  subject: ga:resistance-training
  object: ga:muscle-strength
  population: ga:pop-community-older
  direction: increase
  effect_size: { note: "large improvement in strength across >100 trials" }
  has_mechanism: ga:muscle-protein-synthesis
  certainty: High
  status: curated
  evidence: [E-LiuLatham-2009]

# C3 — exercise reduces the rate of falls
- id: ga:c3
  type: reduces_risk_of
  subject: ga:exercise
  object: ga:fall-rate
  population: ga:pop-community-older
  setting: community
  direction: decrease
  effect_size: { value: 0.66, measure: "RaR", ci95: "0.50–0.88",
                 note: "multiple-category exercise (balance/functional + resistance)" }
  certainty: High
  status: curated
  evidence: [E-Sherrington-2019, E-USPSTF-2018]

# C4 — SPPB assesses muscle strength / physical function
- id: ga:c4
  type: assesses
  subject: ga:sppb
  object: ga:muscle-strength
  status: curated            # measurement relationship

# C5 — sarcopenia is characterised by low muscle strength
- id: ga:c5
  type: worsens
  subject: ga:sarcopenia
  object: ga:muscle-strength
  direction: decrease
  certainty: High
  status: curated
  evidence: [E-EWGSOP2-2019]   # EWGSOP2 diagnostic criteria

# C6 — exercise as treatment for sarcopenia (gap: needs sarcopenia-specific RCT)
- id: ga:c6
  type: treats
  subject: ga:exercise
  object: ga:sarcopenia
  status: unverified         # plausible/indirect; awaiting a sarcopenia-specific source
  note: "Demonstrates the unverified-placeholder rule (02 §4); flagged, not hidden."

# C7 — recommendation (guideline grade ≠ GRADE certainty; see §6 finding)
- id: ga:c7
  type: recommends
  subject: ga:gdl-uspstf-falls-2018
  object: ga:exercise
  population: ga:pop-community-older
  rec_strength: "USPSTF B"   # guideline's own grade — now in the model (02 §4)
  status: curated
  evidence: [E-USPSTF-2018]
```

## 4. The vitamin D contradiction

```yaml
# H1 — historical hypothesis: vitamin D broadly prevents falls
- id: ga:h1
  type: reduces_risk_of
  subject: ga:vitamin-d
  object: ga:fall-rate
  population: ga:pop-community-older
  direction: decrease
  certainty: Very Low
  status: unverified        # superseded belief; kept for knowledge-evolution, no fabricated source

# C8 — USPSTF 2018: vitamin D has NO benefit for falls (community-dwelling)
- id: ga:c8
  type: reduces_risk_of
  subject: ga:vitamin-d
  object: ga:fall-rate
  population: ga:pop-community-older
  direction: no_effect
  certainty: Moderate
  status: curated
  evidence: [E-USPSTF-2018]

# C9 — Sanders 2010: a single annual HIGH dose INCREASES falls (harm)
- id: ga:c9
  type: increases_risk_of
  subject: ga:vitamin-d
  object: ga:fall-rate
  population: ga:pop-older-women-70
  dose: "500,000 IU oral, once yearly (bolus)"
  direction: increase
  certainty: Moderate
  status: curated
  evidence: [E-Sanders-2010]

# contradiction links (kept, not deleted — see 02 §4)
- { type: contradicts, subject: ga:c8, object: ga:h1 }
- { type: contradicts, subject: ga:c9, object: ga:h1 }
```

**Reading it:** the once-common belief that vitamin D broadly prevents falls
(`H1`) is contradicted by high-certainty-of-*no-benefit* evidence (`C8`) and by
evidence of *harm* at a high annual bolus dose (`C9`). The model resolves the
conflict by **scoping on population and dose** and keeping the contradiction
explicit, rather than averaging the claims into a misleading "mixed" result.

## 5. Sources (verified, June 2026)

- **E-EWGSOP2-2019** — Cruz-Jentoft AJ, Bahat G, Bauer J, et al. *Sarcopenia:
  revised European consensus on definition and diagnosis (EWGSOP2).* Age Ageing.
  2019;48(1):16–31. DOI: `10.1093/ageing/afy169`. Defines sarcopenia by low
  muscle strength as the primary characteristic.
- **E-Sherrington-2019** — Sherrington C, Fairhall NJ, Wallbank GK, et al.
  *Exercise for preventing falls in older people living in the community.*
  Cochrane Database Syst Rev. 2019;1:CD012424.
  DOI: `10.1002/14651858.CD012424.pub2` (abridged: BJSM, PMID `31792067`).
  Finding: multiple-category exercise reduces the rate of falls (RaR 0.66, 95% CI
  0.50–0.88); exercise reduces falls with high-certainty evidence overall.
- **E-LiuLatham-2009** — Liu C-J, Latham NK. *Progressive resistance strength
  training for improving physical function in older adults.* Cochrane Database
  Syst Rev. 2009;(3):CD002759. DOI: `10.1002/14651858.CD002759.pub2`;
  PMID `19588334`. Finding: large improvement in muscle strength; improves
  physical function.
- **E-USPSTF-2018** — US Preventive Services Task Force. *Interventions to Prevent
  Falls in Community-Dwelling Older Adults: USPSTF Recommendation Statement.*
  JAMA. 2018;319(16):1696–1704. PMID `29710141`. Findings: exercise
  recommended (B); vitamin D supplementation has **no benefit** for preventing
  falls (D).
- **E-Sanders-2010** — Sanders KM, Stuart AL, Williamson EJ, et al. *Annual
  high-dose oral vitamin D and falls and fractures in older women: a randomized
  controlled trial.* JAMA. 2010;303(18):1815–1822. DOI: `10.1001/jama.2010.594`;
  PMID `20460620`. Finding: a single annual 500,000 IU dose **increased** falls
  and fractures.

## 6. Model-test report

**What this validated (the model held up):**
- **Population & dose qualifiers are essential and sufficient** — they cleanly
  separate "no benefit" (`C8`) from "harm at megadose" (`C9`) without conflict.
- **`direction: no_effect`** correctly captures *evidence of absence* (USPSTF),
  distinct from "unknown".
- **`contradicts` + retained claims** express the vitamin D story honestly and
  power knowledge-evolution queries.
- **`is_a` taxonomy** lets `ga:resistance-training` inherit into queries about
  `ga:exercise`.
- **`status: unverified`** (`C6`, `H1`) flags gaps instead of hiding them, and is
  exactly what gap-detection queries need.

**Competency questions answered** (see [`08`](08-competency-questions.md)):
CQ1, CQ4, CQ9–CQ11, CQ13, CQ14, CQ17, CQ18, CQ20, CQ24 — e.g. *"what reduces
falls in older adults, and how strong is the evidence?"* → `C3` (High); *"where
does the evidence conflict?"* → the vitamin D cluster.

**Gap found → refinement (now closed):**
- A guideline's **recommendation strength** (e.g. USPSTF **B**/**D**, GRADE
  *strong/weak*) is **not the same** as a claim's **GRADE certainty of
  evidence**. This test surfaced the need for a separate qualifier; it has been
  **folded into the model** as `rec_strength` on `recommends` claims — see
  [`02` §4](02-knowledge-model.md#4-claim-model--every-edge-is-a-first-class-assertion)
  (`C7` above uses it).
