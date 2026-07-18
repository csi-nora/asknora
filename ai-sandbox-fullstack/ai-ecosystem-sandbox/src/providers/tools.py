"""Tool calling: calculator, web search, LangChain agent."""

from __future__ import annotations

import ast
import operator
from typing import Any

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool

from src.providers.llm_router import _build_chat_model
from src.config import get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}


def _safe_eval(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _safe_eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_safe_eval(node.operand)
    raise ValueError("Unsupported expression")


@tool
def calculator(expression: str) -> str:
    """Evaluate a basic math expression, e.g. (2+3)*4."""
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        return str(_safe_eval(tree))
    except Exception as exc:
        return f"Error: {exc}"


@tool
def web_search(query: str) -> str:
    """Search DuckDuckGo for recent information."""
    try:
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
        if not results:
            return "No results found."
        return "\n".join(f"- {r.get('title','')}: {r.get('body','')}" for r in results)
    except Exception as exc:
        return f"Search unavailable: {exc}"


@tool
def wikipedia_lookup(topic: str) -> str:
    """Fetch a short Wikipedia summary."""
    try:
        import wikipedia

        wikipedia.set_lang("en")
        return wikipedia.summary(topic, sentences=3)
    except Exception as exc:
        return f"Wikipedia error: {exc}"


def run_langchain_agent(question: str) -> dict[str, Any]:
    s = get_settings()
    provider = "ollama" if s.provider_has_key("ollama") else s.provider_chain[0]
    llm = _build_chat_model(provider)
    tools = [calculator, web_search, wikipedia_lookup]
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a helpful agent. Use tools when needed. Be concise."),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])
    agent = create_tool_calling_agent(llm, tools, prompt)
    executor = AgentExecutor(agent=agent, tools=tools, verbose=False, handle_parsing_errors=True)
    result = executor.invoke({"input": question})
    return {"framework": "langchain-agent", "output": result.get("output", ""), "provider": provider}
