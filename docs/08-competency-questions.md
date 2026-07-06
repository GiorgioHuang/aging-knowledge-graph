# 08 · Competency Questions

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

**Competency questions (CQs)** are the questions the knowledge graph must be able
to answer. They are a standard ontology-engineering tool: we design the model
*backward* from the questions it must serve, and we **validate** the model
against them. A change to the [knowledge model](02-knowledge-model.md) is only
"done" when the CQs it targets become answerable.

These CQs drive coverage, justify each node/relationship/qualifier type, and will
later become test queries against the real graph.

## 中文摘要

**能力问题（Competency Questions, CQ）** 是知识图谱**必须能回答**的问题清单，是本体工程的
标准做法：我们从"要回答的问题"反向设计模型，并用这些问题来**验证**模型。对
[知识模型](02-knowledge-model.md) 的任何修改，只有当它针对的 CQ 变得可回答时才算"完成"。

本文件按主题分组列出约 25 个代表性问题，并标注每个问题"考验"了哪些节点/关系/限定词类型。
这些问题也会在图谱建成后转化为测试查询。

---

## How to read this doc

Each question lists the **model elements it exercises** (node types, relationship
types, claim qualifiers). If a CQ cannot be expressed with the current model,
that is a signal the model needs extending — not that the CQ is wrong.

---

## A. Interventions & outcomes

1. **What interventions improve a given outcome (e.g. fall rate) in a given
   population, and how certain is the evidence?**
   *Exercises: Intervention/Exercise/Nutrition, Outcome, Population, `improves`/
   `reduces_risk_of`, `certainty` (GRADE).*
2. **Which non-drug interventions prevent (not just treat) a condition?**
   *Intervention, Disease, `prevents` vs `treats`.*
3. **What is the recommended first-line intervention for sarcopenia, and which
   guideline recommends it?**
   *Guideline, Intervention, Disease, `recommends`, `treats`.*
4. **For resistance training specifically, what outcomes does it affect, and via
   what mechanism?**
   *Exercise, Outcome, Mechanism, `improves`, `has_mechanism`.*
5. **Does an intervention's benefit differ by setting (home vs LTC vs hospital)?**
   *claim `setting` qualifier, Population, Outcome.*

## B. Measurement & scales

6. **Which scales assess physical function / muscle strength / cognition?**
   *Scale, Outcome/Disease, `assesses`/`measures`.*
7. **What does the SPPB measure, and what is its validity?**
   *Scale (attributes), `assesses`, Outcome.*
8. **Which tools or wearables can measure gait or falls?**
   *Tool, Outcome, `measures`.*

## C. Risk & causation

9. **What are the major risk factors for falls in older adults?**
   *any node in risk-factor role, Outcome/Disease, `increases_risk_of`,
   Population.*
10. **Which modifiable risk factors for dementia have intervention evidence?**
    *`increases_risk_of` + `reduces_risk_of`/`prevents` on the same target.*
11. **Distinguish: does X *cause* Y, or merely *increase the risk of* Y?**
    *`causes` (deterministic/contributory) vs `increases_risk_of`
    (probabilistic).*
12. **What is the causal/mechanistic pathway from sarcopenia to falls?**
    *Disease, Outcome, Mechanism, `worsens`/`increases_risk_of`,
    `has_mechanism`.*

## D. Evidence & conflict

13. **Where does the evidence conflict (e.g. vitamin D and falls), and what
    explains the conflict?**
    *`contradicts`, claim `population`/`dose` qualifiers, `certainty`.*
14. **Show me only High-certainty (GRADE) claims about a topic.**
    *claim `certainty` filter.*
15. **What is the strongest study design backing this claim, and the source?**
    *EvidenceRecord `study_design`, `source_id`, `quote`.*
16. **Which claims are currently `unverified` or `needs_refinement`?**
    *claim `status` (data-quality query).*
17. **How has certainty for a claim changed over time as evidence accumulated?**
    *EvidenceRecord timestamps/years → knowledge evolution.*

## E. Population scoping

18. **What is known specifically for frail older adults vs the general older
    population?**
    *Population, claim `population` scoping.*
19. **Which findings in community-dwelling adults have *not* been replicated in
    LTC residents?**
    *Population, `setting`, gap detection.*

## F. Cross-domain (the real payoff)

20. **Trace the chain exercise → muscle strength → falls → frailty: which links
    are well-evidenced and which are weak?**
    *cross-domain `improves`/`reduces_risk_of`, `certainty`, `is_a`.*
21. **How do sleep and mental health relate to fall risk?**
    *cross-domain links between Sleep, Mental health, Falls.*
22. **What interventions appear beneficial across multiple domains (e.g. exercise
    for falls *and* cognition *and* mood)?**
    *one Intervention node → multiple Outcomes across domains.*
23. **Which nutrition factors interact with frailty and sarcopenia together?**
    *Nutrition, Frailty, Sarcopenia cross-links.*

## G. Knowledge management & gaps

24. **Where are the research gaps — concepts with few or only low-certainty
    claims?**
    *node degree + `certainty` aggregation → gap detection.*
25. **For a given digital-health/AI tool, what outcomes has it been shown to
    affect, and at what evidence level?**
    *Technology/Tool, Outcome, `improves`, `study_design`.*

---

## Using CQs to validate the model

- Every node/relationship/qualifier type in
  [`02-knowledge-model.md`](02-knowledge-model.md) should be **justified by at
  least one CQ**. (If a type serves no CQ, question whether it belongs.)
- Every CQ should be **expressible** with the model. (If not, extend the model.)
- When the graph is built, these CQs become **acceptance tests**: each should
  return a correct, scoped, cited answer.
