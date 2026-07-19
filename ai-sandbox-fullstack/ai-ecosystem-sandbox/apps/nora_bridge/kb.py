"""Server-side, disk-backed Knowledge Base API for the CSI Nora bridge.

Persists the KB on the HOST disk via the sandbox's existing Dockerized stores:
  * Qdrant   (collection ``csinora_kb``) → dense vectors (ANN, cosine)  → volume ``qdrant_data``
  * Postgres (schema ``kb``)             → doc registry + chunk text + full-text (sparse)
                                           → volume ``postgres_data``

Because the data lives on named Docker volumes, the KB is effectively unlimited
(disk-bound), shared across every browser/device hitting this deployment, and it
survives browser clearing AND ``docker compose down`` / host reboots (as long as
you don't ``down -v``).

Embeddings are computed CLIENT-SIDE (the app's self-hosted MiniLM, 384-dim,
L2-normalised) and sent with the chunks on ingest; the query embedding is likewise
sent to ``/kb/query``. That keeps this bridge image lean and fully offline-capable
(no server-side model download).

Hybrid retrieval mirrors the browser exactly: dense (Qdrant cosine) + sparse
(Postgres ``ts_rank`` full-text) fused with Reciprocal Rank Fusion (k=60), then a
``minScore`` floor and ``topK`` cut — so citations look identical in the UI.
"""

from __future__ import annotations

import os
import re
import uuid
from typing import Any, Literal, Optional

import httpx
import psycopg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# ── Config (all overridable via env; defaults match docker-compose service names) ─
QDRANT_URL  = os.getenv("QDRANT_URL", "http://qdrant:6333").rstrip("/")
COLLECTION  = os.getenv("KB_QDRANT_COLLECTION", "csinora_kb")
VECTOR_SIZE = int(os.getenv("KB_VECTOR_SIZE", "384"))
PG_DSN      = os.getenv(
    "POSTGRES_DSN",
    "postgresql://sandbox:sandbox_dev_password@postgres:5432/ai_sandbox",
)
RRF_K = 60

# Stable namespace so a chunk_id always maps to the same Qdrant point UUID
# (Qdrant point ids must be unsigned ints or UUIDs).
_NS = uuid.UUID("6b3f9d2a-0000-4000-8000-c5170a5e0001")

router = APIRouter(prefix="/kb", tags=["kb"])

_ready = False


def _point_id(chunk_id: str) -> str:
    return str(uuid.uuid5(_NS, chunk_id))


