// Healthy Aging Knowledge — minimal, ZERO-DEPENDENCY Anthropic Messages API client.
// Used by the curator (expand the graph) and reviewer (judge candidates) agents.
// Talks to POST /v1/messages with native fetch; no SDK, no runtime dependency.
// The key is read from ANTHROPIC_API_KEY (Secret Manager in production); when it
// is absent the agents stay offline and `isLlmConfigured()` returns false.

/** Default model. The project standard is Claude Opus 4.8 unless overridden;
 *  per-agent model selection lives in src/models.ts + src/settings.ts. */
import { DEFAULT_MODEL, supportsAdaptiveThinking } from "./models.ts";
export { DEFAULT_MODEL };

export function isLlmConfigured(): boolean {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
}

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmOptions {
  system?: string;
  maxTokens?: number;
  model?: string;
  thinking?: boolean; // default: on for models that support it; pass false for fast extraction
}

export interface Usage { input_tokens: number; output_tokens: number }

interface MessagesResponse {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Send a Messages API request and return the concatenated text output.
 * Adaptive thinking is on (the project default for non-trivial work); thinking
 * blocks are skipped, only `text` blocks are returned. `stop_reason` is checked
 * before reading content so a refusal surfaces as an error rather than "".
 */
export async function complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<string> {
  return (await completeWithUsage(messages, opts)).text;
}

/** Like `complete`, but also returns the API's token usage for this call. */
export async function completeWithUsage(messages: LlmMessage[], opts: LlmOptions = {}): Promise<{ text: string; usage: Usage }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = opts.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };
  // Adaptive thinking for models that support it, unless the caller opts out
  // (fast extraction). Omitted for models that reject it (would 400).
  if ((opts.thinking ?? true) && supportsAdaptiveThinking(model)) body.thinking = { type: "adaptive" };
  if (opts.system) body.system = opts.system;

  // Retry transient failures (network "fetch failed", 429, 5xx) with backoff so a
  // single blip doesn't fail a whole topic — important for unattended runs.
  const init = {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  let res: Response | undefined;
  let lastErr = "";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 180000; // 3 min — adaptive thinking can be slow
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", { ...init, signal: ctrl.signal });
    } catch (e) {
      lastErr = (e as Error).message || "fetch failed"; res = undefined; continue; // network error / timeout → retry
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 || res.status >= 500) { lastErr = `Anthropic API error ${res.status}`; continue; }
    break;
  }
  if (!res) throw new Error(`Anthropic request failed after retries: ${lastErr}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 500)}`);
  }
  const json = (await res.json()) as MessagesResponse;
  if (json.stop_reason === "refusal") throw new Error("Anthropic declined the request (stop_reason: refusal)");
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  // Empty text usually means the token budget was spent on thinking before any
  // answer was emitted (stop_reason: max_tokens). Surface stop_reason so callers
  // (and logs) can tell truncation apart from a genuine empty answer.
  if (!text) throw new Error(`empty model response (stop_reason: ${json.stop_reason ?? "unknown"}); raise max_tokens`);
  return { text, usage: { input_tokens: json.usage?.input_tokens ?? 0, output_tokens: json.usage?.output_tokens ?? 0 } };
}

/**
 * Pull the first balanced JSON value (object or array) out of a model's text
 * reply — tolerant of ```json fences and surrounding prose. Pure + deterministic
 * so the agents' parsing is unit-testable without the network.
 */
export function extractJson<T = unknown>(text: string): T {
  let src = text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) src = fence[1];
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error("no JSON value found in model output");
  const open = src[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(src.slice(start, i + 1)) as T;
  }
  throw new Error("unbalanced JSON in model output");
}
