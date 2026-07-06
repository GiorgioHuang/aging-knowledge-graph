// Healthy Aging Knowledge — one agent cycle (Cloud Run Job entrypoint).
// A single invocation: ensure schema → seed topics if empty → run the Curator
// over N topics → run the Reviewer over M unverified claims → print a summary.
// Cloud Scheduler invokes this Job on a schedule, giving "continuous" expansion.
//
//   ANTHROPIC_API_KEY  required (Secret Manager in prod)
//   DATABASE_URL       required (Secret Manager in prod)
//   CURATOR_TOPICS_PER_RUN   default 3
//   REVIEWER_CLAIMS_PER_RUN  default 12
//   ANTHROPIC_MODEL          default claude-opus-4-8

import { isDbConfigured } from "../src/db.ts";
import { isLlmConfigured } from "../src/llm.ts";
import { resolveAgentModel } from "../src/settings.ts";
import { ensureAgentSchema, claimNextTopic, finishTopic, seedTopics, loadSeedTopics, countPendingTopics } from "../src/topics.ts";
import { generateTopics } from "../src/topicgen.ts";
import { processGapQuestions } from "../src/gaptopics.ts";
import { curateTopic } from "../src/curator.ts";
import { reviewBatch } from "../src/reviewer.ts";

const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && v > 0 ? v : d;
};

async function main(): Promise<void> {
  if (!isDbConfigured()) { console.log(JSON.stringify({ skipped: "DATABASE_URL not set" })); return; }
  if (!isLlmConfigured()) { console.log(JSON.stringify({ skipped: "ANTHROPIC_API_KEY not set" })); return; }

  await ensureAgentSchema();

  // Seed the queue from the repo list every run (idempotent on id), so newly
  // added seed topics get enqueued without duplicating or resurrecting done ones.
  const added = await seedTopics(loadSeedTopics().map((t) => ({ ...t, source: "seed" })));
  if (added) console.log(JSON.stringify({ seeded_topics: added }));

  // Per-agent model: DB override > per-agent env > global env > default. Resolved
  // once per cycle so a runtime change (via /agents/config) takes effect next run.
  const curatorModel = await resolveAgentModel("curator");
  const reviewerModel = await resolveAgentModel("reviewer");

  const topicBudget = num("CURATOR_TOPICS_PER_RUN", 3);

  // Close the loop: turn user questions the graph couldn't answer into topics —
  // but only relevance-gated ones (an LLM judge + the structural scope gate), so
  // off-topic/junk questions never pollute the queue. Cheap when there are no gaps.
  try {
    const gaps = await processGapQuestions({ limit: num("GAP_TOPICS_PER_RUN", 20), model: curatorModel });
    if (gaps.scanned) console.log(JSON.stringify({ gap_topics: { scanned: gaps.scanned, queued: gaps.queued, rejected: gaps.rejected, examples: gaps.topics.slice(0, 5) } }));
  } catch (e) { console.log(JSON.stringify({ gap_topics_error: (e as Error).message })); }

  // Keep the queue fed: if pending topics are running low, auto-generate more
  // in-scope healthy-aging topics so expansion continues without hand-curation.
  if ((await countPendingTopics()) < topicBudget) {
    const gen = await generateTopics({ count: num("TOPIC_GEN_COUNT", 8), model: curatorModel });
    if (gen.added) console.log(JSON.stringify({ generated_topics: gen.added, examples: gen.topics.slice(0, 5) }));
  }

  const curator: unknown[] = [];
  for (let i = 0; i < topicBudget; i++) {
    const t = await claimNextTopic();
    if (!t) break;
    try {
      const s = await curateTopic(t.topic, { topicId: t.id, model: curatorModel });
      await finishTopic(t.id, "done");
      curator.push(s);
    } catch (e) {
      // Transient failures (network/rate-limit) are re-queued for a later run
      // (up to a few attempts) instead of being permanently marked failed.
      const msg = (e as Error).message;
      const transient = /fetch failed|terminated|ECONN|ETIMEDOUT|timeout|abort|failed after retries|429|50\d|empty model response/i.test(msg);
      const requeue = transient && t.attempts < 3;
      await finishTopic(t.id, requeue ? "pending" : "failed", msg);
      curator.push({ topic: t.topic, error: msg, requeued: requeue });
    }
  }

  const reviewer = await reviewBatch(num("REVIEWER_CLAIMS_PER_RUN", 12), { model: reviewerModel });

  console.log(JSON.stringify({
    ok: true,
    models: { curator: curatorModel, reviewer: reviewerModel },
    curator,
    reviewer: {
      reviewed: reviewer.length,
      curated: reviewer.filter((r) => r.status === "curated").length,
      needs_refinement: reviewer.filter((r) => r.status === "needs_refinement").length,
      deferred: reviewer.filter((r) => r.deferred).length,
    },
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
