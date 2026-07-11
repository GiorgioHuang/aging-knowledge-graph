// Healthy Aging Knowledge — write path (curation). Persists to Neon; validates each
// record against the model before insert; keeps embeddings in sync. Writes are
// only available when DATABASE_URL is configured and are token-gated at the HTTP
// layer (see src/http.ts).

import { getSql } from "./db.ts";
import { loadGraph } from "./model.ts";
import { getEmbedder, nodeText, embeddingIsPaced } from "./embeddings.ts";

const onto = loadGraph().ontology;
const CURIE = /^[A-Za-z0-9.]+:.+$/;

export type WriteResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; errors: string[] };

const bad = (status: number, errors: string[]): WriteResult => ({ ok: false, status, errors });

async function exists(table: "node" | "claim", id: string): Promise<boolean> {
  const sql = await getSql();
  const rows = await sql.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return rows.length > 0;
}

async function embed(id: string, ownerType: "node" | "claim", text: string): Promise<void> {
  try {
    const e = getEmbedder();
    // Under a rate-limited provider (e.g. Voyage free tier, 3 RPM), embedding on
    // every write would pace-block each row and stall bursty writes (a harvest).
    // Skip inline; the reembed Job rebuilds all vectors. Offline/paid stays inline.
    if (e.id.startsWith("remote:") && embeddingIsPaced()) return;
    const [v] = await e.embed([text]);
    const sql = await getSql();
    await sql.query(
      `INSERT INTO embedding (id, owner_type, owner_id, model, vector) VALUES ($1,$2,$3,$4,$5::vector)
       ON CONFLICT (id) DO UPDATE SET vector = EXCLUDED.vector, model = EXCLUDED.model`,
      [`emb-${ownerType}-${id}`, ownerType, id, e.id, `[${v.join(",")}]`],
    );
  } catch {
    /* embeddings are best-effort; a failure here must not fail the write */
  }
}

export async function createNode(input: Record<string, unknown>): Promise<WriteResult> {
  const errors: string[] = [];
  const id = String(input.id ?? "").trim();
  const type = String(input.type ?? "");
  const name = String(input.name ?? "").trim();
  if (!id) errors.push("id is required");
  if (!onto.nodeTypes.includes(type)) errors.push(`type must be one of: ${onto.nodeTypes.join(", ")}`);
  if (!name) errors.push("name is required");
  const external_ids = Array.isArray(input.external_ids) ? (input.external_ids as string[]) : [];
  for (const c of external_ids) if (!CURIE.test(c)) errors.push(`malformed CURIE '${c}'`);
  const domains = Array.isArray(input.domains) ? (input.domains as string[]) : [];
  if (errors.length) return bad(400, errors);
  if (await exists("node", id)) return bad(409, [`node '${id}' already exists`]);

  const sql = await getSql();
  await sql.query(
    "INSERT INTO node (id,type,name,description,aliases,domains,external_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, type, name, input.description ?? null, (input.aliases as string[]) ?? [], domains, external_ids],
  );
  const node = { id, type, name, description: input.description, aliases: input.aliases ?? [], domains, external_ids };
  await embed(id, "node", nodeText(node as never));
  return { ok: true, data: node };
}

