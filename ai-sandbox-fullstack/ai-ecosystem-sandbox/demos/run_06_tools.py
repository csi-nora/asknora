#!/usr/bin/env python3
"""Demo 06: Tool calling — LangChain agent with calculator + web search."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.providers.tools import run_langchain_agent

question = "Calculate (42 * 3) + 7. Then search the web for 'Langfuse LLM observability' and summarize in one sentence."
out = run_langchain_agent(question)
print(out)
