"""Pure tool implementations (NO LangChain / LLM dependencies).

These are the single source of truth for the tool logic, shared by:
  * the LangChain ``@tool`` wrappers in ``tools.py`` (for the agent), and
  * the MCP server in ``apps/mcp_server`` (for Cursor / MCP clients).

Keeping them dependency-light means the MCP server can import them without
pulling in langchain or the LLM router.
"""

from __future__ import annotations

import ast
import operator

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


def calculator(expression: str) -> str:
    """Evaluate a basic math expression, e.g. (2+3)*4."""
    try:
        tree = ast.parse(expression.strip(), mode="eval")
        return str(_safe_eval(tree))
    except Exception as exc:  # noqa: BLE001 - surface a friendly message
        return f"Error: {exc}"


def web_search(query: str) -> str:
    """Search DuckDuckGo for recent information."""
    try:
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=3))
        if not results:
            return "No results found."
        return "\n".join(f"- {r.get('title','')}: {r.get('body','')}" for r in results)
    except Exception as exc:  # noqa: BLE001
        return f"Search unavailable: {exc}"


def wikipedia_lookup(topic: str) -> str:
    """Fetch a short Wikipedia summary."""
    try:
        import wikipedia

        wikipedia.set_lang("en")
        return wikipedia.summary(topic, sentences=3)
    except Exception as exc:  # noqa: BLE001
        return f"Wikipedia error: {exc}"