export async function createClaim(input: Record<string, unknown>): Promise<WriteResult> {
  const errors: string[] = [];
  const id = String(input.id ?? "").trim();
  const type = String(input.type ?? "");
  const subject = String(input.subject ?? "");
  const object = String(input.object ?? "");
  const status = String(input.status ?? "curated");
  if (!id) errors.push("id is required");
  if (!onto.relationshipTypes.includes(type)) errors.push(`type must be one of: ${onto.relationshipTypes.join(", ")}`);
  if (!onto.statuses.includes(status)) errors.push(`status must be one of: ${onto.statuses.join(", ")}`);
  if (input.direction && !onto.directions.includes(String(input.direction))) errors.push(`bad direction '${input.direction}'`);
  if (input.certainty && !onto.certainties.includes(String(input.certainty))) errors.push(`bad certainty '${input.certainty}'`);
  if (input.setting && !onto.settings.includes(String(input.setting))) errors.push(`bad setting '${input.setting}'`);
  if (input.rec_strength && type !== "recommends") errors.push("rec_strength only allowed on 'recommends' claims");
  const evidence = Array.isArray(input.evidence) ? (input.evidence as Record<string, unknown>[]) : [];
  const definitional = onto.definitionalRelationships.includes(type);
  if (status === "curated" && !definitional && evidence.length === 0)
    errors.push("a curated, non-definitional claim needs at least one evidence record");
  if (errors.length) return bad(400, errors);

  // referential integrity
  if (!(await exists("node", subject))) return bad(400, [`subject node '${subject}' does not exist`]);
  if (!(await exists("node", object))) return bad(400, [`object node '${object}' does not exist`]);
  for (const ref of ["population", "mechanism"] as const) {
    const v = input[ref];
    if (v && !(await exists("node", String(v)))) return bad(400, [`${ref} node '${v}' does not exist`]);
  }
  if (await exists("claim", id)) return bad(409, [`claim '${id}' already exists`]);
  for (const ev of evidence) if (!ev.source_id || !CURIE.test(String(ev.source_id))) return bad(400, ["each evidence needs a CURIE source_id (DOI:/PMID:/URL)"]);

  const sql = await getSql();
  await sql.query(
    `INSERT INTO claim (id,type,subject_id,object_id,population_id,mechanism_id,setting,direction,
       effect_value,effect_measure,effect_note,comparator,dose,certainty,rec_strength,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [id, type, subject, object, input.population ?? null, input.mechanism ?? null, input.setting ?? null,
     input.direction ?? null, input.effect_value ?? null, input.effect_measure ?? null, input.effect_note ?? null,
     input.comparator ?? null, input.dose ?? null, input.certainty ?? null, input.rec_strength ?? null, status],
  );
  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i];
    await sql.query(
      "INSERT INTO evidence (id,claim_id,source_id,source_node_id,quote,study_design,confidence,extracted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [`${id}-e${i + 1}`, id, ev.source_id, ev.source_node ?? null, ev.quote ?? null, ev.study_design ?? null, ev.confidence ?? null, ev.extracted_by ?? "human"],
    );
  }

  // claim embedding text: "<subject> <relationship> <object>"
  const sql2 = await getSql();
  const [s] = (await sql2.query("SELECT name FROM node WHERE id=$1", [subject])) as { name: string }[];
  const [o] = (await sql2.query("SELECT name FROM node WHERE id=$1", [object])) as { name: string }[];
  await embed(id, "claim", `${s?.name ?? subject} ${type.replace(/_/g, " ")} ${o?.name ?? object} ${input.direction ?? ""}`);

  return { ok: true, data: { id, type, subject, object, status, evidence: evidence.length } };
}

async function removeEmbedding(ownerType: "node" | "claim", id: string): Promise<void> {
  try {
    const sql = await getSql();
    await sql.query("DELETE FROM embedding WHERE id = $1", [`emb-${ownerType}-${id}`]);
  } catch { /* best-effort */ }
}

export async function updateNode(id: string, input: Record<string, unknown>): Promise<WriteResult> {
  if (!(await exists("node", id))) return bad(404, [`node '${id}' not found`]);
  const type = String(input.type ?? "");
  const name = String(input.name ?? "").trim();
  const errors: string[] = [];
  if (!onto.nodeTypes.includes(type)) errors.push(`type must be one of: ${onto.nodeTypes.join(", ")}`);
  if (!name) errors.push("name is required");
  const external_ids = Array.isArray(input.external_ids) ? (input.external_ids as string[]) : [];
  for (const c of external_ids) if (!CURIE.test(c)) errors.push(`malformed CURIE '${c}'`);
  if (errors.length) return bad(400, errors);
  const domains = Array.isArray(input.domains) ? (input.domains as string[]) : [];
  const sql = await getSql();
  await sql.query(
    "UPDATE node SET type=$2,name=$3,description=$4,aliases=$5,domains=$6,external_ids=$7,updated_at=now() WHERE id=$1",
    [id, type, name, input.description ?? null, (input.aliases as string[]) ?? [], domains, external_ids],
  );
  await embed(id, "node", nodeText({ id, type, name, description: input.description, aliases: input.aliases ?? [], domains, external_ids } as never));
  return { ok: true, data: { id, type, name, domains, external_ids } };
}

export async function deleteNode(id: string): Promise<WriteResult> {
  if (!(await exists("node", id))) return bad(404, [`node '${id}' not found`]);
  const sql = await getSql();
  const [{ refs }] = (await sql.query(
    `SELECT (
       (SELECT count(*) FROM claim WHERE subject_id=$1 OR object_id=$1 OR population_id=$1 OR mechanism_id=$1)
     + (SELECT count(*) FROM evidence WHERE source_node_id=$1)
     )::int AS refs`,
    [id],
  )) as { refs: number }[];
  if (refs > 0) return bad(409, [`node '${id}' is referenced by ${refs} claim(s)/evidence; delete those first`]);
  await sql.query("DELETE FROM node WHERE id=$1", [id]);
  await removeEmbedding("node", id);
  return { ok: true, data: { deleted: id } };
}

export async function updateClaim(id: string, input: Record<string, unknown>): Promise<WriteResult> {
  if (!(await exists("claim", id))) return bad(404, [`claim '${id}' not found`]);
  const type = String(input.type ?? "");
  const subject = String(input.subject ?? "");
  const object = String(input.object ?? "");
  const status = String(input.status ?? "curated");
  const errors: string[] = [];
  if (!onto.relationshipTypes.includes(type)) errors.push(`bad type '${type}'`);
  if (!onto.statuses.includes(status)) errors.push(`bad status '${status}'`);
  if (input.direction && !onto.directions.includes(String(input.direction))) errors.push(`bad direction`);
  if (input.certainty && !onto.certainties.includes(String(input.certainty))) errors.push(`bad certainty`);
  if (input.setting && !onto.settings.includes(String(input.setting))) errors.push(`bad setting`);
  if (input.rec_strength && type !== "recommends") errors.push("rec_strength only on 'recommends'");
  if (errors.length) return bad(400, errors);
  if (!(await exists("node", subject))) return bad(400, [`subject '${subject}' does not exist`]);
  if (!(await exists("node", object))) return bad(400, [`object '${object}' does not exist`]);
  const sql = await getSql();
  await sql.query(
    `UPDATE claim SET type=$2,subject_id=$3,object_id=$4,population_id=$5,mechanism_id=$6,setting=$7,direction=$8,
       effect_value=$9,effect_measure=$10,effect_note=$11,comparator=$12,dose=$13,certainty=$14,rec_strength=$15,
       status=$16,updated_at=now() WHERE id=$1`,
    [id, type, subject, object, input.population ?? null, input.mechanism ?? null, input.setting ?? null,
     input.direction ?? null, input.effect_value ?? null, input.effect_measure ?? null, input.effect_note ?? null,
     input.comparator ?? null, input.dose ?? null, input.certainty ?? null, input.rec_strength ?? null, status],
  );
  const [s] = (await sql.query("SELECT name FROM node WHERE id=$1", [subject])) as { name: string }[];
  const [o] = (await sql.query("SELECT name FROM node WHERE id=$1", [object])) as { name: string }[];
  await embed(id, "claim", `${s?.name ?? subject} ${type.replace(/_/g, " ")} ${o?.name ?? object} ${input.direction ?? ""}`);
  return { ok: true, data: { id, type, subject, object, status } };
}

export async function deleteClaim(id: string): Promise<WriteResult> {
  if (!(await exists("claim", id))) return bad(404, [`claim '${id}' not found`]);
  const sql = await getSql();
  await sql.query("DELETE FROM claim WHERE id=$1", [id]); // cascades evidence + claim_relation
  await removeEmbedding("claim", id);
  return { ok: true, data: { deleted: id } };
}

export async function deleteEvidence(id: string): Promise<WriteResult> {
  const sql = await getSql();
  const rows = await sql.query("DELETE FROM evidence WHERE id=$1 RETURNING id", [id]);
  if (rows.length === 0) return bad(404, [`evidence '${id}' not found`]);
  return { ok: true, data: { deleted: id } };
}

/** Add a surface form to a node's aliases (de-duped, case-insensitive; never the
 *  node's own name). Best-effort — used by the curator's entity resolver when it
 *  folds a new surface form into an existing node. */
export async function addAlias(id: string, alias: string): Promise<void> {
  const a = (alias ?? "").trim();
  if (!a) return;
  try {
    const sql = await getSql();
    await sql.query(
      `UPDATE node
       SET aliases = (SELECT array_agg(DISTINCT x) FROM unnest(aliases || $2::text[]) x), updated_at = now()
       WHERE id = $1
         AND lower($3) <> lower(name)
         AND NOT (lower($3) = ANY (SELECT lower(y) FROM unnest(aliases) y))`,
      [id, [a], a],
    );
  } catch {
    /* aliasing is best-effort; must not fail a curation run */
  }
}

export async function createEvidence(input: Record<string, unknown>): Promise<WriteResult> {
  const id = String(input.id ?? "").trim();
  const claim = String(input.claim ?? "");
  const source_id = String(input.source_id ?? "");
  const errors: string[] = [];
  if (!id) errors.push("id is required");
  if (!claim) errors.push("claim is required");
  if (!CURIE.test(source_id)) errors.push("source_id must be a CURIE (DOI:/PMID:/URL)");
  if (input.study_design && !onto.studyDesigns.includes(String(input.study_design))) errors.push(`bad study_design '${input.study_design}'`);
  if (errors.length) return bad(400, errors);
  if (!(await exists("claim", claim))) return bad(400, [`claim '${claim}' does not exist`]);

  const sql = await getSql();
  await sql.query(
    "INSERT INTO evidence (id,claim_id,source_id,source_node_id,quote,study_design,confidence,extracted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, claim, source_id, input.source_node ?? null, input.quote ?? null, input.study_design ?? null, input.confidence ?? null, input.extracted_by ?? "human"],
  );
  return { ok: true, data: { id, claim, source_id } };
}
