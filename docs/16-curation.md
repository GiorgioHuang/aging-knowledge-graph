# 16 · Curation (write path & UI)

> Part of **GraceAge Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

V1 adds a **write path** so curators can grow the graph through an API and a
minimal web UI — not by editing JSON. Reads stay public; **writes are token-gated
and persist to Neon**. Every write is validated against the model
([`02`](02-knowledge-model.md)) and updates embeddings so search stays current.

## 中文摘要

V1 增加**写路径**:策展者可通过 API 或最小网页界面增改图谱,而不必改 JSON。**读公开、写需令牌**
并落库到 Neon。每次写入都按[知识模型](02-knowledge-model.md)校验(类型、外键存在、CURIE、证据规则),
并同步更新向量,使检索即时可见。

- 界面:`/admin`(纯前端,零依赖)。
- 鉴权:`Authorization: Bearer <CURATOR_TOKEN>`;令牌经 Secret Manager 注入。
- 离线/seed 模式只读(写返回 503);未设 `CURATOR_TOKEN` 时写被禁用(403)。

## Endpoints (write)

All require `Authorization: Bearer <CURATOR_TOKEN>` and a configured database.

| Method | Route | Body |
|--------|-------|------|
| POST | `/nodes` | `{ id, type, name, domains?, external_ids?, description? }` |
| POST | `/claims` | `{ id, type, subject, object, population?, direction?, certainty?, status?, rec_strength?, comparator?, dose?, evidence?: [{source_id, study_design?, quote?}] }` |
| POST | `/evidence` | `{ id, claim, source_id, study_design?, quote? }` |
| PUT | `/nodes/:id` | full node fields (overwrite; id immutable) |
| PUT | `/claims/:id` | full claim fields (overwrite) |
| DELETE | `/nodes/:id` | — (409 if referenced by claims/evidence) |
| DELETE | `/claims/:id` | — (cascades its evidence + contradiction links) |
| DELETE | `/evidence/:id` | — |

Deletes/updates keep embeddings in sync (removed/refreshed). Visualization data:
`GET /graph` → `{ nodes:[{id,name,type,domains}], edges:[{id,type,source,target,certainty,status}] }`.

### Bulk import, filters & PubMed

| Method | Route | Notes |
|--------|-------|-------|
| POST | `/import` | JSON batch `{nodes?,claims?,evidence?}` → per-row create + summary |
| POST | `/import/csv?kind=nodes\|claims` | CSV body; multi-values use `;` |
| GET | `/pubmed/:pmid` | token-gated citation lookup (NCBI E-utilities) to pre-fill evidence |

CSV headers: nodes `id,type,name,domains,external_ids,description`; claims
`id,type,subject,object,population,direction,certainty,status,source_id,study_design,quote`.

Richer **read filters**: `GET /nodes?q=&type=&domain=` (q = name/alias/id
substring); `GET /claims?type=&status=&certainty=&subject=&object=`. The `/admin`
page has an import box, a node filter, and a "Look up PMID" button on the claim
form. Import is token-gated and Neon-backed; PubMed lookup is token-gated.

Responses: `201` + created record; `400` validation errors; `401` bad/missing
token; `403` writes disabled (no token configured); `409` id exists; `503` no
database (read-only instance). Reads: also `GET /ontology` (vocabularies for the
UI) and the UI at **`/admin`**.

Example:

```bash
curl -X POST "$URL/nodes" -H "authorization: Bearer $CURATOR_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"id":"ga:tai-chi","type":"exercise","name":"Tai Chi","domains":["exercise","falls"],"external_ids":["MESH:D061818"]}'
```

## Enable writes on the live service (one-time)

Writes need a `CURATOR_TOKEN` secret mounted on Cloud Run. The deploy uses
`--update-secrets` (not `--set-secrets`), so this survives future deploys.

```bash
PROJECT=giorgio-h; REGION=us-east1; SVC=graceage-knowledge
RUNTIME_SA=535650065054-compute@developer.gserviceaccount.com

# 1) create a strong token secret
printf '%s' "$(openssl rand -hex 24)" | gcloud secrets create CURATOR_TOKEN \
  --data-file=- --replication-policy=automatic --project "$PROJECT"
gcloud secrets add-iam-policy-binding CURATOR_TOKEN \
  --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor --project "$PROJECT"

# 2) mount it on the service (keeps DATABASE_URL too)
gcloud run services update "$SVC" --region "$REGION" --project "$PROJECT" \
  --update-secrets CURATOR_TOKEN=CURATOR_TOKEN:latest

# 3) read the token to paste into the /admin UI
gcloud secrets versions access latest --secret CURATOR_TOKEN --project "$PROJECT"
```

Then open `https://ack.icareu.ca/admin`, paste the token, and add/edit/delete
nodes & claims. The page also renders a **force-directed graph** (zero-dependency
SVG, from `GET /graph`) — click a node to highlight its links.

## Design notes

- **Validation** mirrors `src/model.ts` rules per record (type ∈ vocab, subject/
  object exist, CURIE format, `rec_strength` only on `recommends`, curated
  non-definitional claims require evidence).
- **Consistency:** after a successful write the serving instance reloads its
  in-memory graph from Neon and the new node/claim gets an embedding. Other
  Cloud Run instances pick up changes on their next cold start (they load from
  Neon). Fine for low traffic; a periodic refresh can be added later.
- **Updates/deletes** are not exposed yet (create-only V1); add with the same
  validation when needed.
- **Status & honesty:** the read-only guard (503) and UI are verified in-container
  (`test/writes.test.ts`); the authenticated write path runs against Neon on the
  deployed service (no DB in the sandbox).
