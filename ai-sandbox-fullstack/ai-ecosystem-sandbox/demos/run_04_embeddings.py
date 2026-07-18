#!/usr/bin/env python3
"""Demo 04: Embedding comparison — OpenAI vs ST vs BGE."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.embeddings import cosine_similarity, embed_texts

texts = [
    "Retrieval augmented generation with vector search",
    "RAG using embeddings and a vector database",
    "Unrelated topic: baking sourdough bread",
]
for backend in ["sentence-transformers", "bge"]:
    res = embed_texts(texts, backend=backend)  # type: ignore[arg-type]
    sim01 = cosine_similarity(res.vectors[0], res.vectors[1])
    sim02 = cosine_similarity(res.vectors[0], res.vectors[2])
    print(f"\n{backend} ({res.model}, dim={res.dimensions})")
    print(f"  similar pair: {sim01:.4f}")
    print(f"  dissimilar pair: {sim02:.4f}")
