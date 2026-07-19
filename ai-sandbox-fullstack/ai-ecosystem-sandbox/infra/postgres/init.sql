-- Enable pgvector and create demo schema for RAG / memory experiments.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS sandbox;

CREATE TABLE IF NOT EXISTS sandbox.documents (
    id          BIGSERIAL PRIMARY KEY,
    doc_id      TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sandbox.embeddings (
    id          BIGSERIAL PRIMARY KEY,
    doc_id      TEXT NOT NULL REFERENCES sandbox.documents(doc_id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    embedding   vector(384),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
    ON sandbox.embeddings
    USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS sandbox.agent_memory (
    id          BIGSERIAL PRIMARY KEY,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_session
    ON sandbox.agent_memory (session_id, created_at);

-- ── CSI Nora server-side, disk-backed Knowledge Base ────────────────────────────
-- Doc registry + chunk text + full-text (sparse) live here; dense vectors live in
-- Qdrant (collection csinora_kb). The bridge also creates these at runtime
-- (CREATE ... IF NOT EXISTS) so it works on volumes created before this file.
CREATE SCHEMA IF NOT EXISTS kb;

CREATE TABLE IF NOT EXISTS kb.documents (
    doc_id      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT,
    size        BIGINT DEFAULT 0,
    sensitivity TEXT DEFAULT 'internal',
    content     TEXT DEFAULT '',
    chunk_count INT  DEFAULT 0,
    indexed     BOOLEAN DEFAULT FALSE,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb.chunks (
    chunk_id    TEXT PRIMARY KEY,
    doc_id      TEXT NOT NULL REFERENCES kb.documents(doc_id) ON DELETE CASCADE,
    doc_name    TEXT,
    content     TEXT NOT NULL,
    sensitivity TEXT DEFAULT 'internal',
    tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_tsv ON kb.chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb.chunks (doc_id);
