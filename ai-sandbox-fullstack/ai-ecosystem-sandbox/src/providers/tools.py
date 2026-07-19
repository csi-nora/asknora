"""Tool calling: calculator, web search, LangChain agent.

The tool LOGIC lives in ``tool_impls`` (dependency-light) so it can be shared
by both these LangChain ``@tool`` wrappers and the MCP server
(``apps/mcp_server``). These wrappers just expose the same functions to the
LangChain agent.
"""

from __future__ import annotations

from typing import Any

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool

from src.providers import tool_impls
from src.providers.llm_router import _build_chat_model
from src.config import get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)


@tool
def calculator(expression: str) -> str:
    """Evaluate a basic math expression, e.g. (2+3)*4."""
    return tool_impls.calculator(expression)


@tool
def web_search(query: str) -> str:
    """Search DuckDuckGo for recent information."""
    return tool_impls.web_search(query)


@tool
def wikipedia_lookup(topic: str) -> str:
    """Fetch a short Wikipedia summary."""
    return tool_impls.wikipedia_lookup(topic)


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
