// Healthy Aging Knowledge — idempotent provisioning of the Neon database.
// Used by the HTTP server on startup (so a Cloud Run deploy brings data online
// automatically) and by the db:setup / db:ensure scripts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDbConfigured, getSql, type Sql } from "./db.ts";
import { loadGraph } from "./model.ts";
import { buildIndex, getEmbedder } from "./embeddings.ts";

const here = dirname(fileURLToPath(import.meta.url));
const mig = (f: string) => join(here, "..", "db", "migrations", f);

/** Seed version (from seed/graph.json) — bump it there to re-sync the live DB. */
function seedVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(join(here, "..", "seed", "graph.json"), "utf8")) as { version?: number };
    return String(raw.version ?? 1);
  } catch { return "1"; }
}

/** Split a .sql file into statements (strip comments + BEGIN/COMMIT). */
function statements(file: string): string[] {
  const cleaned = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !/^\s*--/.test(l) && !/^\s*(BEGIN|COMMIT)\s*;/i.test(l))
    .join("\n");
  return cleaned.split(";").map((s) => s.trim()).filter(Boolean);
}

async function migrate(sql: Sql): Promise<void> {
  for (const s of statements(mig("0001_init.sql"))) await sql.query(s);
  for (const s of statements(mig("0002_embeddings.sql"))) await sql.query(s);
  for (const s of statements(mig("0003_agents.sql"))) await sql.query(s);
  for (const s of statements(mig("0004_contact.sql"))) await sql.query(s);
  for (const s of statements(mig("0005_ask_log.sql"))) await sql.query(s);
  for (const s of statements(mig("0006_ask_log_gap.sql"))) await sql.query(s);
  for (const s of statements(mig("0007_ask_log_tokens.sql"))) await sql.query(s);
  for (const s of statements(mig("0008_topic_source.sql"))) await sql.query(s);
}

/** Upsert the canonical seed (idempotent). Existing rows are refreshed; rows
 *  added by curators (not in the seed) are left untouched. */
async function loadSeed(sql: Sql): Promise<void> {
  const g = loadGraph();
  for (const n of g.nodes.values())
    await sql.query(
      `INSERT INTO node (id,type,name,description,aliases,domains,external_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, name=EXCLUDED.name, description=EXCLUDED.description,
         aliases=EXCLUDED.aliases, domains=EXCLUDED.domains, external_ids=EXCLUDED.external_ids, updated_at=now()`,
      [n.id, n.type, n.name, n.description ?? null, n.aliases ?? [], n.domains ?? [], n.external_ids ?? []],
    );
  for (const c of g.claims.values())
    await sql.query(
      `INSERT INTO claim (id,type,subject_id,object_id,population_id,mechanism_id,setting,direction,
        effect_value,effect_measure,effect_note,comparator,dose,certainty,rec_strength,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET type=EXCLUDED.type, subject_id=EXCLUDED.subject_id, object_id=EXCLUDED.object_id,
         population_id=EXCLUDED.population_id, mechanism_id=EXCLUDED.mechanism_id, setting=EXCLUDED.setting,
         direction=EXCLUDED.direction, effect_value=EXCLUDED.effect_value, effect_measure=EXCLUDED.effect_measure,
         effect_note=EXCLUDED.effect_note, comparator=EXCLUDED.comparator, dose=EXCLUDED.dose,
         certainty=EXCLUDED.certainty, rec_strength=EXCLUDED.rec_strength, status=EXCLUDED.status, updated_at=now()`,
      [c.id, c.type, c.subject, c.object, c.population ?? null, c.mechanism ?? null, c.setting ?? null,
       c.direction ?? null, c.effect_value ?? null, c.effect_measure ?? null, c.effect_note ?? null,
       c.comparator ?? null, c.dose ?? null, c.certainty ?? null, c.rec_strength ?? null, c.status],
    );
  for (const e of g.evidence.values())
    await sql.query(
      `INSERT INTO evidence (id,claim_id,source_id,source_node_id,quote,study_design,confidence,extracted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET claim_id=EXCLUDED.claim_id, source_id=EXCLUDED.source_id, source_node_id=EXCLUDED.source_node_id,
         quote=EXCLUDED.quote, study_design=EXCLUDED.study_design, confidence=EXCLUDED.confidence, extracted_by=EXCLUDED.extracted_by`,
      [e.id, e.claim, e.source_id, e.source_node ?? null, e.quote ?? null, e.study_design ?? null, e.confidence ?? null, e.extracted_by ?? null],
    );
  for (const ct of g.contradictions)
    await sql.query(
      "INSERT INTO claim_relation (id,type,subject_claim_id,object_claim_id) VALUES ($1,'contradicts',$2,$3) ON CONFLICT (id) DO NOTHING",
      [ct.id, ct.subject_claim, ct.object_claim],
    );

  const index = await buildIndex(g, getEmbedder());
  for (const en of index.entries)
    await sql.query(
      `INSERT INTO embedding (id,owner_type,owner_id,model,vector) VALUES ($1,$2,$3,$4,$5::vector)
       ON CONFLICT (id) DO UPDATE SET vector=EXCLUDED.vector, model=EXCLUDED.model`,
      [`emb-${en.ownerType}-${en.id}`, en.ownerType, en.id, index.embedder.id, `[${en.vector.join(",")}]`],
    );
}

export interface ProvisionResult {
  ok: boolean;
  provisioned: boolean;
  reason?: string;
  counts?: { nodes: number; claims: number; evidence: number; embeddings: number };
}

/**
 * Ensure the database has the schema and the canonical seed.
 * - force=false (default): create the schema if missing, then upsert the seed
 *   only when its version changed (tracked in a `meta` row). Idempotent;
 *   preserves curator-added records.
 * - force=true: drop everything and rebuild from the seed (destructive reset).
 * No-op (never throws) when DATABASE_URL is unset.
 */
export async function ensureProvisioned({ force = false }: { force?: boolean } = {}): Promise<ProvisionResult> {
  if (!isDbConfigured()) return { ok: false, provisioned: false, reason: "no DATABASE_URL" };
  const sql = await getSql();
  const version = seedVersion();

  const [{ exists }] = (await sql.query("SELECT to_regclass('public.node') IS NOT NULL AS exists")) as { exists: boolean }[];

  if (force) {
    await sql.query("DROP TABLE IF EXISTS ask_log, contact_message, agent_run, topic, embedding, claim_relation, evidence, claim, node, meta CASCADE");
    await sql.query("DROP TYPE IF EXISTS node_type, relationship_type, claim_direction, grade_certainty, claim_status, care_setting, study_design CASCADE");
    await migrate(sql);
  } else if (!exists) {
    await migrate(sql);
  }
  await sql.query("CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text)");

  if (!force) {
    const cur = (await sql.query("SELECT value FROM meta WHERE key='seed_version'")) as { value: string }[];
    if (cur[0]?.value === version) return { ok: true, provisioned: false, reason: `seed up to date (v${version})` };
  }

  await loadSeed(sql);
  await sql.query(
    "INSERT INTO meta (key,value) VALUES ('seed_version',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
    [version],
  );

  const [counts] = (await sql.query(
    "SELECT (SELECT count(*)::int FROM node) nodes, (SELECT count(*)::int FROM claim) claims, (SELECT count(*)::int FROM evidence) evidence, (SELECT count(*)::int FROM embedding) embeddings",
  )) as ProvisionResult["counts"][];
  return { ok: true, provisioned: true, counts };
}
