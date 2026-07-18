"""Agentic workflows: LangGraph, CrewAI, AutoGen-style demos."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from src.providers.llm_router import _build_chat_model
from src.config import get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)


class AgentState(TypedDict):
    task: str
    research: str
    draft: str
    review: str


def langgraph_research_write_review(task: str) -> dict[str, Any]:
    """Three-node LangGraph: researcher → writer → reviewer."""
    s = get_settings()
    llm = _build_chat_model("ollama" if s.provider_has_key("ollama") else s.provider_chain[0])

    def research(state: AgentState) -> AgentState:
        msg = llm.invoke([
            SystemMessage(content="You are a concise researcher."),
            HumanMessage(content=f"Research key points for: {state['task']}"),
        ])
        return {**state, "research": str(msg.content)}

    def write(state: AgentState) -> AgentState:
        msg = llm.invoke([
            SystemMessage(content="You are a technical writer."),
            HumanMessage(content=f"Task: {state['task']}\nResearch:\n{state['research']}\nWrite a short summary."),
        ])
        return {**state, "draft": str(msg.content)}

    def review(state: AgentState) -> AgentState:
        msg = llm.invoke([
            SystemMessage(content="You are a critical reviewer."),
            HumanMessage(content=f"Review this draft and suggest 2 improvements:\n{state['draft']}"),
        ])
        return {**state, "review": str(msg.content)}

    graph = StateGraph(AgentState)
    graph.add_node("research", research)
    graph.add_node("write", write)
    graph.add_node("review", review)
    graph.add_edge(START, "research")
    graph.add_edge("research", "write")
    graph.add_edge("write", "review")
    graph.add_edge("review", END)
    app = graph.compile()
    result = app.invoke({"task": task, "research": "", "draft": "", "review": ""})
    return {"framework": "langgraph", **result}


def crewai_demo(topic: str) -> dict[str, Any]:
    """CrewAI two-agent collaboration (researcher + writer)."""
    try:
        from crewai import Agent, Crew, Process, Task
    except ImportError as exc:
        return {"framework": "crewai", "error": str(exc)}

    s = get_settings()
    model = s.llm_model_ollama

    researcher = Agent(
        role="Research Analyst",
        goal=f"Find key facts about {topic}",
        backstory="Expert at summarizing AI ecosystem trends.",
        verbose=False,
        allow_delegation=False,
        llm=f"ollama/{model}",
    )
    writer = Agent(
        role="Technical Writer",
        goal="Produce a clear 150-word briefing",
        backstory="Writes for engineering leaders.",
        verbose=False,
        allow_delegation=False,
        llm=f"ollama/{model}",
    )
    t1 = Task(description=f"List 5 bullet facts about {topic}", expected_output="5 bullet points", agent=researcher)
    t2 = Task(description="Turn the research into a briefing", expected_output="150-word briefing", agent=writer)
    crew = Crew(agents=[researcher, writer], tasks=[t1, t2], process=Process.sequential, verbose=False)
    output = crew.kickoff()
    return {"framework": "crewai", "output": str(output)}


def autogen_demo(question: str) -> dict[str, Any]:
    """Lightweight AutoGen-style two-agent chat using pyautogen if configured."""
    try:
        from autogen import AssistantAgent, UserProxyAgent
    except ImportError as exc:
        return {"framework": "autogen", "error": str(exc)}

    s = get_settings()
    config_list = [{"model": s.llm_model_ollama, "base_url": s.ollama_base_url, "api_key": "ollama"}]
    assistant = AssistantAgent("assistant", llm_config={"config_list": config_list})
    user = UserProxyAgent("user", human_input_mode="NEVER", max_consecutive_auto_reply=1, code_execution_config=False)
    user.initiate_chat(assistant, message=question, max_turns=2)
    messages = user.chat_messages.get(assistant, [])
    return {"framework": "autogen", "messages": [m.get("content", "") for m in messages[-3:]]}
