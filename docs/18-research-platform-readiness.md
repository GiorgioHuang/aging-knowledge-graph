# 18 · Readiness for the Digital Intervention Research Platform

> Part of **Healthy Aging Knowledge**. A capability audit of the current
> knowledge graph + MCP against the needs of the **Healthy Aging Digital
> Intervention Research Platform** — framed as *what we can provide today* and
> *what we will provide next*. Read-only audit; no schema was changed to produce
> this report.

> **Update — P0 (schema + MCP) implemented.** `theory` / `model` /
> `knowledge_gap` / `research_question` node types and `explains` / `informs` /
> `generates` relationships were added (migration `0011`), plus a
> `knowledge_gaps(topic)` MCP tool and a seeded loneliness showcase. The two
> P0 *schema/MCP* gaps below are now ✅. P0 **content growth** in the priority
> domains is served by one-click PubMed harvesters (priority-topics + guideline
> canon) and a batched review-drain, running on Sonnet 5 (curator) / Opus 5
> (reviewer).
>
> **Update — P1 implemented.** `intervention_component` node type +
> `operates_through` (intervention→mechanism) and `contributes_to`
> (mechanism→outcome) typed edges (migration `0012`), and a `path(from,to)` MCP
> tool for one-call multi-hop traversal. MCP tool descriptions were tuned for
> research-agent workflows. The P1 matrix rows below are now ✅.

## TL;DR — Readiness: **Partially Ready**

The graph is a solid **evidence-and-provenance backbone**. The chain
`Population → Intervention → Mechanism → Outcome → Measurement → Evidence` is
already expressible and queryable end-to-end, with full source tracing (real
PMID/DOI/URL, study design, GRADE certainty, verification status). Semantic +
structured search and relationship traversal are live over both REST and MCP.

Two capabilities the platform's framework assumes are **not yet first-class** and
are the main work items: **Theory** (as an entity) and **Knowledge Gaps /
Research Questions**. Separately, the *content* in the platform's priority domains
(loneliness/social connection, life-story/reminiscence, digital interventions,
ability-adaptive UX, measurement instruments) is **thin** and needs targeted
growth by the Curator agent — a population effort, not a schema problem.

---

## What we can provide **today**

- **Evidence-traceable claims** connecting interventions, mechanisms, outcomes,
  populations, guidelines and measurement instruments — every claim carries its
  supporting evidence.
- **Full provenance per claim** (this is the core strength): source id
  (`PMID:` / `DOI:` / `URL:`), a verbatim supporting **quote**, **study design**
  (systematic review/meta-analysis, RCT, cohort, case-control, cross-sectional,
  case report, guideline, expert opinion), **GRADE certainty**
  (high/moderate/low/very_low), **verification status**
  (curated / unverified / needs_refinement / skeleton), optional comparator,
  dose, direction and effect size.
- **Honest uncertainty**: weak / unverified / conflicting evidence is *marked as
  such*, not presented as strong. A Reviewer agent verifies each citation against
  PubMed/Crossref + an LLM judge before a claim becomes `curated`.
- **Natural-language + structured search** (pgvector semantic search; filters by
  type/domain/status/certainty/relationship).
- **Relationship traversal & neighbourhoods** (given an entity, get everything
  that touches it, with evidence).
- **Conflict detection** (contradicting claims) and **comparative-effectiveness**
  claims.
- **Machine access for agents**: 14 read tools over **MCP** (stdio and
  `POST /mcp`) and a REST API. Standards codes on nodes
  (MONDO/HP/GO/ChEBI/FoodOn/MeSH/RxNorm/ROR/ORCID) for interoperability.
- **Continuous, cited growth**: Curator harvests real papers (PubMed) and
  clinical guidelines into grounded, `unverified` claims; Reviewer promotes them.

## What we have added since (P0 + P1 — ✅ done)

- ✅ **Theory / Model** as first-class entities, with `informs`
  (theory→intervention) and `explains` (theory→mechanism). *(P0)*
