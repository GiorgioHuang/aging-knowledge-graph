// Generate Postgres INSERTs from the JSON seed (single source of truth).
//   node --experimental-strip-types scripts/seed-to-sql.ts > db/seed.generated.sql
// The output loads into the schema from db/migrations/0001_init.sql.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { GraphData } from "../src/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(join(here, "..", "seed", "graph.json"), "utf8"),
) as GraphData;

const q = (s: string | undefined | null): string =>
  s === undefined || s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`;
const num = (n: number | undefined): string => (n === undefined ? "NULL" : String(n));
const arr = (xs: string[] | undefined): string =>
  !xs || xs.length === 0 ? "'{}'" : `ARRAY[${xs.map(q).join(", ")}]::text[]`;

const out: string[] = ["BEGIN;", ""];

out.push("-- nodes");
for (const n of data.nodes) {
  out.push(
    `INSERT INTO node (id, type, name, description, aliases, domains, external_ids) VALUES (` +
      `${q(n.id)}, ${q(n.type)}, ${q(n.name)}, ${q(n.description)}, ` +
      `${arr(n.aliases)}, ${arr(n.domains)}, ${arr(n.external_ids)});`,
  );
}

out.push("", "-- claims");
for (const c of data.claims) {
  out.push(
    `INSERT INTO claim (id, type, subject_id, object_id, population_id, mechanism_id, setting, ` +
      `direction, effect_value, effect_measure, effect_note, comparator, dose, certainty, ` +
      `rec_strength, status) VALUES (` +
      `${q(c.id)}, ${q(c.type)}, ${q(c.subject)}, ${q(c.object)}, ${q(c.population)}, ${q(c.mechanism)}, ` +
      `${q(c.setting)}, ${q(c.direction)}, ${num(c.effect_value)}, ${q(c.effect_measure)}, ${q(c.effect_note)}, ` +
      `${q(c.comparator)}, ${q(c.dose)}, ${q(c.certainty)}, ${q(c.rec_strength)}, ${q(c.status)});`,
  );
}

out.push("", "-- evidence");
for (const e of data.evidence) {
  out.push(
    `INSERT INTO evidence (id, claim_id, source_id, source_node_id, quote, study_design, ` +
      `confidence, extracted_by) VALUES (` +
      `${q(e.id)}, ${q(e.claim)}, ${q(e.source_id)}, ${q(e.source_node)}, ${q(e.quote)}, ` +
      `${q(e.study_design)}, ${num(e.confidence)}, ${q(e.extracted_by)});`,
  );
}

out.push("", "-- contradictions");
for (const ct of data.contradictions) {
  out.push(
    `INSERT INTO claim_relation (id, type, subject_claim_id, object_claim_id) VALUES (` +
      `${q(ct.id)}, 'contradicts', ${q(ct.subject_claim)}, ${q(ct.object_claim)});`,
  );
}

out.push("", "COMMIT;", "");
process.stdout.write(out.join("\n"));
