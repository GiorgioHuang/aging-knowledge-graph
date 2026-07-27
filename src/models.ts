// Healthy Aging Knowledge — model selection for the agents.
// Each agent (curator / reviewer) can run on a DIFFERENT Claude model, and the
// choice is switchable at runtime (DB setting) without code changes or redeploys.
// This module holds the pure, dependency-free pieces; src/settings.ts layers the
// DB-backed override on top.

export const DEFAULT_MODEL = "claude-opus-4-8";

export type AgentName = "curator" | "reviewer";
export const AGENTS: AgentName[] = ["curator", "reviewer"];

export interface ModelInfo { id: string; label: string; note?: string }

/** Suggested models for the UI dropdown. Not a hard allow-list — any non-empty
 *  model id is accepted, so newly released models work without a code change. */
export const KNOWN_MODELS: ModelInfo[] = [
  { id: "claude-opus-5", label: "Opus 5", note: "most capable Opus · best for review" },
  { id: "claude-opus-4-8", label: "Opus 4.8", note: "default" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "fast · good for harvest/curation" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", note: "faster / cheaper" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", note: "fastest / cheapest" },
  { id: "claude-fable-5", label: "Fable 5", note: "most capable · pricier" },
];

// Models that accept (and want) adaptive thinking. For anything else we OMIT the
// thinking parameter entirely, which is the safe default — other models reject
// `thinking: {type:"adaptive"}` with a 400. (Confirmed against the live API:
// Haiku 4.5 does NOT support adaptive thinking, so it is excluded here.)
const ADAPTIVE = /^claude-(opus-5|opus-4-[678]|sonnet-5|sonnet-4-6|fable-5|mythos-5)\b/;
export function supportsAdaptiveThinking(model: string): boolean {
  return ADAPTIVE.test((model ?? "").trim());
}

export function normalizeModel(s: string | undefined | null): string | undefined {
  const m = (s ?? "").trim();
  return m || undefined;
}

const ENV_KEY: Record<AgentName, string> = { curator: "CURATOR_MODEL", reviewer: "REVIEWER_MODEL" };
export function envKeyFor(agent: AgentName): string { return ENV_KEY[agent]; }

/** Env-only resolution (no DB): per-agent env > global env > default. */
export function envModelFor(agent: AgentName, env: Record<string, string | undefined> = process.env): string {
  return normalizeModel(env[ENV_KEY[agent]]) ?? normalizeModel(env.ANTHROPIC_MODEL) ?? DEFAULT_MODEL;
}