# ── Bootstrap (idempotent; runs at startup AND lazily so it also works on an
#    already-populated volume where the postgres init.sql won't re-run) ───────────
def _ensure_schema() -> None:
    with psycopg.connect(PG_DSN, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute("CREATE SCHEMA IF NOT EXISTS kb;")
        cur.execute(
            """
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
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS kb.chunks (
                chunk_id    TEXT PRIMARY KEY,
                doc_id      TEXT NOT NULL REFERENCES kb.documents(doc_id) ON DELETE CASCADE,
                doc_name    TEXT,
                content     TEXT NOT NULL,
                sensitivity TEXT DEFAULT 'internal',
                tsv         TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
            );
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_kb_chunks_tsv ON kb.chunks USING GIN (tsv);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb.chunks (doc_id);")
        conn.commit()


def _ensure_collection() -> None:
    # Create the Qdrant collection if it isn't there yet (cosine, 384-dim).
    r = httpx.get(f"{QDRANT_URL}/collections/{COLLECTION}", timeout=5)
    if r.status_code == 200:
        return
    httpx.put(
        f"{QDRANT_URL}/collections/{COLLECTION}",
        json={"vectors": {"size": VECTOR_SIZE, "distance": "Cosine"}},
        timeout=15,
    ).raise_for_status()
    # Payload index on docId/sensitivity for fast filtered search + deletes.
    for field in ("docId", "sensitivity"):
        try:
            httpx.put(
                f"{QDRANT_URL}/collections/{COLLECTION}/index?wait=true",
                json={"field_name": field, "field_schema": "keyword"},
                timeout=10,
            )
        except Exception:  # noqa: BLE001 - index is an optimisation, not required
            pass


def ensure_ready(force: bool = False) -> None:
    """Best-effort bootstrap of both stores. Safe to call repeatedly."""
    global _ready
    if _ready and not force:
        return
    _ensure_schema()
    _ensure_collection()
    _ready = True


# ── Schemas ─────────────────────────────────────────────────────────────────────
class ChunkIn(BaseModel):
    id: str
    docId: str
    docName: str
    content: str
    sensitivity: str = "internal"
    vector: Optional[list[float]] = None


class DocIn(BaseModel):
    id: str
    name: str
    type: str = ""
    size: int = 0
    sensitivity: str = "internal"
    content: str = ""
    uploadedAt: Optional[str] = None
    chunks: list[ChunkIn] = Field(default_factory=list)


class DocOut(BaseModel):
    id: str
    name: str
    type: str
    size: int
    sensitivity: str
    chunkCount: int
    indexed: bool
    uploadedAt: Optional[str] = None


class QueryIn(BaseModel):
    query: str
    queryVector: Optional[list[float]] = None
    topK: int = Field(default=5, ge=1, le=50)
    minScore: float = 0.0
    mode: Literal["hybrid", "dense", "sparse", "off"] = "hybrid"
    sensitivities: Optional[list[str]] = None


class RetrievedOut(BaseModel):
    chunkId: str
    docId: str
    docName: str
    content: str
    sensitivity: str
    denseScore: float
    sparseScore: float
    hybridScore: float
    rank: int


# ── Qdrant helpers (REST via httpx — no client lib, keeps the image lean) ─────────
def _qdrant_delete_doc(doc_id: str) -> None:
    httpx.post(
        f"{QDRANT_URL}/collections/{COLLECTION}/points/delete?wait=true",
        json={"filter": {"must": [{"key": "docId", "match": {"value": doc_id}}]}},
        timeout=30,
    )


def _qdrant_search(vector: list[float], sensitivities: Optional[list[str]], limit: int) -> list[dict]:
    body: dict[str, Any] = {"vector": vector, "limit": limit, "with_payload": True}
    if sensitivities:
        body["filter"] = {"must": [{"key": "sensitivity", "match": {"any": sensitivities}}]}
    r = httpx.post(f"{QDRANT_URL}/collections/{COLLECTION}/points/search", json=body, timeout=30)
    r.raise_for_status()
    out = []
    for p in r.json().get("result", []):
        pl = p.get("payload") or {}
        out.append({
            "chunkId": pl.get("chunkId"), "docId": pl.get("docId"),
            "docName": pl.get("docName"), "content": pl.get("content", ""),
            "sensitivity": pl.get("sensitivity", "internal"), "score": float(p.get("score", 0.0)),
        })
    return [x for x in out if x["chunkId"]]


# ── Postgres helpers ──────────────────────────────────────────────────────────────
def _or_tsquery(query: str) -> str:
    """Build an OR full-text query from the raw text.

    ``plainto_tsquery`` ANDs every term, so a single word absent from the corpus
    yields zero rows — unlike the client's BM25, which scores partial matches. We
    OR the alphanumeric terms (len>2) instead; ``to_tsquery`` still stems each via
    the english dictionary, so recall/scoring mirror the browser's sparse side.
    """
    terms = [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2]
    return " | ".join(terms)


def _pg_search(query: str, sensitivities: Optional[list[str]], limit: int) -> list[dict]:
    tsq = _or_tsquery(query)
    if not tsq:
        return []
    clause = "WHERE tsv @@ to_tsquery('english', %s)"
    params: list[Any] = [tsq, tsq]  # 1: ts_rank (SELECT), 2: @@ (WHERE)
    if sensitivities:
        clause += " AND sensitivity = ANY(%s)"
        params.append(sensitivities)
    params.append(limit)
    sql = (
        "SELECT chunk_id, doc_id, doc_name, content, sensitivity, "
        "ts_rank(tsv, to_tsquery('english', %s)) AS score "
        f"FROM kb.chunks {clause} ORDER BY score DESC LIMIT %s"
    )
    with psycopg.connect(PG_DSN, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    out = [{
        "chunkId": r[0], "docId": r[1], "docName": r[2], "content": r[3],
        "sensitivity": r[4], "score": float(r[5] or 0.0),
    } for r in rows]
    # Normalise to [0,1] (max=1) to mirror the client's BM25 normalisation.
    mx = max((x["score"] for x in out), default=0.0) or 1.0
    for x in out:
        x["score"] = x["score"] / mx
    return out


# ── Reciprocal Rank Fusion (identical semantics to rag.service _rrf) ──────────────
def _rrf(dense: list[dict], sparse: list[dict], k: int = RRF_K) -> list[tuple[str, dict]]:
    entries: dict[str, dict] = {}
    for rank, item in enumerate(dense):
        e = entries.setdefault(item["chunkId"], {"d": 0.0, "s": 0.0, "h": 0.0, "p": item})
        e["d"] = item["score"]; e["h"] += 1.0 / (k + rank + 1); e["p"] = item
    for rank, item in enumerate(sparse):
        e = entries.setdefault(item["chunkId"], {"d": 0.0, "s": 0.0, "h": 0.0, "p": item})
        e["s"] = item["score"]; e["h"] += 1.0 / (k + rank + 1)
        if not e.get("p"):
            e["p"] = item
    return sorted(entries.items(), key=lambda kv: kv[1]["h"], reverse=True)


# ── Endpoints ─────────────────────────────────────────────────────────────────────
@router.get("/health")
def kb_health() -> dict[str, Any]:
    pg = qd = coll = False
    docs = chunks = vectors = 0
    try:
        with psycopg.connect(PG_DSN, connect_timeout=3) as conn, conn.cursor() as cur:
            pg = True
            try:
                cur.execute("SELECT count(*) FROM kb.documents")
                docs = int(cur.fetchone()[0])
                cur.execute("SELECT count(*) FROM kb.chunks")
                chunks = int(cur.fetchone()[0])
            except Exception:  # noqa: BLE001 - tables may not exist yet
                pass
    except Exception:  # noqa: BLE001
        pg = False
    try:
        r = httpx.get(f"{QDRANT_URL}/collections/{COLLECTION}", timeout=3)
        qd = r.status_code < 500
        coll = r.status_code == 200
        if coll:
            vectors = int((r.json().get("result") or {}).get("points_count") or 0)
    except Exception:  # noqa: BLE001
        qd = False
    return {
        "status": "ok" if (pg and qd) else "degraded",
        "postgres": pg, "qdrant": qd, "collection": coll,
        "docCount": docs, "chunkCount": chunks, "vectorCount": vectors,
        "vectorSize": VECTOR_SIZE, "collectionName": COLLECTION,
    }


@router.get("/documents", response_model=list[DocOut])
def list_documents() -> list[DocOut]:
    try:
        ensure_ready()
        with psycopg.connect(PG_DSN, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT doc_id,name,type,size,sensitivity,chunk_count,indexed,uploaded_at "
                "FROM kb.documents ORDER BY uploaded_at DESC"
            )
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"KB registry unavailable: {exc}") from exc
    return [DocOut(
        id=r[0], name=r[1], type=r[2] or "", size=int(r[3] or 0), sensitivity=r[4] or "internal",
        chunkCount=int(r[5] or 0), indexed=bool(r[6]),
        uploadedAt=r[7].isoformat() if r[7] else None,
    ) for r in rows]


@router.post("/documents", response_model=DocOut)
def ingest_document(doc: DocIn) -> DocOut:
    try:
        ensure_ready()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"KB stores unavailable: {exc}") from exc

    # 1) Registry + chunk text in Postgres (enables listing + sparse FTS).
    try:
        with psycopg.connect(PG_DSN, connect_timeout=10) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO kb.documents(doc_id,name,type,size,sensitivity,content,chunk_count,indexed,uploaded_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,COALESCE(%s::timestamptz, NOW()))
                ON CONFLICT (doc_id) DO UPDATE SET
                    name=EXCLUDED.name, type=EXCLUDED.type, size=EXCLUDED.size,
                    sensitivity=EXCLUDED.sensitivity, content=EXCLUDED.content,
                    chunk_count=EXCLUDED.chunk_count, indexed=EXCLUDED.indexed
                """,
                (doc.id, doc.name, doc.type, doc.size, doc.sensitivity, doc.content,
                 len(doc.chunks), False, doc.uploadedAt),
            )
            cur.execute("DELETE FROM kb.chunks WHERE doc_id=%s", (doc.id,))
            if doc.chunks:
                cur.executemany(
                    "INSERT INTO kb.chunks(chunk_id,doc_id,doc_name,content,sensitivity) VALUES (%s,%s,%s,%s,%s)",
                    [(c.id, c.docId, c.docName, c.content, c.sensitivity) for c in doc.chunks],
                )
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"KB registry write failed: {exc}") from exc

    # 2) Dense vectors in Qdrant (only chunks the client managed to embed).
    points = [{
        "id": _point_id(c.id),
        "vector": c.vector,
        "payload": {
            "chunkId": c.id, "docId": c.docId, "docName": c.docName,
            "content": c.content, "sensitivity": c.sensitivity,
        },
    } for c in doc.chunks if c.vector]

    indexed = False
    if points:
        try:
            _qdrant_delete_doc(doc.id)  # drop stale points before re-upsert
            httpx.put(
                f"{QDRANT_URL}/collections/{COLLECTION}/points?wait=true",
                json={"points": points}, timeout=120,
            ).raise_for_status()
            indexed = True
            with psycopg.connect(PG_DSN, connect_timeout=5) as conn, conn.cursor() as cur:
                cur.execute("UPDATE kb.documents SET indexed=TRUE WHERE doc_id=%s", (doc.id,))
                conn.commit()
        except Exception as exc:  # noqa: BLE001 - sparse still works; report indexed=False
            print(f"[kb] Qdrant upsert failed for {doc.id}: {exc}")

    return DocOut(
        id=doc.id, name=doc.name, type=doc.type, size=doc.size, sensitivity=doc.sensitivity,
        chunkCount=len(doc.chunks), indexed=indexed, uploadedAt=doc.uploadedAt,
    )


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str) -> dict[str, Any]:
    try:
        with psycopg.connect(PG_DSN, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM kb.documents WHERE doc_id=%s", (doc_id,))  # cascades to chunks
            deleted = cur.rowcount
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"KB delete failed: {exc}") from exc
    try:
        _qdrant_delete_doc(doc_id)
    except Exception as exc:  # noqa: BLE001
        print(f"[kb] Qdrant delete failed for {doc_id}: {exc}")
    return {"deleted": doc_id, "removed": deleted}


