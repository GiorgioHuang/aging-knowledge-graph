// GraceAge Knowledge — entity resolution (node de-duplication).
// The Curator runs continuously, so without de-dup the graph fragments fast:
// "Exercise", "exercise", "Physical activity training" would all become separate
// nodes. This module decides whether a proposed concept already exists, using a
// DETERMINISTIC, offline-testable lexical + alias match (case / punctuation /
// word-order / simple plural variants of the SAME concept and node type).
//
// It deliberately does NOT try to merge true synonyms ("exercise" ≡ "physical
// activity") — that needs a real semantic embedder; when one is configured a
// pgvector nearest-node check can layer on top (see src/curator.ts). Being
// conservative here is intentional: a wrong MERGE silently destroys information,
// while a missed merge is recoverable.

export interface ExistingNode {
  id: string;
  name: string;
  type: string;
  aliases?: string[];
}

export interface ResolveMatch {
  id: string;
  score: number;
  reason: string;
}

const STOP = new Set(["the", "a", "an", "of", "in", "for", "and", "to", "with", "on", "or"]);

/** Lowercase, drop parentheticals + punctuation + stopwords; collapse spaces. */
export function canonical(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .join(" ")
    .trim();
}

/** Light singular stemming so "falls"≡"fall", "activities"≡"activity". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** Order-independent token set of a name (canonicalized + stemmed). */
export function tokenSet(s: string): Set<string> {
  return new Set(canonical(s).split(" ").filter(Boolean).map(stem));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const DEFAULT_THRESHOLD = 0.82;

/** Best existing node a candidate should fold into, or undefined to create new.
 *  Requires the SAME node type. Exact canonical name/alias match scores 1.0;
 *  otherwise the max token-set Jaccard across all name/alias form pairs. */
export function bestMatch(
  cand: { name: string; type: string; aliases?: string[] },
  nodes: ExistingNode[],
  opts: { threshold?: number } = {},
): ResolveMatch | undefined {
  const th = opts.threshold ?? DEFAULT_THRESHOLD;
  const candForms = [cand.name, ...(cand.aliases ?? [])].filter(Boolean);
  if (candForms.length === 0) return undefined;
  const candCanon = new Set(candForms.map(canonical));
  const candTokens = candForms.map(tokenSet);

  let best: ResolveMatch | undefined;
  for (const n of nodes) {
    if (n.type !== cand.type) continue;
    const forms = [n.name, ...(n.aliases ?? [])].filter(Boolean);
    let score = 0;
    let reason = "";
    if (forms.some((f) => candCanon.has(canonical(f)))) {
      score = 1;
      reason = "canonical name/alias match";
    } else {
      for (const f of forms) {
        const ft = tokenSet(f);
        for (const ct of candTokens) {
          const j = jaccard(ct, ft);
          if (j > score) { score = j; reason = `token overlap ${j.toFixed(2)}`; }
        }
      }
    }
    if (score >= th && (!best || score > best.score)) best = { id: n.id, score: Number(score.toFixed(4)), reason };
  }
  return best;
}

/** Stateful resolver: starts from a snapshot of existing nodes and grows as the
 *  curator creates/reuses nodes within a run, so later candidates in the same
 *  pass see earlier decisions. (No constructor parameter properties — those are
 *  unsupported under `node --experimental-strip-types`.) */
export class NodeResolver {
  nodes: ExistingNode[];
  threshold: number;

  constructor(nodes: ExistingNode[] = [], threshold = DEFAULT_THRESHOLD) {
    this.nodes = nodes.map((n) => ({ ...n, aliases: [...(n.aliases ?? [])] }));
    this.threshold = threshold;
  }

  byId(id: string): ExistingNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  resolve(cand: { name: string; type: string; aliases?: string[] }): ResolveMatch | undefined {
    return bestMatch(cand, this.nodes, { threshold: this.threshold });
  }

  add(n: ExistingNode): void {
    this.nodes.push({ ...n, aliases: [...(n.aliases ?? [])] });
  }

  /** Record a new surface form for an existing node (in-memory mirror of the DB
   *  alias write), so subsequent candidates match it too. */
  noteAlias(id: string, alias: string): boolean {
    const n = this.byId(id);
    const a = (alias ?? "").trim();
    if (!n || !a) return false;
    const known = new Set([n.name, ...(n.aliases ?? [])].map(canonical));
    if (known.has(canonical(a))) return false;
    (n.aliases ??= []).push(a);
    return true;
  }
}
