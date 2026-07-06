# 15 · Deployment (Cloud Run + Neon)

> Part of **Healthy Aging Knowledge**. See the [doc map](../README.md#documentation-map--文档导航).

Deploy the REST API to **Google Cloud Run**, which calls **Neon (Postgres +
pgvector)**. Cloud Run has **open egress**, so it reaches Neon's HTTPS endpoint
directly — no allowlist juggling (the sandbox limitation noted in
[`14`](14-semantic-search.md)). The Neon serverless driver over HTTPS suits
Cloud Run's scale-to-zero model.

```
browser / agent ──HTTPS──▶ Cloud Run (REST + POST /mcp) ──HTTPS──▶ Neon (pgvector)
                                       └─ no DATABASE_URL ⇒ offline seed fallback
```

**One deploy = everything online.** On first boot with `DATABASE_URL` set, the
service **auto-provisions** Neon (migrations + seed + embeddings, idempotent —
`ensureProvisioned` in `src/bootstrap.ts`); later boots see it provisioned and
skip. So you do **not** need a separate `db:setup` step — just deploy. The
canonical seed (`seed/graph.json`) carries a `version`; bumping it makes the next
deploy **upsert** the updated seed into Neon (refreshing seed rows, preserving
curator-added records) without a wipe. (You can still run `npm run db:ensure` /
`npm run db:setup` manually.) Agents can use the online **`POST /mcp`** endpoint
as well as REST.

## 中文摘要

把 REST API 部署到 **Google Cloud Run**，由它调用 **Neon (Postgres + pgvector)**。
Cloud Run **出站开放**，能直接访问 Neon 的 HTTPS 端点——绕开本沙箱的白名单限制。
容器读 `PORT`（Cloud Run 默认 8080）；设了 `DATABASE_URL` 就走 Neon，否则回退到离线种子。
部署需在**已认证 gcloud 的机器**上跑（本沙箱无 gcloud、无 docker 守护进程，故部署由你执行；
入口已在本地按 `PORT=8080` 验证可用）。数据库先用 `npm run db:setup` 在能连 Neon 的机器上灌一次。

## Files

- [`Dockerfile`](../Dockerfile) — `node:22-slim`, installs only the Neon driver
  from the lockfile, runs `src/http.ts`.
- [`.dockerignore`](../.dockerignore), `npm start` script.
- [`scripts/deploy-cloudrun.sh`](../scripts/deploy-cloudrun.sh) — `gcloud run deploy`.

## Steps

**0. Prereqs:** a GCP project with `gcloud` authenticated; a Neon database.

**1. (Optional) provision the DB** — the service auto-provisions on first boot, so
this is only for pre-seeding/reset. From a machine that can reach Neon:

```bash
DATABASE_URL='postgresql://…?sslmode=require' npm run db:ensure   # or db:setup to reset
```

**2. Store the connection string as a secret:**

```bash
printf '%s' 'postgresql://…?sslmode=require' \
  | gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic
```

**3. Deploy** (Cloud Run builds the Dockerfile via Cloud Build):

```bash
REGION=us-east1 bash scripts/deploy-cloudrun.sh
# equivalently:
gcloud run deploy graceage-knowledge --source . --region us-east1 \
  --allow-unauthenticated --port 8080 --set-secrets DATABASE_URL=DATABASE_URL:latest
```

**4. Test the live service:**

```bash
URL=$(gcloud run services describe graceage-knowledge --region us-east1 --format='value(status.url)')
curl "$URL/health"
curl "$URL/query/search?q=falling%20in%20the%20elderly&k=5"   # pgvector-backed
```

## Notes

- **Region:** Neon here is AWS `us-east-1`; Cloud Run `us-east1` (GCP) keeps the
  hop short. Cross-cloud latency is small for this workload.
- **Secrets:** prefer Secret Manager (`--set-secrets`) over `--set-env-vars`;
  rotate with `gcloud secrets versions add DATABASE_URL --data-file=-`.
- **Auth:** `--allow-unauthenticated` for a public read-only API; drop it and use
  IAM / an API gateway for private access.
- **MCP:** Cloud Run serves the **REST** surface. The stdio MCP server
  (`src/mcp.ts`) runs locally beside an agent; an MCP-over-HTTP (Streamable HTTP)
  transport on Cloud Run is a possible later addition.
- **Migrations on deploy:** kept separate (step 1) rather than on cold start. For
  CI, run `db:setup` as a Cloud Run **Job** using the same image.

## CI/CD (GitHub Actions)

- **`.github/workflows/ci.yml`** — on every push/PR: `npm ci`, `npm run validate`,
  `npm test`. Hermetic (no DB needed).
- **`.github/workflows/deploy.yml`** — on `workflow_dispatch` (manual) and pushes
  to `main`: keyless auth via **Workload Identity Federation**, then
  `gcloud run deploy --source .`. Secrets are injected from Secret Manager at
  deploy time — they never touch GitHub: `DATABASE_URL` always, and
  **`CURATOR_TOKEN`** (write path / review actions) mounted only when the secret
  exists (otherwise it deploys read-only). Before deploying, an **"ensure runtime
  SA can read secrets"** step idempotently grants the Cloud Run runtime SA
  `roles/secretmanager.secretAccessor` on each existing secret, so a
  newly-created secret can't fail a revision with *Permission denied on secret*.
  The same workflow also redeploys the **agents Cloud Run Job** (Curator +
  Reviewer; see [`17`](17-agents.md)) from the same source — it skips cleanly
  until the `ANTHROPIC_API_KEY` secret exists, and leaves the Cloud Scheduler
  trigger (created once by [`scripts/deploy-agents.sh`](../scripts/deploy-agents.sh))
  untouched.

**One-time setup** — run [`scripts/setup-gcp.sh`](../scripts/setup-gcp.sh) (gcloud
authenticated as project owner). It enables APIs, creates the deployer service
account + roles, the Workload Identity pool/provider bound to this repo, the
repo→SA impersonation binding, and the `DATABASE_URL` secret:

```bash
DATABASE_URL='postgresql://…?sslmode=require&channel_binding=require' bash scripts/setup-gcp.sh
```

It prints the repo **Variables** to set (Settings → Secrets and variables →
Actions → Variables). To do it by hand instead, create a Workload Identity
pool/provider bound to this repo and a deployer service account (roles: Cloud Run
Admin, Cloud Build Editor, Service Account User, Secret Manager Accessor,
Artifact Registry Writer), then add:

| Variable | Example |
|----------|---------|
| `GCP_PROJECT_ID` | `my-project` |
| `GCP_WIF_PROVIDER` | `projects/123/locations/global/workloadIdentityPools/gh/providers/gh` |
| `GCP_SERVICE_ACCOUNT` | `deployer@my-project.iam.gserviceaccount.com` |
| `GCP_REGION` | `us-east1` (optional) |
| `CLOUD_RUN_SERVICE` | `graceage-knowledge` (optional) |

DB provisioning (`npm run db:setup`) stays a one-off (step 1) — not part of the
deploy workflow, so DB credentials never live in CI.

## Custom domain (Cloudflare)

Map a custom domain to the service with a Google-managed certificate, using
Cloudflare for DNS. **Live:** the service is deployed at **https://ack.icareu.ca**
(Cloudflare → Cloud Run → Neon).

```bash
# 1) verify ownership once (adds a TXT record you paste into Cloudflare)
gcloud domains verify yourdomain.com

# 2) create the mapping + print the DNS records to add
bash scripts/map-domain.sh api.yourdomain.com
```

3. In **Cloudflare → DNS**, add the record(s) `map-domain.sh` printed (a subdomain
   gets a **CNAME** → `ghs.googlehosted.com`). Set it to **DNS only (grey cloud)**
   so Google can provision the managed cert.
4. Wait for the cert to go **ACTIVE** (minutes–hours), then
   `https://api.yourdomain.com/health` works.
5. *(Optional)* switch the record to **Proxied (orange)** for Cloudflare CDN/WAF,
   and set **SSL/TLS mode = Full (strict)**.

Notes:
- Cloud Run **domain mappings** are region-limited; `us-east1` is supported. If a
  region isn't, use a global external HTTPS Load Balancer + serverless NEG instead.
- Apex domains (`yourdomain.com`) need A/AAAA records (mapping prints them) — a
  subdomain via CNAME is simpler.

## Status & honesty

- The container **entrypoint is verified locally** (`PORT=8080`, `/health` and
  `/query/search` respond).
- The **image build and `gcloud` deploy are run by you** — this sandbox has no
  Docker daemon and no `gcloud`. The artifacts above are ready to deploy as-is.
