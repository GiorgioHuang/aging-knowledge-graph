// Healthy Aging Knowledge — Reviewer agent.
// VERIFIES what the curator produced. Promotion from `unverified` to `curated`
// requires BOTH:
//   1) Hard existence check — every cited PMID/DOI must actually resolve
//      (PubMed/Crossref). A fabricated citation can never pass; this is NOT
//      delegated to the model.
//   2) Grounded LLM judge — Claude is given the source's REAL fetched title +
//      abstract and decides whether it actually SUPPORTS the claim (not just that
//      it exists), and whether the claim is well-formed and in scope.
// Pass both ⇒ `curated`. Otherwise ⇒ `needs_refinement` (the human review queue).
//
// As a side effect the reviewer ENRICHES the graph from the fetched metadata:
// it creates a `paper` node per verified source, links the evidence row to it,
// backfills the evidence study_design from authoritative publication types, and
// (conservatively, only when promoting) fills a missing GRADE certainty from the
// judge's suggestion.

import { getSql } from "./db.ts";
import { complete, extractJson } from "./llm.ts";
import { envModelFor } from "./models.ts";
import { citationKind, allResolved, type CitationCheck } from "./cite.ts";
import { fetchSourceMeta, paperNode, type SourceMeta, type MetaFetcher } from "./sources.ts";
import { resolveCitation } from "./citeresolve.ts";
import { loadGraph } from "./model.ts";
import { logRun } from "./topics.ts";

const CERTAINTIES = new Set(loadGraph().ontology.certainties);

export type Verdict = "approve" | "refine";

/** Final status from the two gates. curated requires resolvable citations AND
 *  the judge's approval; anything else routes to human review. */
export function reviewerStatus(citations: CitationCheck[], verdict: Verdict): "curated" | "needs_refinement" {
  return allResolved(citations) && verdict === "approve" ? "curated" : "needs_refinement";
}

interface ClaimRow {
  id: string; type: string; subject_id: string; object_id: string;
  subj: string; obj: string; direction: string | null; certainty: string | null;
  population: string | null;
}
interface EvidenceRow { id: string; source_id: string; quote: string | null; study_design: string | null }

const SYSTEM = `You are the Reviewer for Healthy Aging Knowledge, an evidence-traceable knowledge graph about healthy aging.
You judge whether a candidate claim is sound, in-scope, AND actually supported by its cited source(s). For each citation you are told whether it was independently verified to EXIST (resolved against PubMed/Crossref) and given the source's real title and abstract — do not re-judge existence, judge support and quality.

Approve only if ALL hold:
- the claim is a meaningful, well-formed relationship between the two concepts, in healthy-aging scope;
- the cited source's title/abstract actually supports the stated relationship and direction (not merely on the same topic);
- the relationship type and direction are coherent with the evidence.
If the abstract contradicts the claim, is off-topic, or is missing where it should exist, choose "refine".

Output ONLY JSON: {"verdict": "approve" | "refine", "reason": "<one or two sentences citing what in the abstract supports/undermines it>", "certainty": "high|moderate|low|very_low (optional GRADE suggestion)"}`;

export function buildJudgePrompt(claim: {
  subject: string; relationship: string; object: string; direction?: string | null; population?: string | null;
}, citations: { source_id: string; resolved: boolean; title?: string; year?: string; journal?: string; quote?: string; abstract?: string }[]): string {
  const cites = citations.map((c) => {
    const head = `- ${c.source_id} [${c.resolved ? "VERIFIED-EXISTS" : "DID NOT RESOLVE"}]`;
    const meta = [c.title ? `title: ${c.title}` : "", [c.journal, c.year].filter(Boolean).join(" "), c.quote ? `curator quote: ${c.quote}` : ""].filter(Boolean).join(" | ");
    const abs = c.abstract ? `\n  abstract: ${c.abstract.slice(0, 1500)}` : "\n  abstract: (none available)";
    return `${head}\n  ${meta}${abs}`;
  }).join("\n");
  return `Candidate claim:
  subject: ${claim.subject}
  relationship: ${claim.relationship}
  object: ${claim.object}
  direction: ${claim.direction ?? "(none)"}
  population: ${claim.population ?? "(none)"}

Citations (with verified metadata):
${cites || "(none)"}

Judge whether the source(s) support this claim. Output only the JSON verdict.`;
}

