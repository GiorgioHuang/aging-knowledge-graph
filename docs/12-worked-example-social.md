# 12 · Worked Example — Social Participation / Loneliness / Depression (curated)

> Part of **GraceAge Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

The second **promotion of a backbone chain from `skeleton` to curated, cited
claims** — this time in the **mental-health** domain, to stress-test the model
([`02`](02-knowledge-model.md) / [`08`](08-competency-questions.md) /
[`10`](10-standards-alignment.md)) on a different kind of evidence (observational
cohorts + a comparative-effectiveness meta-analysis). All evidence is real and
verified (DOI/PMID, June 2026). Doubles as **future V0 seed data**.

Codes marked **`⚠ confirm`** are to be resolved against Bioregistry / EBI OLS
during curation ([`10` §7](10-standards-alignment.md#7-workflow)); codes are never
invented.

## 中文摘要

第二条**从骨架转正为有证据、可引用主张**的跨域主干，这次落在**心理健康**域：
"社交参与 → 孤独 → 抑郁"，并扩展到孤独 → 死亡率 / 痴呆。用以在**不同类型的证据**
（观察性队列 + 一项比较效力的 meta 分析）上压测模型。所有证据均真实且已于 2026-06 联网核实。

**测试报告（§6）** 又发现一个真实缺口：现有 `effect_size` 无法表达"效应相对于哪个对照"
（comparator），也无法表达"干预 A 比干预 B 更有效"——这正是 Masi 2011 的关键结论
（处理"适应不良的社会认知"比单纯增加社交接触更有效）。建议下一步把 `comparator` 并入模型。

并附一个建模观察：**社交参与/社会隔离属"社会决定因素/暴露"**，目前借用 Intervention/Outcome
表示，未来或需一个 Exposure/Determinant 节点类型。

---

## 1. Scope

- **The spine:** **social participation** reduces **loneliness**; **loneliness**
  raises the risk of **depression**. So social participation is protective
  against depression largely *through* reduced loneliness.
- **Extensions (why it matters):** loneliness and social isolation also raise the
  risk of **all-cause mortality** and **dementia** — the same node sits in
  several domains (mental health ↔ gerontology ↔ dementia).
- **The nuance:** not all "social" interventions work equally — addressing
  *maladaptive social cognition* outperforms simply increasing social contact
  (Masi 2011). This tests whether the model can express **comparative
  effectiveness**.

## 2. Nodes

`ga:` = GraceAge internal id; `external_ids` are CURIEs
([`10` §2](10-standards-alignment.md#2-identifier-format--curies)).

| id | type | name | external_ids | domains |
|----|------|------|--------------|---------|
| `ga:pop-older` | Population | Older adults (65+) | internal | gerontology |
| `ga:social-participation` | Intervention | Social participation | `MESH:D058992` | mental health, behavior change |
| `ga:social-intervention` | Intervention | Social/psychological intervention for loneliness | internal | mental health |
| `ga:loneliness` | Outcome | Loneliness (subjective) | `MESH:D008132` | mental health |
| `ga:social-isolation` | Outcome | Social isolation (objective) | `MESH:D012934` | mental health |
| `ga:depression` | Disease | Depressive disorder | `MESH:D003866`; `MONDO:⚠ confirm` | mental health |
| `ga:dementia` | Disease | Dementia | `MESH:D003704`; `MONDO:⚠ confirm` | dementia |
| `ga:mortality` | Outcome | All-cause mortality | `MESH:D009026` | gerontology |
| `ga:maladaptive-social-cognition` | Mechanism | Maladaptive social cognition | `MESH:⚠ confirm` | mental health |
| `ga:ucla` | Scale | UCLA Loneliness Scale | `LOINC:⚠ confirm` | mental health |
| `ga:phq9` | Scale | Patient Health Questionnaire-9 (PHQ-9) | `LOINC:44249-1` | mental health |

> Verified CURIEs: `MESH:D008132` (Loneliness), `MESH:D012934` (Social
> Isolation), `MESH:D058992` (Social Participation), `MESH:D003866` (Depressive
> Disorder), `LOINC:44249-1` (PHQ-9). `loneliness` vs `social-isolation` are kept
> **distinct** (subjective state vs objective lack of contact).

## 3. Claims (curated)

```yaml
# C1 — social participation reduces loneliness
- id: ga:c1
  type: reduces_risk_of
  subject: ga:social-participation
  object: ga:loneliness
  population: ga:pop-older
  direction: decrease
  certainty: Low            # mostly observational; intervention effects small–moderate
  status: curated
  evidence: [E-Masi-2011]

# C2 — loneliness increases risk of depression (longitudinal)
- id: ga:c2
  type: increases_risk_of
  subject: ga:loneliness
  object: ga:depression
  population: ga:pop-older
  direction: increase
  certainty: Moderate
  status: curated
  evidence: [E-Cacioppo-2006]

# C3 — loneliness increases all-cause mortality
- id: ga:c3
  type: increases_risk_of
  subject: ga:loneliness
  object: ga:mortality
  direction: increase
  effect_size: { value: 1.26, measure: "OR", note: "+26% odds of mortality" }
  certainty: Moderate
  status: curated
  evidence: [E-HoltLunstad-2015]

# C4 — social isolation increases all-cause mortality
- id: ga:c4
  type: increases_risk_of
  subject: ga:social-isolation
  object: ga:mortality
  direction: increase
  effect_size: { value: 1.29, measure: "OR", note: "+29% odds of mortality" }
  certainty: Moderate
  status: curated
  evidence: [E-HoltLunstad-2015]

# C5 — loneliness / low social engagement increases dementia risk
- id: ga:c5
  type: increases_risk_of
  subject: ga:loneliness
  object: ga:dementia
  direction: increase
  certainty: Low
  status: curated
  evidence: [E-Penninkilampi-2018]

# C6 — social participation directly reduces depression (gap: needs verified cohort)
- id: ga:c6
  type: reduces_risk_of
  subject: ga:social-participation
  object: ga:depression
  population: ga:pop-older
  direction: decrease
  status: unverified        # plausible direct + composed path C1→C2; awaiting a verified cohort
  note: "Composed path (C1 then C2) is the evidenced route; direct claim flagged."

# measurement
- { id: ga:c7, type: assesses, subject: ga:ucla,  object: ga:loneliness,  status: curated }
- { id: ga:c8, type: assesses, subject: ga:phq9,  object: ga:depression,  status: curated }
```

## 4. The intervention nuance (comparative effectiveness)

Masi 2011 (meta-analysis, 50 studies) found loneliness interventions have a
**small-to-moderate** effect overall, but in RCTs the **most effective**
interventions addressed **maladaptive social cognition** — *more* than those that
merely increased social contact or support.

```yaml
# C9 — the effective lever runs via maladaptive social cognition
- id: ga:c9
  type: reduces_risk_of
  subject: ga:social-intervention
  object: ga:loneliness
  population: ga:pop-older
  direction: decrease
  has_mechanism: ga:maladaptive-social-cognition
  comparator: "social-contact-only interventions"   # active comparator → comparative effectiveness
  certainty: Moderate
  status: curated
  evidence: [E-Masi-2011]
```

The `comparator` field (now first-class in
[`02` §4](02-knowledge-model.md#4-claim-model--every-edge-is-a-first-class-assertion))
lets this claim express **comparative effectiveness** — the cognitive-focused
intervention reduces loneliness *more than* a social-contact-only comparator.

## 5. Sources (verified, June 2026)

- **E-Masi-2011** — Masi CM, Chen H-Y, Hawkley LC, Cacioppo JT. *A meta-analysis
  of interventions to reduce loneliness.* Pers Soc Psychol Rev. 2011;15(3):219–266.
  DOI: `10.1177/1088868310377394`. Finding: small-moderate overall effect; in
  RCTs, addressing maladaptive social cognition was most effective.
- **E-Cacioppo-2006** — Cacioppo JT, Hughes ME, Waite LJ, Hawkley LC, Thisted RA.
  *Loneliness as a specific risk factor for depressive symptoms: cross-sectional
  and longitudinal analyses.* Psychol Aging. 2006;21(1):140–151. DOI:
  `10.1037/0882-7974.21.1.140`. Finding: loneliness predicts later depressive
  symptoms, net of confounders.
- **E-HoltLunstad-2015** — Holt-Lunstad J, Smith TB, Baker M, Harris T,
  Stephenson D. *Loneliness and social isolation as risk factors for mortality: a
  meta-analytic review.* Perspect Psychol Sci. 2015;10(2):227–237. DOI:
  `10.1177/1745691614568352`; PMID `25910392`. Findings: social isolation
  OR 1.29; loneliness OR 1.26.
- **E-Penninkilampi-2018** — Penninkilampi R, Casey A-N, Singh MF, Brodaty H.
  *The association between social engagement, loneliness, and risk of dementia: a
  systematic review and meta-analysis.* J Alzheimers Dis. 2018;66(4):1619–1633.
  DOI: `10.3233/JAD-180439`. Finding: poor social engagement / loneliness
  associated with higher dementia risk (~2.37M participants).

## 6. Model-test report

**What this validated (the model held up):**
- **One node, many domains** — `ga:loneliness` participates in mental-health,
  gerontology (mortality), and dementia claims, exactly the cross-domain payoff
  [`08` §F](08-competency-questions.md#f-cross-domain-the-real-payoff) targets.
- **Distinct subjective vs objective nodes** — loneliness (`D008132`) and social
  isolation (`D012934`) are separate, each with its own evidence (`C3` vs `C4`).
- **Risk-factor-as-role** works — loneliness is an Outcome that *also* drives
  `increases_risk_of` edges; no separate "RiskFactor" type needed.
- **Composed paths + `status: unverified`** — the protective effect of social
  participation on depression is the evidenced path `C1→C2`, while the direct
  claim `C6` is honestly flagged pending a verified cohort.

**Competency questions answered:** CQ1, CQ9–CQ11, CQ18, CQ20, CQ21, CQ24 — e.g.
*"how do mental-health factors relate to mortality and dementia risk?"*

**Gap found → refinement (now closed):**
- **No `comparator` on claims.** Effect sizes were implicitly "vs control", with
  no way to express **comparative effectiveness** ("A reduces loneliness *more
  than* B") — yet that is Masi 2011's main message (`C9`). An optional
  **`comparator`** field has been **folded into the model**
  ([`02` §4](02-knowledge-model.md#4-claim-model--every-edge-is-a-first-class-assertion)):
  a controlled value (`placebo | usual_care | no_intervention`) or a node id for
  a head-to-head comparator — which also removes the need for a separate
  `more_effective_than` relationship. (Same test → fix loop that produced
  `rec_strength`.)

**Modeling observation:**
- **Social participation / isolation are social determinants/exposures**, not
  clinical interventions. They are currently modeled as Intervention/Outcome,
  which works but is a slight stretch. A dedicated **Exposure / Determinant** node
  type may be worth considering later — noted, not yet acted on.
