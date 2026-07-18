"""RAG pipelines: LangChain, LlamaIndex, Haystack."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document

from src.providers.embeddings import embed_texts
from src.providers.llm_router import chat
from src.providers.vectorstores import get_chroma_collection, pgvector_search, pgvector_upsert, search_qdrant, upsert_qdrant
from src.logging_setup import setup_logging

log = setup_logging(__name__)


def load_documents(path: str | Path) -> list[Document]:
    p = Path(path)
    if p.is_dir():
        docs: list[Document] = []
        for fp in sorted(p.glob("**/*")):
            if fp.suffix.lower() in {".txt", ".md"} and fp.is_file():
                docs.extend(TextLoader(str(fp), encoding="utf-8").load())
        return docs
    return TextLoader(str(p), encoding="utf-8").load()


def chunk_documents(docs: list[Document], chunk_size: int = 500, overlap: int = 80) -> list[Document]:
    splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=overlap)
    return splitter.split_documents(docs)


def index_to_qdrant(chunks: list[Document], collection: str = "sandbox_rag") -> int:
    texts = [c.page_content for c in chunks]
    emb = embed_texts(texts, backend="sentence-transformers")
    payloads = [{"text": t, "source": c.metadata.get("source", "")} for t, c in zip(texts, chunks)]
    ids = [str(i) for i in range(len(texts))]
    upsert_qdrant(collection, ids, emb.vectors, payloads)
    return len(texts)


def index_to_chroma(chunks: list[Document], collection: str = "sandbox_docs") -> int:
    texts = [c.page_content for c in chunks]
    emb = embed_texts(texts, backend="sentence-transformers")
    col = get_chroma_collection(collection)
    ids = [f"doc-{i}" for i in range(len(texts))]
    col.upsert(
        ids=ids,
        documents=texts,
        embeddings=emb.vectors,
        metadatas=[c.metadata for c in chunks],
    )
    return len(texts)


def index_to_pgvector(chunks: list[Document]) -> int:
    texts = [c.page_content for c in chunks]
    emb = embed_texts(texts, backend="sentence-transformers")
    for i, (text, vec, chunk) in enumerate(zip(texts, emb.vectors, chunks)):
        doc_id = f"pg-{i}"
        title = Path(chunk.metadata.get("source", doc_id)).name
        pgvector_upsert(doc_id, title, text, vec, emb.model)
    return len(texts)


def rag_query(question: str, backend: str = "qdrant", collection: str = "sandbox_rag", k: int = 3) -> dict[str, Any]:
    q_emb = embed_texts([question], backend="sentence-transformers").vectors[0]
    contexts: list[str] = []

    if backend == "qdrant":
        hits = search_qdrant(collection, q_emb, limit=k)
        contexts = [h["payload"].get("text", "") for h in hits]
    elif backend == "pgvector":
        hits = pgvector_search(q_emb, limit=k)
        contexts = [h["content"] for h in hits]
    elif backend == "chroma":
        col = get_chroma_collection(collection)
        res = col.query(query_embeddings=[q_emb], n_results=k)
        contexts = res.get("documents", [[]])[0]
    else:
        raise ValueError(f"Unknown backend: {backend}")

    context_block = "\n\n".join(f"[{i+1}] {c}" for i, c in enumerate(contexts) if c)
    prompt = f"Use the context below to answer. If insufficient, say you don't know.\n\nCONTEXT:\n{context_block}\n\nQUESTION: {question}"
    answer = chat(prompt)
    return {
        "answer": answer.text,
        "provider": answer.provider,
        "contexts": contexts,
        "backend": backend,
    }


def rag_llamaindex_demo(question: str, docs_path: str) -> dict[str, Any]:
    """LlamaIndex one-shot index + query demo."""
    from llama_index.core import Settings, VectorStoreIndex, SimpleDirectoryReader
    from llama_index.embeddings.huggingface import HuggingFaceEmbedding
    from llama_index.llms.ollama import Ollama

    s = __import__("src.config", fromlist=["get_settings"]).get_settings()
    Settings.embed_model = HuggingFaceEmbedding(model_name=s.embedding_model_local)
    Settings.llm = Ollama(model=s.llm_model_ollama, base_url=s.ollama_base_url, request_timeout=120.0)
    docs = SimpleDirectoryReader(input_files=[docs_path]).load_data()
    index = VectorStoreIndex.from_documents(docs)
    qe = index.as_query_engine(similarity_top_k=3)
    resp = qe.query(question)
    return {"answer": str(resp), "engine": "llamaindex"}