- ✅ **Knowledge Gap / Research Question** as first-class entities + the
  `knowledge_gaps(topic)` MCP query ("what is missing/weak for X?"). *(P0)*
- ✅ **Intervention Components** (`part_of`) + explicit `operates_through` /
  `contributes_to` mechanistic edges. *(P1)*
- ✅ A dedicated **multi-hop `path`** MCP tool
  (`Problem → Theory → Mechanism → Intervention → Outcome → Measurement`). *(P1)*

**Still ongoing / next**

- **Targeted content** in the platform's priority domains via the harvesters +
  Curator (a continuous population effort, not a schema change).
- **P2**: a dedicated `risk` type if needed; richer surfacing of
  indirect/conflicting evidence; policy / population-health query presets.

---

## Capability matrix

| Capability | Status | Evidence / Notes | Priority to close |
|---|---|---|---|
| **Intervention retrieval** | ✅ Ready | `intervention` node type; `treats/prevents/improves/reduces_risk_of/recommends`; `search`, `list_nodes`, `neighbourhood` | — |
| **Mechanism modelling** | ✅ Ready *(P1 done)* | `mechanism` node type + `mechanism` field on claims, plus explicit `operates_through` (intervention→mechanism) and `contributes_to` (mechanism→outcome) typed edges | — |
| **Outcome modelling** | ✅ Ready | `outcome` type; `direction`, `effect_value/measure`, `certainty` | — |
| **Measurement retrieval** | ✅ Ready (schema) / 🟡 content | `scale` + `tool` types with `measures`/`assesses`; 8 scales seeded; needs more instruments (UCLA-LS, de Jong Gierveld, WHO-5, etc.) | P0 content |
| **Evidence provenance** | ✅ Ready (strength) | `source_id`, `quote`, `study_design`, `certainty`, `status`, comparator; Reviewer verification | — |
| **Theory retrieval** | ✅ Ready *(P0 done)* | `theory` + `model` node types with `explains`/`informs` links; query via `list_nodes(type=theory)` / `search` | — |
| **Knowledge-gap modelling** | ✅ Ready *(P0 done)* | first-class `knowledge_gap` + `research_question` nodes with `generates`/`related`; `knowledge_gaps(topic)` MCP tool (also surfaces weak/unverified evidence). `gaptopics` still feeds the curator from unanswered Q&A | — |
| **Path queries** | ✅ Ready *(P1 done)* | `path(from,to,max_hops?)` MCP tool — shortest connecting chain (undirected over claim edges), each hop with relationship/certainty/status/sources; hop-by-hop `node_detail`/`neighbourhood` still available | — |
| **MCP access** | ✅ Ready | 14 tools, prefix `graceage_`, over stdio + `POST /mcp` | — |
| **Population scoping** | ✅ Ready | `population` type + `for_population` | — |
| **Risk** | 🟡 Partial | via `increases_risk_of`/`worsens`; no dedicated `risk` node type (usually not needed) | P2 |

---

## A. Current capabilities (works today)

**Entities represented** (node types):
`disease, symptom, outcome, population, intervention, exercise, nutrition, drug,
mechanism, scale, tool, research, paper, guideline, expert, organization,
technology, theory, model, knowledge_gap, research_question,
intervention_component`.

**Relationships**:
`treats, prevents, improves, worsens, causes, increases_risk_of,
reduces_risk_of, diagnoses, assesses, measures, is_a, part_of, recommends,
related, explains, informs, generates, operates_through, contributes_to`.

**Mapping to the platform's requested entities**

| Requested | Today |
|---|---|
| Intervention | ✅ `intervention` |
| Intervention Component | ✅ `intervention_component` (`part_of`) *(P1 done)* |
| Mechanism of Action | ✅ `mechanism` |
| Outcome | ✅ `outcome` |
| Measurement Instrument | ✅ `scale` / `tool` |
| Population | ✅ `population` |
| Guideline | ✅ `guideline` |
| Evidence Source | ✅ `paper` + evidence `source_id` |
| Systematic Review / Meta-analysis / Study | ✅ as `study_design` on evidence (attribute, not a node type) |
| Risk | 🟡 via `increases_risk_of` (no node type) |
| Healthy Aging Concept / Problem | 🟡 via `outcome` / `disease` / `symptom` (no dedicated type) |
| **Theory / Model** | ✅ `theory` / `model` *(P0 done)* |
| **Knowledge Gap / Research Question** | ✅ `knowledge_gap` / `research_question` *(P0 done)* |

