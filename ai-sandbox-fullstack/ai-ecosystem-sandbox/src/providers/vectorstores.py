"""Vector store helpers: Chroma, Qdrant, pgvector, Redis cache."""

from __future__ import annotations

from typing import Any, Literal

from src.config import get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)

VectorBackend = Literal["chroma", "qdrant", "pgvector"]


def get_chroma_collection(name: str = "sandbox_docs"):
    import chromadb

    s = get_settings()
    client = chromadb.HttpClient(host=s.chroma_host, port=s.chroma_port)
    return client.get_or_create_collection(name=name, metadata={"hnsw:space": "cosine"})


def get_qdrant_client():
    from qdrant_client import QdrantClient

    s = get_settings()
    return QdrantClient(url=s.qdrant_url)


def upsert_qdrant(collection: str, ids: list[str], vectors: list[list[float]], payloads: list[dict[str, Any]]):
    from qdrant_client.models import Distance, PointStruct, VectorParams

    client = get_qdrant_client()
    dim = len(vectors[0])
    if not client.collection_exists(collection):
        client.create_collection(collection, vectors_config=VectorParams(size=dim, distance=Distance.COSINE))
    points = [PointStruct(id=i, vector=v, payload=p) for i, (v, p) in enumerate(zip(vectors, payloads))]
    client.upsert(collection_name=collection, points=points)


def search_qdrant(collection: str, vector: list[float], limit: int = 3) -> list[dict[str, Any]]:
    client = get_qdrant_client()
    if not client.collection_exists(collection):
        return []
    hits = client.search(collection_name=collection, query_vector=vector, limit=limit)
    return [{"score": h.score, "payload": h.payload} for h in hits]


def pgvector_upsert(doc_id: str, title: str, content: str, vector: list[float], model: str) -> None:
    import psycopg2

    s = get_settings()
    with psycopg2.connect(s.postgres_dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sandbox.documents (doc_id, title, content)
            VALUES (%s, %s, %s)
            ON CONFLICT (doc_id) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content
            """,
            (doc_id, title, content),
        )
        cur.execute(
            """
            INSERT INTO sandbox.embeddings (doc_id, model, embedding)
            VALUES (%s, %s, %s::vector)
            """,
            (doc_id, model, vector),
        )
        conn.commit()


def pgvector_search(vector: list[float], limit: int = 3) -> list[dict[str, Any]]:
    import psycopg2
    from psycopg2.extras import RealDictCursor

    s = get_settings()
    with psycopg2.connect(s.postgres_dsn) as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT d.doc_id, d.title, d.content,
                   1 - (e.embedding <=> %s::vector) AS score
            FROM sandbox.embeddings e
            JOIN sandbox.documents d ON d.doc_id = e.doc_id
            ORDER BY e.embedding <=> %s::vector
            LIMIT %s
            """,
            (vector, vector, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def redis_cache_get(key: str) -> str | None:
    import redis

    s = get_settings()
    r = redis.from_url(s.redis_url, decode_responses=True)
    return r.get(key)


def redis_cache_set(key: str, value: str, ttl: int = 3600) -> None:
    import redis

    s = get_settings()
    r = redis.from_url(s.redis_url, decode_responses=True)
    r.setex(key, ttl, value)
