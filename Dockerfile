# GraceAge Knowledge — REST API container (Cloud Run ready).
# Runs the read-only REST surface; with DATABASE_URL set it serves from
# Neon (Postgres + pgvector). Node 22 runs the TypeScript directly.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install only runtime deps (the Neon driver) — reproducible from the lockfile.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App code + curated seed (fallback backend when DATABASE_URL is unset) +
# migrations (needed by the startup auto-provisioner, src/bootstrap.ts).
COPY src ./src
COPY seed ./seed
COPY db ./db
COPY public ./public
# scripts/agent-run.ts is the Cloud Run Job entrypoint (Curator + Reviewer).
# (.dockerignore keeps the rest of scripts/ out of the image.)
COPY scripts/agent-run.ts ./scripts/agent-run.ts

# Cloud Run injects PORT (default 8080); src/http.ts reads it.
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/http.ts"]