**Domains already in scope** (relevant to the platform): `digital health`,
`behavior change`, `mental health`, `caregiving`, `AI in healthcare`, plus
gerontology, frailty, falls, dementia, rehabilitation, nutrition, exercise,
sleep, palliative care.

## B. Missing capabilities — ✅ closed (P0/P1)

1. ✅ **Theory / Model** entities + `explains` / `informs` (P0).
2. ✅ **Knowledge Gap** / **Research Question** as queryable entities + the
   `knowledge_gaps(topic)` tool (P0) — distinct from the data-quality `gaps`
   query and Q&A-derived curator topics.
3. ✅ **Single path-query** tool (`path`) for the full Problem→…→Measurement
   chain (P1).

## C. Partial capabilities

1. ✅ **Mechanism edges** *(P1 done)* — `operates_through` (intervention→mechanism)
   and `contributes_to` (mechanism→outcome) are now explicit typed edges, no
   longer only implied via generic relationships.
2. **Knowledge-gap surfacing** — `gaps` flags low-quality claims; `gaptopics`
   captures questions the graph couldn't answer. Neither yet answers "for this
   proposed intervention/outcome, where is evidence absent, indirect, or
   conflicting?" as a structured result.
3. **Measurement content** — the *schema* is ready; the *inventory* of validated
   instruments is small.

## D. Content gaps (theoretical / evidence domains)

Sparsely or not yet populated for the platform's priority areas:

- **Social connection / loneliness** — partly seeded (a social/loneliness chain);
  needs depth (theories, more instruments, digital interventions).
- **Life-story & reminiscence** — largely absent, and must be modelled as
  *identity/engagement* interventions, **not** cognitive training (an explicit
  distinction the platform requires).
- **Meaningful engagement / purpose / creativity / music / learning** — absent.
- **Digital health / digital behaviour-change / digital social interventions for
  older adults** — largely absent.
- **Ability-adaptive UX** (accessibility, universal/inclusive design, digital
  literacy, cognitive load, sensory/motor accessibility) — absent.
- **Measurement instruments** — a handful of scales; the platform needs a fuller
  validated set (loneliness, social connectedness, well-being, purpose, identity
  continuity).
- **Theories/models** of behaviour change, social connection, engagement, and
  technology acceptance — absent (blocked on the Theory entity, P0).

## E. MCP gaps

Today's 14 tools cover search, listing, node detail, neighbourhood traversal,
population scoping, "what affects", high-certainty, comparative, conflicts, and a
data-quality `gaps` query — all with evidence attached.

Now also available (P0/P1):

- ✅ **Theory-centric queries** — `list_nodes(type=theory)` / `search`.
- ✅ **Structured knowledge-gap queries** — `knowledge_gaps(topic)`.
- ✅ **One-call multi-hop path traversal** — `path(from,to,max_hops?)`.

## F. Recommended changes (prioritised)

**P0 — required for the platform** ✅ *done*
1. ✅ Added `theory` + `model` node types + `explains`, `informs` relationships
   (migration `0011`); claims reuse the existing evidence model.
2. ✅ Added `knowledge_gap` + `research_question` entities (+ `related`,
   `generates`) and the MCP `knowledge_gaps(topic)` query.
3. ✅ Content growth in the priority domains: one-click PubMed harvesters
   (priority-topics + guideline canon) + batched review-drain (Sonnet 5 curator,
   Opus 5 reviewer). Ongoing by design.

**P1 — next phase** ✅ *done*
4. ✅ `intervention_component` (`part_of`) + explicit `operates_through` /
   `contributes_to` edges (migration `0012`).
