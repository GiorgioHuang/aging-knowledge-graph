# 19 · Capabilities & Integration Guide — for the Digital Intervention Research Platform

> Part of **Healthy Aging Knowledge**. This is the **outward-facing** companion to
> the internal audit in [`18-research-platform-readiness.md`](18-research-platform-readiness.md):
> *what we provide today* and *how to integrate*. The gap analysis behind it lives
> in doc 18; this doc is the current state.

**Status: Ready.** The schema, MCP surface, and query capabilities the platform's
framework assumes (P0–P2) are implemented. The remaining work is **content
depth** in the priority domains — a continuous population effort, not a schema
change.

- **Live:** `https://ack.icareu.cc` — REST + MCP over Neon (Postgres + pgvector).
- **MCP endpoint:** `POST https://ack.icareu.cc/mcp` (JSON-RPC) or stdio locally.
- **Tools:** 16 read-only MCP tools, prefix `graceage_`.

## 中文摘要

这是给 **Digital Intervention Research Platform** 团队的对外《能力与集成指南》(doc 18 是内部差距审计,本文是当前状态)。**P0–P2 全部实现**:研究平台框架假设的实体、关系、MCP 查询都已就绪,剩下的是优先领域的**内容深度**(持续填充,非 schema 问题)。线上 `https://ack.icareu.cc`,MCP 走 `POST /mcp`(JSON-RPC),共 **16 个只读工具**(前缀 `graceage_`)。把它当作平台的**证据/理论服务**:每个 claim 都带来源、研究设计、GRADE 置信度和核验状态——**据此对设计决策做置信度门控**,`unverified/needs_refinement/skeleton` 视为暂定。

---

## 1. What the graph provides

An **evidence-and-provenance backbone** for healthy-aging intervention research.
The full research chain is expressible and queryable end-to-end:

```
Problem/Population → Theory → Mechanism → Intervention (+ Components)
                                        → Outcome → Measurement → Evidence
```

Every edge is a **Claim** carrying its own provenance:

- **source id** — real `PMID:` / `DOI:` / `URL:` (never fabricated);
- **verbatim quote**, **study design** (SR/meta-analysis, RCT, cohort, …);
- **GRADE certainty** (high / moderate / low / very_low);
- **verification status** (`curated` / `unverified` / `needs_refinement` / `skeleton`);
- optional **direction, effect size, comparator, dose, population, mechanism**.

**Honest uncertainty is a feature.** Weak, unverified, and conflicting evidence is
*marked as such*, not presented as strong. A Reviewer agent (Opus 5) verifies each
citation against PubMed/Crossref + an LLM judge before a claim becomes `curated`.

## 2. Entity & relationship model

**Node types** (22): `disease, symptom, outcome, population, intervention,
intervention_component, exercise, nutrition, drug, mechanism, scale, tool,
research, paper, guideline, expert, organization, technology, theory, model,
knowledge_gap, research_question`.

**Relationship types** (19): `treats, prevents, improves, worsens, causes,
increases_risk_of, reduces_risk_of, diagnoses, assesses, measures, is_a, part_of,
recommends, related, explains, informs, generates, operates_through,
contributes_to`.

**Mapping to the platform's requested entities** — all covered:

| Requested entity | In the graph |
|---|---|
| Intervention | `intervention` |
| Intervention Component | `intervention_component` (`part_of`) |
| Mechanism of Action | `mechanism` + `operates_through` / `contributes_to` |
| Outcome | `outcome` (direction, effect size, certainty) |
| Measurement Instrument | `scale` / `tool` (`measures` / `assesses`) |
| Population | `population` (`for_population`) |
| Guideline | `guideline` (+ `recommends`, strength grade) |
| Evidence Source | `paper` + evidence `source_id` |
| SR / Meta-analysis / Study | `study_design` attribute on evidence |
| Theory / Model | `theory` / `model` (`explains` / `informs`) |
| Knowledge Gap / Research Question | `knowledge_gap` / `research_question` (`generates`) |
| Risk | modelled as a **role** via `increases_risk_of` / `worsens` (no separate type) |

Every node also carries standards CURIEs where resolvable
(MONDO / HP / GO / ChEBI / FoodOn / MeSH / RxNorm / ROR / ORCID) as stable join
keys for interoperability.

## 3. The 16 MCP tools

Each is an MCP tool named `graceage_<name>` (also `GET /query/<name>` over REST).

