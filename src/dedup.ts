// GraceAge Knowledge — merge duplicate edges (claims) that predate the curator's
// edge-level de-dup. Groups claims by subject + relationship + object + direction
// (population-agnostic, direction-sensitive so opposing claims stay separate).
// Keeps one (prefer curated, then oldest), moves the others' evidence onto it
// (dropping already-cited sources), re-points contradictions, deletes the
// duplicates + their embeddings. Lives in src/ so it ships in the image and can
// run online (HTTP endpoint) as well as via scripts/dedup-claims.ts.

import { getSql } from "./db.ts";

export interface DedupSummary {
  mode: "applied" | "dry-run";
  duplicate_groups: number;
  edges_merged: number;
  claims_deleted: number;
  evidence_moved: number;
  evidence_dropped: number;
  details: string[];
}

export async function dedupClaims({ apply = false }: { apply?: boolean } = {}): Promise<DedupSummary> {
  const sql = await getSql();
  const groups = (await sql.query(
    `SELECT subject_id, object_id, type, direction, count(*)::int AS n
     FROM claim
     GROUP BY subject_id, object_id, type, direction
     HAVING count(*) > 1
     ORDER BY n DESC`,
    [],
  )) as { subject_id: string; object_id: string; type: string; direction: string | null }[];

  let edgesMerged = 0, claimsDeleted = 0, evidenceMoved = 0, evidenceDropped = 0;
  const details: string[] = [];

  for (const g of groups) {
    const members = (await sql.query(
      `SELECT id, status FROM claim
       WHERE subject_id=$1 AND object_id=$2 AND type=$3 AND direction IS NOT DISTINCT FROM $4
       ORDER BY (status='curated') DESC, created_at ASC`,
      [g.subject_id, g.object_id, g.type, g.direction],
    )) as { id: string; status: string }[];
    if (members.length < 2) continue;

    const keeper = members[0];
    const dups = members.slice(1);
    details.push(`${g.subject_id} [${g.type}${g.direction ? "/" + g.direction : ""}] ${g.object_id}: keep ${keeper.id} (${keeper.status}); merge ${dups.map((d) => d.id).join(", ")}`);

    for (const dup of dups) {
      const ev = (await sql.query("SELECT id, source_id FROM evidence WHERE claim_id=$1", [dup.id])) as { id: string; source_id: string }[];
      for (const e of ev) {
        const dupSrc = (await sql.query("SELECT 1 FROM evidence WHERE claim_id=$1 AND source_id=$2", [keeper.id, e.source_id])) as unknown[];
        if (dupSrc.length) {
          evidenceDropped++;
          if (apply) await sql.query("DELETE FROM evidence WHERE id=$1", [e.id]);
        } else {
          evidenceMoved++;
          if (apply) await sql.query("UPDATE evidence SET claim_id=$1 WHERE id=$2", [keeper.id, e.id]);
        }
      }
      if (apply) {
        await sql.query("UPDATE claim_relation SET subject_claim_id=$1 WHERE subject_claim_id=$2", [keeper.id, dup.id]);
        await sql.query("UPDATE claim_relation SET object_claim_id=$1 WHERE object_claim_id=$2", [keeper.id, dup.id]);
        await sql.query("DELETE FROM claim_relation WHERE subject_claim_id = object_claim_id", []);
        await sql.query("DELETE FROM embedding WHERE owner_type='claim' AND owner_id=$1", [dup.id]);
        await sql.query("DELETE FROM claim WHERE id=$1", [dup.id]);
      }
      claimsDeleted++;
    }
    edgesMerged++;
  }

  return {
    mode: apply ? "applied" : "dry-run",
    duplicate_groups: groups.length,
    edges_merged: edgesMerged,
    claims_deleted: claimsDeleted,
    evidence_moved: evidenceMoved,
    evidence_dropped: evidenceDropped,
    details,
  };
}
