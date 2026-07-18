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
