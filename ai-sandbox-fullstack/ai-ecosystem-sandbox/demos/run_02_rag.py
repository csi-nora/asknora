#!/usr/bin/env python3
"""Demo 02: RAG pipeline — load → chunk → embed → Qdrant → query."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.rag import chunk_documents, index_to_qdrant, load_documents, rag_query

ROOT = Path(__file__).resolve().parents[1]
docs = load_documents(ROOT / "data" / "sample_docs")
chunks = chunk_documents(docs)
n = index_to_qdrant(chunks)
print(f"Indexed {n} chunks")

q = "What is Hybrid RAG and which local LLM endpoint is used?"
out = rag_query(q, backend="qdrant")
print("Answer:", out["answer"])
print("Contexts:", len(out["contexts"]))
