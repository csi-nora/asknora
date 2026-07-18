#!/usr/bin/env python3
"""Demo 05: Memory (Redis) + Observability (LangSmith/Langfuse)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.memory import new_session_id, recall, remember
from src.providers.observability import setup_langsmith, trace_span

print("LangSmith enabled:", setup_langsmith())
sid = new_session_id()
with trace_span("demo05.memory", {"session": sid}):
    remember(sid, "user", "Prefer local Ollama models for demos.")
    remember(sid, "assistant", "Acknowledged — using Ollama fallback.")
print("Session:", sid)
print("Recall:", recall(sid))