| Tool | Args | What it answers |
|---|---|---|
| `search` | `q`, `k?`, `owner?` | semantic search over nodes/claims (entry points) |
| `list_nodes` | `type?`, `domain?`, `q?` | browse entities (e.g. all `theory`, all `scale`) |
| `list_claims` | `type?`, `status?`, `certainty?`, `subject?`, `object?` | browse relationships with filters |
| `get_node` | `id` | one node |
| `node_detail` | `id` | a node's in/out claims **with evidence** + neighbours |
| `neighbourhood` | `node` | every claim touching a node |
| `what_affects` | `object`, `protective?` | what affects an outcome (direction + GRADE + citations) |
| `for_population` | `population` | everything scoped to a population |
| `high_certainty_about` | `node` | only high-certainty claims on a topic |
| `comparative` | — | comparative-effectiveness claims |
| `conflicts` | — | contradicting claims, with the scoping that explains them |
| `gaps` | — | data-quality gaps (unverified / needs_refinement / skeleton) |
| `knowledge_gaps` | `topic?` | first-class knowledge gaps + the research questions they generate |
| `evidence_landscape` | `topic` | a topic's evidence: **direct / indirect / conflicting / weak** |
| `recommendations` | `population?`, `issuer?` | authoritative `recommends` claims + strength grades (policy view) |
| `path` | `from`, `to`, `max_hops?` | shortest connecting chain across the full research chain |

## 4. Integration patterns

**Point the platform's research agent at `POST /mcp`.** Typical design-task flow:

1. **Find entry nodes** — `search` on the problem/intervention/outcome in plain
   language; take the `ga:*` ids from the hits.
2. **Pull the evidence** — `node_detail` for claims + evidence + neighbours, or
   `what_affects` for "what improves/reduces this outcome, with certainty".
3. **Trace the chain** — `path(from, to)` to connect e.g. a problem to an
   instrument in one call (Problem→Theory→Mechanism→Intervention→Outcome→Measurement).
4. **Assess maturity** — `evidence_landscape(topic)` to see where evidence is
   direct vs. mechanism-mediated vs. conflicting vs. thin; `knowledge_gaps(topic)`
   for the open research questions.
5. **Policy view** — `recommendations(population?, issuer?)` for what authorities
   actually recommend, with strength grades.

### Example calls

```jsonc
// 1 · semantic entry point
{"method":"tools/call","params":{"name":"graceage_search",
  "arguments":{"q":"reducing loneliness in older adults","k":8}}}

// 2 · what protects an outcome (direction + GRADE + citations)
{"method":"tools/call","params":{"name":"graceage_what_affects",
  "arguments":{"object":"ga:loneliness","protective":true}}}

// 3 · trace the chain in one call
{"method":"tools/call","params":{"name":"graceage_path",
  "arguments":{"from":"ga:reminiscence-therapy","to":"ga:wellbeing"}}}

// 4 · where is the evidence direct / indirect / conflicting / thin?
{"method":"tools/call","params":{"name":"graceage_evidence_landscape",
  "arguments":{"topic":"ga:loneliness"}}}

// 4 · open research questions for a topic
{"method":"tools/call","params":{"name":"graceage_knowledge_gaps",
  "arguments":{"topic":"digital reminiscence for loneliness"}}}

// 5 · policy: authoritative recommendations for a population
{"method":"tools/call","params":{"name":"graceage_recommendations",
  "arguments":{"population":"ga:pop-community-older"}}}
```

REST equivalent (no MCP client needed):

```bash
curl "https://ack.icareu.cc/query/what_affects?object=ga:loneliness&protective=true"
curl -X POST https://ack.icareu.cc/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"graceage_evidence_landscape","arguments":{"topic":"ga:loneliness"}}}'
```

## 5. Using it responsibly

- **Always read provenance.** Every claim returns `source_id`, `study_design`,
  `certainty`, and `status`. **Gate design decisions on certainty/status** — treat
  `unverified` / `needs_refinement` / `skeleton` as provisional, not settled.
- **Distinguish direct from indirect.** `evidence_landscape` separates direct
  claims from mechanism-mediated (indirect) ones — don't read an indirect link as
  a demonstrated end-to-end effect.
- **Reminiscence / life-story ≠ cognitive training.** The graph models these as
  identity/engagement interventions (`part_of` psychosocial intervention), a
  distinction the platform requires — see the `intervention_component` /
  `operates_through` modelling.

## 6. Closing the loop (contributing back)

The graph is shared, growing infrastructure — the platform can feed it:

- **New findings** → the token-gated write path (`POST /claims` + evidence), which
  the Reviewer then verifies. Keeps `Evidence → Intervention → Design →
  Evaluation → New Evidence` a closed loop.
- **Gaps you hit** → push as Curator topics so the graph fills the exact areas the
  platform needs next.
- **Stable identifiers.** `ga:*` node ids and standards CURIEs are stable join
  keys the platform can store alongside its own design artifacts.

## 7. What's mature vs. growing

- **Schema & MCP:** ✅ complete for the platform's needs (P0–P2).
- **Content:** the *backbone* (falls/exercise, social/loneliness, dementia risk,
  measurement instruments, a theory/mechanism showcase) is curated and cited;
  **depth** in the priority domains (loneliness/social connection,
  life-story/reminiscence, digital interventions, ability-adaptive UX, a fuller
  instrument set) is being populated continuously by the one-click PubMed
  harvesters + Curator/Reviewer agents. Expect breadth to increase over time; the
  query surface is stable.

---

*See also: [`13-api.md`](13-api.md) (full REST/MCP reference),
[`02-knowledge-model.md`](02-knowledge-model.md) (ontology),
[`18-research-platform-readiness.md`](18-research-platform-readiness.md) (the audit
this guide is built on).*
