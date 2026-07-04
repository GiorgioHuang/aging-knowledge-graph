// GraceAge Knowledge — evidence quality scoring (GRADE-informed, heuristic).
// A transparent 0–100 strength signal for a claim, derived from what we store:
//   • study design   — the strongest design among the claim's evidence (main driver)
//   • replication     — number of independent sources (consistency proxy)
//   • sample size     — best-effort parse from evidence quotes (small nudge)
//   • consistency     — downgraded when the claim conflicts with other evidence
// This is a heuristic aid, NOT a formal GRADE assessment (which needs domain
// judgement); it complements the curator/agent-assigned `certainty`.

import type { Graph, Claim } from "./types.ts";

export type QualityTier = "high" | "moderate" | "low" | "very_low";

export interface QualityEvidence { source_id?: string | null; study_design?: string | null; quote?: string | null }
export interface QualityInput { evidence: QualityEvidence[]; conflicted?: boolean }
export interface Quality {
  score: number;          // 0..100
  tier: QualityTier;
  bestDesign?: string;    // strongest study design present
  sources: number;        // distinct evidence sources
  sampleSize?: number;    // best-effort max reported n
  conflicted: boolean;
  reasons: string[];      // human-readable factor breakdown
}

// Base score by strongest study design (the GRADE starting point: SRs/RCTs high,
// observational lower, expert opinion lowest).
const DESIGN_BASE: Record<string, number> = {
  systematic_review_or_meta_analysis: 80,
  rct: 70,
  guideline: 60,
  cohort: 50,
  case_control: 40,
  cross_sectional: 35,
  case_report: 20,
  expert_opinion: 20,
};
export const DESIGN_LABEL: Record<string, string> = {
  systematic_review_or_meta_analysis: "systematic review / meta-analysis",
  rct: "randomized controlled trial",
  guideline: "clinical guideline",
  cohort: "cohort study",
  case_control: "case-control study",
  cross_sectional: "cross-sectional study",
  case_report: "case report/series",
  expert_opinion: "expert opinion",
};
const NO_DESIGN_BASE = 15;

export function designBase(d?: string | null): number {
  if (!d) return NO_DESIGN_BASE;
  return DESIGN_BASE[d] ?? NO_DESIGN_BASE;
}

/** Best-effort sample size from evidence quotes: "n = 1,234" / "N=500" /
 *  "12,345 participants". Heuristic — returns the largest match, or undefined. */
export function parseSampleSize(texts: (string | null | undefined)[]): number | undefined {
  const re = /\b[nN]\s*=\s*([\d][\d,]{1,})|\b([\d][\d,]{2,})\s+(?:participants|patients|subjects|adults|individuals|men|women|people)\b/g;
  let max: number | undefined;
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(re)) {
      const n = Number((m[1] ?? m[2] ?? "").replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0 && (max === undefined || n > max)) max = n;
    }
  }
  return max;
}

export function tierOf(score: number): QualityTier {
  return score >= 75 ? "high" : score >= 55 ? "moderate" : score >= 35 ? "low" : "very_low";
}

/** Score a claim's evidence into a 0–100 strength with a transparent breakdown. */
export function scoreClaim(input: QualityInput): Quality {
  const ev = input.evidence ?? [];
  const designs = ev.map((e) => e.study_design ?? undefined).filter((d): d is string => Boolean(d));

  let bestDesign: string | undefined;
  let base = NO_DESIGN_BASE;
  for (const d of designs) {
    const b = designBase(d);
    if (b >= base) { base = b; bestDesign = d; }
  }
  const reasons: string[] = [];
  let score = base;
  reasons.push(bestDesign ? `strongest design: ${DESIGN_LABEL[bestDesign] ?? bestDesign} (${base})` : `no study design recorded (${base})`);

  const sources = new Set(ev.map((e) => e.source_id).filter(Boolean)).size;
  const rep = sources >= 3 ? 14 : sources === 2 ? 8 : 0;
  if (rep) { score += rep; reasons.push(`${sources} independent sources (+${rep})`); }
  else reasons.push(`${sources} source${sources === 1 ? "" : "s"}`);

  const sampleSize = parseSampleSize(ev.map((e) => e.quote));
  if (sampleSize !== undefined) {
    const b = sampleSize >= 1000 ? 6 : sampleSize >= 100 ? 3 : 0;
    if (b) score += b;
    reasons.push(`reported sample ~${sampleSize}${b ? ` (+${b})` : ""}`);
  }

  const conflicted = Boolean(input.conflicted);
  if (conflicted) { score -= 20; reasons.push("conflicts with other evidence (−20)"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: tierOf(score), bestDesign, sources, sampleSize, conflicted, reasons };
}

/** Score a claim within a graph (gathers its evidence + conflict status). */
export function graphClaimQuality(g: Graph, c: Claim): Quality {
  const conflicted = g.contradictions.some((r) => r.subject_claim === c.id || r.object_claim === c.id);
  const evidence: QualityEvidence[] = (c.evidence ?? [])
    .map((eid) => g.evidence.get(eid))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .map((e) => ({ source_id: e.source_id, study_design: e.study_design, quote: e.quote }));
  return scoreClaim({ evidence, conflicted });
}