async function loadClaim(id: string): Promise<{ claim: ClaimRow; evidence: EvidenceRow[] } | undefined> {
  const sql = await getSql();
  const rows = (await sql.query(
    `SELECT c.id, c.type, c.subject_id, c.object_id, c.direction, c.certainty,
            s.name AS subj, o.name AS obj, p.name AS population
     FROM claim c
     JOIN node s ON s.id = c.subject_id
     JOIN node o ON o.id = c.object_id
     LEFT JOIN node p ON p.id = c.population_id
     WHERE c.id = $1`,
    [id],
  )) as ClaimRow[];
  if (!rows[0]) return undefined;
  const evidence = (await sql.query("SELECT id, source_id, quote, study_design FROM evidence WHERE claim_id=$1", [id])) as EvidenceRow[];
  return { claim: rows[0], evidence };
}

/** Create/refresh a paper node for each verified source, link the evidence row
 *  to it, and backfill study_design (only when currently empty). Best-effort. */
async function enrich(evidence: EvidenceRow[], metas: Map<string, SourceMeta>): Promise<{ papers: number; designs: number }> {
  const sql = await getSql();
  let papers = 0, designs = 0;
  for (const e of evidence) {
    const meta = metas.get(e.source_id);
    if (!meta || !meta.exists) continue;
    const pn = paperNode(meta);
    try {
      if (pn) {
        await sql.query(
          `INSERT INTO node (id,type,name,description,external_ids) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, external_ids=EXCLUDED.external_ids, updated_at=now()`,
          [pn.id, pn.type, pn.name, pn.description ?? null, pn.external_ids],
        );
        papers++;
        await sql.query(
          "UPDATE evidence SET source_node_id=$2, study_design=COALESCE(study_design,$3) WHERE id=$1",
          [e.id, pn.id, meta.study_design ?? null],
        );
      } else if (meta.study_design) {
        await sql.query("UPDATE evidence SET study_design=COALESCE(study_design,$2) WHERE id=$1", [e.id, meta.study_design]);
      }
      if (!e.study_design && meta.study_design) designs++;
    } catch { /* enrichment is best-effort */ }
  }
  return { papers, designs };
}

export interface ReviewResult {
  claimId: string;
  status: "curated" | "needs_refinement" | "unverified";
  citations: CitationCheck[];
  verdict: Verdict;
  reason: string;
  enriched: { papers: number; designs: number };
  deferred?: boolean; // citation lookup failed transiently → left unverified to retry
}

/** Review a single claim by id. `fetchMeta` is injectable for testing.
 *  `timeoutMs` bounds the judge LLM call — pass it on the HTTP path (behind a
 *  gateway timeout); omit it in the background Job to keep the generous default. */
