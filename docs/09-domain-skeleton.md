# 09 · Domain Skeleton (broad coverage)

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

A **broad, shallow** map across all 15 [knowledge domains](02-knowledge-model.md#1-knowledge-domains).
For each domain it sketches the core node clusters (sample concepts by type), the
key intra-domain relationships, and the most important cross-domain links. This
is the skeleton on which curated, evidence-backed claims will later hang.

> **`status: skeleton`** — Everything here is a **structural placeholder**, not a
> curated claim. Concepts and links are illustrative starting points; each must
> be evidence-backed and graded per the [claim & evidence model](02-knowledge-model.md#5-evidence-model-graded--traceable)
> before it counts as knowledge. Breadth now, depth later.

## 中文摘要

本文件对全部 15 个领域做**广覆盖、浅层**的骨架勾画：每个领域列出核心节点簇（按类型给出
样例概念）、领域内关键关系，以及最重要的跨领域连接。这是后续挂接"有证据、已分级的主张"的骨架。

**注意：本文件全部标记 `status: skeleton`**——都是结构性占位，并非已策展的主张；每个概念与
连接都需按[证据模型](02-knowledge-model.md#5-evidence-model-graded--traceable)补充证据并分级后，
才算真正的知识。先求广度，再求深度。

节点类型缩写：Dis=Disease, Out=Outcome, Pop=Population, Int=Intervention,
Ex=Exercise, Nut=Nutrition, Drg=Drug, Mec=Mechanism, Scl=Scale, Tec=Technology,
Org=Organization, Gdl=Guideline。

---

## 1. Gerontology (整体老龄学)

- **Nodes:** (Pop) older adults, frail elderly, oldest-old; (Out) healthy
  life expectancy, quality of life, independence/ADL; (Dis) multimorbidity,
  geriatric syndromes; (Scl) Comprehensive Geriatric Assessment.
- **Intra-domain:** geriatric syndromes `→increases_risk_of→` loss of
  independence; CGA `assesses→` multiple outcomes.
- **Cross-domain:** umbrella over frailty, falls, dementia, caregiving — the hub
  domain linking all others.

## 2. Health informatics

- **Nodes:** (Tec) EHR, FHIR, knowledge graph, clinical decision support; (Tool)
  registries, dashboards; (Out) care coordination, data quality; (Org) standards
  bodies (HL7, SNOMED International).
- **Intra-domain:** FHIR `→improves→` interoperability; CDS `→improves→` adherence
  to guidelines.
- **Cross-domain:** the *enabling* domain — supports every other domain's data;
  links to AI in healthcare & digital health.

## 3. Nutrition

- **Nodes:** (Nut) protein intake, vitamin D, calcium, Mediterranean diet,
  omega-3; (Out) muscle mass, bone density, frailty status; (Dis) malnutrition,
  sarcopenia, osteoporosis; (Scl) MNA (Mini Nutritional Assessment).
- **Intra-domain:** protein intake `→improves→` muscle mass; vitamin D + calcium
  `→reduces_risk_of→` fractures.
- **Cross-domain:** → sarcopenia/frailty (muscle), → falls (vitamin D, with
  known **conflicting** evidence), → dementia (Mediterranean diet).

## 4. Exercise / physical activity

- **Nodes:** (Ex) resistance training, aerobic exercise, balance training, Tai
  Chi, multicomponent exercise; (Out) muscle strength, gait speed, fall rate,
  VO2max; (Mec) muscle protein synthesis; (Scl) SPPB, gait speed, TUG.
- **Intra-domain:** resistance training `is_a→` exercise; `→improves→` muscle
  strength `has_mechanism→` protein synthesis.
- **Cross-domain:** the highest-degree intervention hub — → falls, sarcopenia,
  frailty, cognition, mood, sleep.

## 5. Sleep

- **Nodes:** (Dis) insomnia, sleep apnea; (Int) sleep hygiene, CBT-I; (Out)
  sleep quality, daytime function; (Scl) PSQI, Epworth; (Drg) sedatives (caution).
- **Intra-domain:** CBT-I `→improves→` sleep quality; sedatives
  `→increases_risk_of→` falls.
- **Cross-domain:** → falls (sedatives, fatigue), → mental health (depression),
  → dementia (sleep–cognition link).

## 6. Mental health

- **Nodes:** (Dis) late-life depression, anxiety; (Out) mood, loneliness,
  wellbeing; (Int) social engagement, psychotherapy, behavioral activation; (Scl)
  GDS, PHQ-9, UCLA Loneliness Scale; (Mec) social connection.
- **Intra-domain:** social engagement `→improves→` mood `→reduces_risk_of→`
  depression.
- **Cross-domain:** → dementia (depression as risk factor), → frailty, → falls,
  → caregiving (caregiver burden).

## 7. Frailty

- **Nodes:** (Dis) frailty, pre-frailty; (Pop) frail older adults; (Out) frailty
  status, adverse outcomes (hospitalization, mortality); (Scl) Fried phenotype,
  Clinical Frailty Scale, Frailty Index; (Int) multicomponent exercise + protein.
- **Intra-domain:** frailty `→increases_risk_of→` falls/hospitalization;
  multicomponent intervention `→improves→` frailty status.
- **Cross-domain:** central node linking sarcopenia, falls, nutrition, exercise.

## 8. Falls

- **Nodes:** (Out) fall rate, fall-related injury, fear of falling; (Int) fall-
  prevention programs, home modification, balance training; (Scl) Tinetti, Berg
  Balance, TUG; (Pop) community-dwelling vs LTC.
- **Intra-domain:** balance training `→reduces_risk_of→` fall rate; home
  modification `→reduces_risk_of→` falls (esp. high-risk).
- **Cross-domain:** outcome hub fed by exercise, sarcopenia, frailty, sleep
  (sedatives), nutrition (vitamin D), polypharmacy.

## 9. Dementia & Alzheimer's disease

- **Nodes:** (Dis) Alzheimer's, vascular dementia, MCI; (Pop) people with MCI;
  (Out) cognitive decline, conversion to dementia; (Drg) cholinesterase
  inhibitors; (Int) cognitive training, physical activity; (Scl) MMSE, MoCA;
  (Mec) neuroplasticity.
- **Intra-domain:** MCI `→increases_risk_of→` dementia; physical activity
  `→reduces_risk_of→` cognitive decline.
- **Cross-domain:** ← exercise, nutrition (diet), sleep, mental health, hearing.

## 10. Caregiving

- **Nodes:** (Pop) family caregivers; (Out) caregiver burden, burnout, care
  quality; (Int) respite care, caregiver education, support groups; (Scl) Zarit
  Burden Interview.
- **Intra-domain:** respite care `→reduces_risk_of→` burnout; education
  `→improves→` care quality.
- **Cross-domain:** → dementia (dementia caregiving), → mental health, →
  palliative care, → digital health (remote support).

## 11. Palliative care

- **Nodes:** (Int) advance care planning, symptom management, hospice; (Out)
  quality of life at end of life, symptom burden, place of death; (Dis) serious
  illness, multimorbidity; (Scl) ESAS, IPOS.
- **Intra-domain:** advance care planning `→improves→` goal-concordant care;
  symptom management `→improves→` quality of life.
- **Cross-domain:** → caregiving, → dementia (advanced), → mental health.

## 12. Rehabilitation

- **Nodes:** (Int) physiotherapy, occupational therapy, post-stroke rehab,
  pulmonary rehab; (Out) functional recovery, ADL, mobility; (Dis) stroke, hip
  fracture; (Scl) Barthel Index, FIM.
- **Intra-domain:** physiotherapy `→improves→` mobility after hip fracture.
- **Cross-domain:** → falls (post-fall rehab), → exercise, → frailty.

## 13. AI in healthcare

- **Nodes:** (Tec) machine learning, LLM, RAG, predictive models, computer
  vision; (Tool) risk-prediction tools, fall-detection AI; (Out) early detection,
  triage accuracy; (Org) regulators.
- **Intra-domain:** predictive model `→improves→` early detection of
  deterioration; fall-detection AI `→measures→` fall events.
- **Cross-domain:** powers digital health, health informatics, falls (detection),
  dementia (screening) — links to the GraceAge Companion's agents.

## 14. Digital health

- **Nodes:** (Tec) wearables, telehealth, mobile apps, remote monitoring; (Tool)
  Apple Watch, Fitbit, smart scales, BP monitors; (Out) adherence, engagement,
  self-management; (Pop) tech-adopting vs digitally-excluded older adults.
- **Intra-domain:** remote monitoring `→improves→` self-management; wearables
  `→measure→` activity/gait/sleep.
- **Cross-domain:** sensor layer for falls, exercise, sleep, caregiving; overlaps
  AI in healthcare; digital exclusion links to health equity.

## 15. Behavior change

- **Nodes:** (Int) goal setting, habit formation, motivational interviewing,
  nudges; (Mec) self-efficacy, motivation; (Out) adherence, behavior maintenance;
  (Tec) behavior-change techniques (BCT taxonomy).
- **Intra-domain:** goal setting `→improves→` adherence `has_mechanism→`
  self-efficacy.
- **Cross-domain:** the *adoption* layer for every intervention — exercise,
  nutrition, sleep, digital health all depend on sustained behavior change.

---

## Cross-domain backbone (the high-value links)

The graph's payoff is the connective tissue between domains. Recurring hubs:

- **Exercise** → falls, sarcopenia, frailty, cognition, mood, sleep (widest reach).
- **Falls** ← exercise, frailty, sarcopenia, vitamin D, sedatives, polypharmacy
  (outcome hub).
- **Frailty** ↔ sarcopenia ↔ nutrition ↔ exercise (the physical-decline cluster).
- **Behavior change** & **digital health** → enable/deliver almost every
  intervention.
- **AI in healthcare** & **health informatics** → the infrastructure beneath all.

These backbone links are the first candidates to turn from `skeleton` into
curated, graded claims — and they are exactly what the cross-domain
[competency questions](08-competency-questions.md#f-cross-domain-the-real-payoff)
test.
