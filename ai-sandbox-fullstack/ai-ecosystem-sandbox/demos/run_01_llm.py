#!/usr/bin/env python3
"""Demo 01: LLM Layer — OpenAI/Anthropic/Google/Groq + Ollama fallback."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.llm_router import chat, list_available_providers
from src.providers.observability import trace_span

print("=== Available providers ===")
for p in list_available_providers():
    print(p)

prompt = "Summarize the Modern AI Ecosystem in 4 bullet points."
with trace_span("demo01.llm"):
    result = chat(prompt)
print(f"\n[{result.provider}/{result.model}]\n{result.text}")