5. ✅ A dedicated `path(from,to)` MCP tool for the full chain.
6. ✅ Tuned MCP tool descriptions for research-agent workflows.

**P2 — future**
7. Dedicated `risk` type if needed; richer surfacing of indirect/conflicting
   evidence; policy / population-health query presets.

> **Design constraint (from the platform brief §9):** these additions should
> land as **reusable healthy-aging infrastructure**, not overfit to one product.
> Any schema change follows this repo's rule: update `docs/02` + the migration +
> `seed/ontology.json` + the validator + seed together, with tests.

---

## Example MCP queries (working **today**)

MCP tools are prefixed `graceage_` and callable over stdio or `POST /mcp`
(JSON-RPC). Examples:

```jsonc
// Semantic discovery
{"method":"tools/call","params":{"name":"graceage_search",
  "arguments":{"q":"reducing loneliness in older adults","k":8}}}

// Interventions of a type
{"method":"tools/call","params":{"name":"graceage_list_nodes",
  "arguments":{"type":"intervention","domain":"mental health"}}}

// What affects an outcome (direction + GRADE + citations)
{"method":"tools/call","params":{"name":"graceage_what_affects",
  "arguments":{"object":"ga:loneliness","protective":true}}}

// Full node detail: in/out claims WITH evidence + neighbours
{"method":"tools/call","params":{"name":"graceage_node_detail",
  "arguments":{"id":"ga:social-connectedness"}}}

// Measurement instruments (scales/tools) and what they measure
{"method":"tools/call","params":{"name":"graceage_list_nodes",
  "arguments":{"type":"scale"}}}

// Evidence provenance: why is X linked to Y (claims carry source/quote/design)
{"method":"tools/call","params":{"name":"graceage_list_claims",
  "arguments":{"subject":"ga:exercise","object":"ga:fall-rate"}}}

// Everything scoped to a population
{"method":"tools/call","params":{"name":"graceage_for_population",
  "arguments":{"population":"ga:community-dwelling-older-adults"}}}

// Conflicting evidence / data-quality gaps
{"method":"tools/call","params":{"name":"graceage_conflicts","arguments":{}}}
{"method":"tools/call","params":{"name":"graceage_gaps","arguments":{}}}
```

## Example MCP queries (enabled by **P0 / P1**, now available)

```jsonc
// Theory discovery
{"name":"graceage_list_nodes","arguments":{"type":"theory","q":"social connection"}}
// Structured knowledge-gap query
{"name":"graceage_knowledge_gaps","arguments":{"topic":"digital reminiscence for loneliness"}}
// Full path traversal (P1) — shortest chain across claim directions
{"name":"graceage_path","arguments":{"from":"ga:reminiscence-therapy","to":"ga:wellbeing"}}
```

---

## Research-platform integration notes

- **Use MCP as the evidence/theory service.** Point the platform's research agent
  at `POST /mcp` (or stdio). Start each design task with `graceage_search` to find
  entry nodes, then `graceage_node_detail` to pull claims + evidence + neighbours.
- **Always read provenance.** Every claim returns `source_id`, `study_design`,
  `certainty`, and `status`. The platform should **gate design decisions on
  certainty/status** and treat `unverified`/`needs_refinement`/`skeleton` as
  provisional. Do not treat an unsupported assertion as strong evidence — the
  graph already distinguishes them.
- **Feed evaluation results back.** The `Evidence → Intervention → Design →
  Evaluation → New Evidence` loop closes by writing new findings back through the
  token-gated write path (`POST /claims` + evidence), which the Reviewer then
  verifies — keeping the graph as shared, growing infrastructure.
- **Contribute topics.** Gaps the platform hits can be pushed as Curator topics so
  the graph fills the exact areas the platform needs next.
- **Stable identifiers.** Node ids (`ga:*`) and standards CURIEs are stable join
  keys the platform can store alongside its own design artifacts.

---

*Originally prepared as a read-only audit; **P0 and P1 items have since been
implemented** (see the callouts at the top and the ✅ rows in the capability
matrix). Remaining work is P2 plus ongoing content growth.*