export async function reviewClaim(id: string, opts: { model?: string; fetchMeta?: MetaFetcher; timeoutMs?: number } = {}): Promise<ReviewResult | undefined> {
  const model = opts.model ?? envModelFor("reviewer");
  const fetchMeta = opts.fetchMeta ?? fetchSourceMeta;
  const loaded = await loadClaim(id);
  if (!loaded) return undefined;
  const { claim, evidence } = loaded;

  // Fetch real metadata for each source; existence drives the hard gate.
  const metas = new Map<string, SourceMeta>();
  for (const e of evidence) metas.set(e.source_id, await fetchMeta(e.source_id));
  const citations: CitationCheck[] = evidence.map((e) => ({
    source_id: e.source_id, kind: citationKind(e.source_id), resolved: metas.get(e.source_id)?.exists ?? false,
  }));

  // If a citation lookup ERRORED (network/throttle), existence is unknown — don't
  // condemn a possibly-real citation. Leave the claim `unverified` and retry next
  // run rather than flagging needs_refinement.
  if (evidence.some((e) => metas.get(e.source_id)?.lookupFailed)) {
    await logRun({ agent: "reviewer", claim_id: id, outcome: "deferred", summary: { reason: "citation lookup failed (transient); will retry", citations } });
    return { claimId: id, status: "unverified", citations, verdict: "refine", reason: "citation lookup temporarily failed — deferred for retry", enriched: { papers: 0, designs: 0 }, deferred: true };
  }

  const prompt = buildJudgePrompt(
    { subject: claim.subj, relationship: claim.type, object: claim.obj, direction: claim.direction, population: claim.population },
    evidence.map((e) => {
      const m = metas.get(e.source_id);
      return { source_id: e.source_id, resolved: m?.exists ?? false, title: m?.title, year: m?.year, journal: m?.journal, quote: e.quote ?? undefined, abstract: m?.abstract };
    }),
  );

  let verdict: Verdict = "refine";
  let reason = "";
  let certaintySuggestion: string | undefined;
  try {
    const out = extractJson<{ verdict?: string; reason?: string; certainty?: string }>(await complete([{ role: "user", content: prompt }], { system: SYSTEM, maxTokens: 4000, model, timeoutMs: opts.timeoutMs, retries: opts.timeoutMs ? 2 : undefined }));
    verdict = out.verdict === "approve" ? "approve" : "refine";
    reason = String(out.reason ?? "");
    if (out.certainty && CERTAINTIES.has(out.certainty)) certaintySuggestion = out.certainty;
  } catch (e) {
    // The judge call failed (network/429/timeout/bad JSON). Don't condemn the
    // claim on an infra error — defer and retry next run, like a lookup failure.
    await logRun({ agent: "reviewer", claim_id: id, outcome: "deferred", summary: { reason: `judge call failed: ${(e as Error).message}`, citations } });
    return { claimId: id, status: "unverified", citations, verdict: "refine", reason: `judge call failed — deferred for retry`, enriched: { papers: 0, designs: 0 }, deferred: true };
  }

  const status = reviewerStatus(citations, verdict);
  const enriched = await enrich(evidence, metas);

  const sql = await getSql();
  await sql.query("UPDATE claim SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
  // Only assert a certainty on claims we are promoting, and only if one is missing.
  if (status === "curated" && certaintySuggestion && !claim.certainty)
    await sql.query("UPDATE claim SET certainty=$2 WHERE id=$1 AND certainty IS NULL", [id, certaintySuggestion]);

  await logRun({ agent: "reviewer", claim_id: id, outcome: status, summary: { verdict, reason, citations, enriched, certainty: certaintySuggestion } });
  return { claimId: id, status, citations, verdict, reason, enriched };
}

/** Review a batch of pending `unverified` claims (oldest first). Only claims that
 *  HAVE evidence are reviewable — evidence-less ones (e.g. seed placeholders for
 *  known gaps) are left as honest `unverified` rather than flagged. They heal
 *  automatically once a citation is attached (edge-level de-dup in the curator). */
export async function reviewBatch(limit = 10, opts: { model?: string; fetchMeta?: MetaFetcher; timeoutMs?: number } = {}): Promise<ReviewResult[]> {
  const sql = await getSql();
  const ids = (await sql.query(
    `SELECT id FROM claim c
     WHERE c.status='unverified' AND EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id = c.id)
     ORDER BY c.created_at ASC LIMIT $1`,
    [limit],
  )) as { id: string }[];

  // Review with bounded concurrency — each claim does its own LLM + fetch calls,
  // so a few in parallel cut wall-clock a lot (retries handle the extra 429 risk).
  const out: ReviewResult[] = [];
  const conc = Math.max(1, Number(process.env.REVIEWER_CONCURRENCY) || 2); // polite to NCBI + Anthropic rate limits
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const { id } = ids[next++];
      const r = await reviewClaim(id, opts);
      if (r) out.push(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, ids.length) }, worker));
  return out;
}

