# 17 · Agents — continuous Curator + Reviewer

> Part of **GraceAge Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

Two LLM agents keep the graph growing **and** keep it honest:

- **Curator** ([`src/curator.ts`](../src/curator.ts)) — takes a topic from a work
  queue, asks Claude to propose well-formed, literature-grounded candidate claims.
  The model **describes** each source (title + author + year) but is **forbidden
  from supplying a PMID/DOI** — the pipeline resolves the real identifier by title
  match (see *Citation resolution* below). Resolved claims are written as nodes +
  claims with status **`unverified`**; ones whose source can't be confirmed are
  dropped. It never writes `curated` — nothing it produces is trusted yet.
- **Reviewer** ([`src/reviewer.ts`](../src/reviewer.ts)) — for each `unverified`
  claim it runs **two gates**: (1) a **hard existence check** that resolves every
  cited PMID/DOI against PubMed/Crossref ([`src/cite.ts`](../src/cite.ts)), and
  (2) a **grounded LLM judge** that is handed the source's **real fetched title +
  abstract** ([`src/sources.ts`](../src/sources.ts)) and decides whether it
  actually **supports** the claim — not merely that it exists. Pass both ⇒
  **`curated`**; otherwise ⇒ **`needs_refinement`** (the human review queue). It
  also **enriches** the graph from the fetched metadata (see below).

```
topic queue ─▶ Curator (Claude) ─▶ claims @ unverified ─▶ Reviewer ─▶ curated
   (seed/topics.json)                                         │           (live)
                                          cite check + judge ─┴─▶ needs_refinement
                                                                     (human review)
```

This is the **"fully automatic + exceptions to humans"** policy: clean,
well-cited claims go live automatically; anything with a citation that doesn't
resolve, or that the judge isn't comfortable with, is parked for a person — it is
never silently published.

## Anti-hallucination by construction

The fabricated-citation problem is solved by **not asking the model to check
itself**. The reviewer independently resolves each identifier:

- **PMID** → NCBI E-utilities `esummary` (reuses `fetchPubmed` from the importer).
- **DOI** → Crossref `/works/{doi}/agency` (200 ⇒ the DOI is registered).
- **URL** → accepted (existence ≠ truth; flagged for a human if the judge balks).
- anything else → rejected.

`reviewerStatus(citations, verdict)` promotes to `curated` **only** when there is
at least one citation, **every** citation resolved, **and** the judge approved —
so a made-up PMID can never reach `curated`. This decision logic and the citation
mapping are pure functions with hermetic unit tests ([`test/agents.test.ts`](../test/agents.test.ts)).

## Citation resolution (no model-supplied identifiers)

LLMs hallucinate identifiers: they recall a real paper's title and finding but
attach a PMID/DOI that points to an unrelated paper — and that wrong id still
*resolves*, so an existence-only check passes. We saw exactly this live (a
social-participation→dementia claim cited a cancer-bioinformatics PMID). So the
curator is **not allowed to output identifiers at all**. It gives the paper's
title + first author + year; [`src/citeresolve.ts`](../src/citeresolve.ts) then
searches PubMed (`esearch`) and Crossref by that description and **confirms the
returned title matches** (token-set similarity ≥ 0.6) before accepting a
PMID/DOI. No confident match → the claim is dropped, never written with a guessed
id. This removes the fabricated-identifier failure mode at the source; the
Reviewer's deep check (below) remains the backstop for *support*. The matching
logic is pure and hermetically tested ([`test/citeresolve.test.ts`](../test/citeresolve.test.ts)).

## Deep verification & enrichment

Existence isn't enough — a real paper can be cited for a claim it doesn't make.
So the reviewer **fetches the source's real metadata** ([`src/sources.ts`](../src/sources.ts)):
title, journal, year, authors, publication types, and the **abstract** (PubMed
`efetch`; Crossref `/works`). The judge sees that real abstract and is told to
choose `refine` if it's off-topic, contradicts the claim, or is missing — so the
gate is *support*, not just *existence*.

The same fetched metadata enriches the graph as a side effect:

- **`paper` nodes** — each verified source becomes a first-class node
  (`pmid:<id>` / `doi:<id>`, with `PMID:`/`DOI:` external_ids, title, journal ·
  year · authors), and the evidence row's `source_node` is linked to it. Citations
  become queryable, dedupable entities instead of bare strings.
- **`study_design` backfill** — inferred from authoritative PubMed publication
  types (Meta-Analysis → `systematic_review_or_meta_analysis`, RCT → `rct`, …),
  with a title-hint fallback; only filled when currently empty.
- **`certainty`** — the judge may suggest a GRADE level; applied **only** when
  promoting a claim and only if it has none (conservative — never overwrites).

The mapping/builder logic (`mapStudyDesign`, `paperNode`, `stripTags`) is pure and
hermetically tested ([`test/sources.test.ts`](../test/sources.test.ts)); the
network fetch is injectable (`fetchMeta`) so the reviewer is testable offline.

## Model selection (per agent, switchable)

