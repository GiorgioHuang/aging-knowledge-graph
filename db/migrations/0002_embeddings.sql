-- GraceAge Knowledge — V0 OPTIONAL embeddings (semantic search / RAG groundwork)
-- Requires the pgvector extension. Run only where `vector` is available
-- (e.g. Supabase). The core schema (0001) does not depend on this.

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- Dimension MUST match the embedder (src/embeddings.ts). The offline default
-- HashingEmbedder is 256-dim; switch to e.g. 1536 for OpenAI text-embedding-3-small.
CREATE TABLE embedding (
  id         text PRIMARY KEY,
  owner_type text NOT NULL CHECK (owner_type IN ('node', 'claim')),
  owner_id   text NOT NULL,
  model      text NOT NULL,
  vector     vector(256) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX embedding_owner_idx ON embedding (owner_type, owner_id);
-- Approximate nearest-neighbour index (cosine). HNSW needs no training and
-- works well at small/large scale; switch to ivfflat if preferred.
CREATE INDEX embedding_vector_idx ON embedding
  USING hnsw (vector vector_cosine_ops);

COMMIT;
