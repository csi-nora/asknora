#!/usr/bin/env python3
"""Demo 03: Agentic workflow — LangGraph research → write → review."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.agents import crewai_demo, langgraph_research_write_review

topic = "Vector databases for production RAG"
print("=== LangGraph ===")
print(langgraph_research_write_review(topic))
print("\n=== CrewAI ===")
print(crewai_demo(topic))