The agents are **not bound to one fixed model** — each (curator / reviewer) picks
its own, and the choice is switchable at runtime. Resolution precedence
([`src/models.ts`](../src/models.ts) + [`src/settings.ts`](../src/settings.ts)):

1. **DB override** — `model:<agent>` in the `meta` table (set via the UI / API);
2. **per-agent env** — `CURATOR_MODEL` / `REVIEWER_MODEL`;
3. **global env** — `ANTHROPIC_MODEL`;
4. **default** — `claude-opus-4-8`.

Switch without a redeploy from the **`/review`** console ("Agent models" panel) or
the API: `GET /agents/config` (open; shows each agent's effective model + source)
and `POST /agents/config` (token-gated) with a body like
`{"curator":"claude-haiku-4-5","reviewer":"claude-opus-4-8"}` (send `null`/`""` to
clear an override). Agents resolve the model **once per cycle**, so a change takes
effect on the next scheduled run; `agent-run` reports the models it used.

Any model id is accepted (so new releases work without a code change); the UI
offers Opus 4.8/4.7/4.6, Sonnet 4.6, Haiku 4.5, and Fable 5. The HTTP client
([`src/llm.ts`](../src/llm.ts)) sends **adaptive thinking only for models that
support it** (Opus 4.6+/Sonnet 4.6/Fable 5; not Haiku 4.5) and omits the parameter
otherwise, so switching to an older/unknown model won't 400.

## Entity resolution (node de-dup)

Because the Curator runs continuously, naïvely creating a node per surface form
would fragment the graph fast ("Exercise" / "exercise" / "Physical activity
training" as three nodes). Before creating a node, the curator runs a
**deterministic lexical/alias resolver** ([`src/resolve.ts`](../src/resolve.ts)):
it folds a proposed concept into an existing node when they share the **same node
type** and match by canonical name, alias, or token-set overlap (case /
punctuation / word-order / simple plural variants). The new surface form is
recorded as an **alias** so future matches improve, and the reused-node count is
reported per run.

It is deliberately **conservative** — it requires the same type and a high
similarity, because a wrong *merge* silently destroys information while a missed
merge is recoverable. True synonyms ("exercise" ≡ "physical activity") are *not*
merged lexically; that needs a semantic embedder, at which point the pgvector
nearest-node index can layer on as an additional check. The resolver is a pure,
hermetically-tested function ([`test/resolve.test.ts`](../test/resolve.test.ts)).
De-dup also applies at the **edge level**: before writing, the curator looks for an
existing claim with the same **subject + relationship + object + direction**
(population-agnostic, but direction-sensitive so opposing claims — e.g. vitamin D
*reduces* vs *no effect* on falls — stay separate). If found, the new citation is
attached as **additional evidence** on that edge instead of creating a duplicate
(merging into seed claims too, not just agent ones); the run reports `merged`
counts. An exactly-identical re-proposal also collapses via `makeClaimId` (derived
from the resolved node ids).

## Human review console (`/review`)

The "exceptions to humans" half of the policy has a face: **`/review`**
([`public/review.html`](../public/review.html)) lists every claim the reviewer
filed as `needs_refinement`, each shown with its full context — the claim
sentence, evidence with clickable PubMed/DOI links and **resolved / did-not-resolve**
badges, inferred study design, and the **reviewer's verdict + reason** pulled from
the `agent_run` log. A human can **Approve → `curated`** (optionally setting a
GRADE certainty) or **Reject** (delete the claim + evidence); both are logged as
`agent=human`. A dashboard strip shows counts by status, queue depth, node/paper
totals, and pending topics.

Endpoints ([`src/review.ts`](../src/review.ts)): `GET /review/queue`,
`GET /review/stats` (open read, DB required), and `POST /review/:id/approve` /
`POST /review/:id/reject` (token-gated by `CURATOR_TOKEN`, like all writes). The
read-only / token-gating behaviour is hermetically tested
([`test/review.test.ts`](../test/review.test.ts)).

## The work queue (`topic`)

`db/migrations/0003_agents.sql` adds two tables:

- **`topic`** — the queue (`pending → in_progress → done/failed`, with `priority`).
  The curator claims the top pending topic atomically (`FOR UPDATE SKIP LOCKED`),
  so concurrent jobs don't collide. Seeded from
  [`seed/topics.json`](../seed/topics.json) on first run; edit that list (or
  insert rows) to steer what the graph grows toward.
- **`agent_run`** — an append-only audit log of every curator/reviewer action
  (outcome + summary as JSON), for observability.

`ensureAgentSchema()` runs the migration with `IF NOT EXISTS` on every cycle, so
databases provisioned before this migration pick the tables up automatically.

## Running

One cycle (Curator over N topics, then Reviewer over M claims):

```bash
DATABASE_URL='postgres://…' ANTHROPIC_API_KEY='sk-ant-…' npm run agents:run
```

Knobs (env): `CURATOR_TOPICS_PER_RUN` (default 3), `REVIEWER_CLAIMS_PER_RUN`
(default 12), and the model per agent — `CURATOR_MODEL` / `REVIEWER_MODEL` (or
`ANTHROPIC_MODEL` for both; default **`claude-opus-4-8`**), overridable at runtime
via `/agents/config` (see *Model selection* above). With either secret missing the
run **skips cleanly** (prints a `skipped` note, exit 0).

### Continuous (Cloud Run Job + Cloud Scheduler)

`scripts/agent-run.ts` is the Job entrypoint, run as a **Cloud Run Job** on a
**Cloud Scheduler** tick — that scheduled tick is the "continuous" loop. It uses
the **same source/image** as the API and reads `DATABASE_URL` +
`ANTHROPIC_API_KEY` from Secret Manager.

**One-time setup** (creates the API-key secret + the Scheduler trigger):

```bash
printf '%s' 'sk-ant-…' | gcloud secrets create ANTHROPIC_API_KEY --data-file=- --replication-policy=automatic
REGION=us-east1 SCHEDULE='*/30 * * * *' bash scripts/deploy-agents.sh   # job + scheduler
gcloud run jobs execute graceage-agents --region us-east1               # run one cycle now
```

**Afterwards it's automatic:** the GitHub Actions deploy workflow
(`.github/workflows/deploy.yml`) redeploys the **Job** alongside the API on every
push to `main`, so the agents' code stays in sync — no manual redeploy. (That CI
step **skips cleanly** until the `ANTHROPIC_API_KEY` secret exists, and it does
not touch the Scheduler trigger, which is created once above.) Tunables
`CURATOR_TOPICS_PER_RUN` / `REVIEWER_CLAIMS_PER_RUN` can be set as repo
**Variables** to override the defaults in CI.

## Zero new dependencies

The Anthropic client ([`src/llm.ts`](../src/llm.ts)) calls `POST /v1/messages`
with native `fetch` — no SDK, no runtime dependency added. The model is chosen
per agent (see *Model selection* above); thinking is sent only for models that
support it. `extractJson` pulls the first balanced JSON value out of the reply
(tolerant of ```json fences and prose).

## 中文摘要

两个 LLM 智能体协作：**Curator（扩充）** 从主题队列取题，让 Claude 只**描述**文献
（标题/作者/年份，禁止给 PMID/DOI——LLM 会编造 ID），再由管道按标题去 PubMed/Crossref
检索并**比对确认**出真实 ID（对不上就丢弃);写库前还做**实体消歧/去重**（避免图谱碎片化），以 `unverified`
落库；**Reviewer（审核）** 对每条声明做两道关卡——**硬性存在核验**（真的去
PubMed/Crossref 解析每个 PMID/DOI，杜绝编造）和**有据评审**（把文献真实的标题+摘要
喂给 Claude，判断是否**真正支持**该声明，而非仅"存在"）。两关都过 ⇒ `curated`
自动上线；否则 ⇒ `needs_refinement` 进**人审控制台 `/review`**（逐条看引用核验结果、
出版类型、Reviewer 判断理由,一键通过→`curated` 或打回删除——"全自动 + 例外人审"）。审核还会顺带
**充实图谱**：为每个被核实的来源建 `paper` 节点并关联 evidence、按出版类型回填
`study_design`、保守地补 GRADE `certainty`。以 **Cloud Run Job + Cloud Scheduler**
定时运行即"不停扩充"。零新增依赖（原生 fetch 调用 Messages API，默认 `claude-opus-4-8`）。

## Files

- [`src/llm.ts`](../src/llm.ts) — zero-dep Anthropic Messages client + `extractJson`.
- [`src/models.ts`](../src/models.ts) + [`src/settings.ts`](../src/settings.ts) — per-agent model selection (env + runtime DB override).
- [`src/cite.ts`](../src/cite.ts) — PMID/DOI/URL existence resolution.
- [`src/citeresolve.ts`](../src/citeresolve.ts) — resolve a described paper to a real PMID/DOI by title match.
- [`src/sources.ts`](../src/sources.ts) — source metadata + search (PubMed/Crossref), study-design mapping, paper-node builder.
- [`src/resolve.ts`](../src/resolve.ts) — node entity resolution / de-dup.
- [`src/topics.ts`](../src/topics.ts) — topic queue + run log helpers.
- [`src/curator.ts`](../src/curator.ts) — propose → validate → write `unverified`.
- [`src/reviewer.ts`](../src/reviewer.ts) — verify citations + judge → `curated`/`needs_refinement`.
- [`src/review.ts`](../src/review.ts) + [`public/review.html`](../public/review.html) — human review console (queue / stats / approve / reject).
- [`scripts/agent-run.ts`](../scripts/agent-run.ts) — one cycle (Job entrypoint).
- [`scripts/deploy-agents.sh`](../scripts/deploy-agents.sh) — Cloud Run Job + Scheduler.
- [`db/migrations/0003_agents.sql`](../db/migrations/0003_agents.sql), [`seed/topics.json`](../seed/topics.json).
- [`test/agents.test.ts`](../test/agents.test.ts) — hermetic tests for the pure logic.