const REPAIR_SYSTEM = `You identify the exact peer-reviewed source for a stated finding in healthy-aging research.
Given a claim and the finding/quote attached to it, name the SINGLE real paper the finding most likely comes from.
Output ONLY JSON: {"title": "<exact full title>", "first_author": "<surname>", "year": "<YYYY>", "journal": "<journal>"}.
If you cannot confidently identify a real, specific paper, output {}. Never invent a paper or guess.`;

export interface RepairDetail { quote?: string; proposedTitle?: string; resolved?: string; note?: string }
export interface RepairResult {
  claimId: string;
  repaired: boolean;
  source?: string;
  status?: "curated" | "needs_refinement";
  reason?: string;
  details?: RepairDetail[];
}

/**
 * One-click repair for a flagged claim whose citation was wrong: re-identify the
 * correct paper for each evidence finding (LLM → title), resolve it to a REAL id
 * by title match (citeresolve), replace the evidence source, then re-review.
 * If no verifiable source can be found, nothing is changed. `details` explains
 * per-evidence what happened (for diagnosis).
 */
export async function repairClaim(id: string, opts: { model?: string } = {}): Promise<RepairResult | undefined> {
  const model = opts.model ?? envModelFor("reviewer");
  const loaded = await loadClaim(id);
  if (!loaded) return undefined;
  const { claim, evidence } = loaded;
  const sql = await getSql();

  let repaired = false;       // a citation was actually replaced
  let alreadyCorrect = false; // a citation resolved to the same (correct) id
  let lastSource: string | undefined;
  const details: RepairDetail[] = [];
  for (const e of evidence) {
    const d: RepairDetail = { quote: (e.quote ?? "").slice(0, 80) };
    const prompt = `Claim: ${claim.subj} [${claim.type}] ${claim.obj}${claim.population ? ` in ${claim.population}` : ""}\n`
      + `Reported finding: ${e.quote ?? "(none provided)"}\n\nIdentify the source paper.`;
    let desc: { title?: string; first_author?: string; year?: string; journal?: string };
    try {
      desc = extractJson(await complete([{ role: "user", content: prompt }], { system: REPAIR_SYSTEM, maxTokens: 6000, model }));
    } catch (err) { d.note = `llm error: ${(err as Error).message}`; details.push(d); continue; }
    if (!desc?.title) { d.note = "model could not name a specific paper"; details.push(d); continue; }
    d.proposedTitle = desc.title.slice(0, 80);
    const cite = await resolveCitation({ title: desc.title, first_author: desc.first_author, year: desc.year, journal: desc.journal });
    if (!cite) { d.note = "proposed title had no confident match in PubMed/Crossref"; details.push(d); continue; }
    if (cite.source_id === e.source_id) { d.note = `already correct (${cite.source_id})`; alreadyCorrect = true; details.push(d); continue; }
    await sql.query("UPDATE evidence SET source_id=$2, source_node_id=NULL WHERE id=$1", [e.id, cite.source_id]);
    d.resolved = cite.source_id;
    repaired = true;
    lastSource = cite.source_id;
    details.push(d);
  }

  // Nothing changed AND nothing was confirmed correct ⇒ genuinely unverifiable.
  if (!repaired && !alreadyCorrect) {
    await logRun({ agent: "repair", claim_id: id, outcome: "unresolved", summary: { details } });
    return { claimId: id, repaired: false, reason: "could not identify a verifiable source for this claim", details };
  }

  // Re-review either way: with a corrected citation, or to refresh the verdict on
  // a claim whose citation is already correct (it was flagged on substance, not
  // for a wrong id — a re-review may pass it or restate the concern).
  const r = await reviewClaim(id, { model: opts.model });
  await logRun({ agent: "repair", claim_id: id, outcome: r?.status ?? "?", summary: { repaired, alreadyCorrect, source: lastSource, status: r?.status, details } });
  const reason = repaired
    ? undefined
    : "citation is already correct — this claim is flagged on substance, not a wrong source (see the reviewer's reason)";
  return { claimId: id, repaired, source: lastSource, status: r?.status, reason, details };
}