@router.post("/query", response_model=list[RetrievedOut])
def query_kb(q: QueryIn) -> list[RetrievedOut]:
    if q.mode == "off" or not q.query.strip():
        return []
    try:
        ensure_ready()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"KB stores unavailable: {exc}") from exc

    limit = max(q.topK * 3, 10)
    dense: list[dict] = []
    sparse: list[dict] = []
    if q.mode != "dense":
        try:
            sparse = _pg_search(q.query, q.sensitivities, limit)
        except Exception as exc:  # noqa: BLE001
            print(f"[kb] sparse search failed: {exc}")
    if q.mode != "sparse" and q.queryVector:
        try:
            dense = _qdrant_search(q.queryVector, q.sensitivities, limit)
        except Exception as exc:  # noqa: BLE001
            print(f"[kb] dense search failed: {exc}")

    fused = _rrf(dense, sparse)
    results: list[RetrievedOut] = []
    rank = 0
    for chunk_id, v in fused[: q.topK]:
        if v["h"] < q.minScore:
            continue
        p = v["p"]
        rank += 1
        results.append(RetrievedOut(
            chunkId=chunk_id, docId=p.get("docId", ""), docName=p.get("docName", ""),
            content=p.get("content", ""), sensitivity=p.get("sensitivity", "internal"),
            denseScore=round(v["d"], 6), sparseScore=round(v["s"], 6),
            hybridScore=round(v["h"], 6), rank=rank,
        ))
    return results
