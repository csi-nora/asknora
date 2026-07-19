"""CSI Nora MCP server (FastMCP).

Exposes the sandbox's genuine tools — calculator, web_search, wikipedia_lookup —
as Model Context Protocol tools so any MCP client (Cursor, Claude Desktop, custom
clients) can call them. The tool logic is reused verbatim from
``src.providers.tool_impls`` (the same implementations the LangChain agent uses).

Transports (set MCP_TRANSPORT):
  * "stdio"  (default) — for local clients / Cursor (.cursor/mcp.json).
  * "sse"                — HTTP Server-Sent Events, for containerized / networked
                           use (behind the nginx proxy at /mcp/). Honors MCP_HOST
                           (default 0.0.0.0), MCP_PORT (default 8000) and
                           MCP_BASE_PATH (default "/mcp") so the SSE stream and its
                           message-callback endpoint share the proxy prefix and
                           work correctly behind nginx.

Run:
  python apps/mcp_server/server.py                      # stdio
  MCP_TRANSPORT=sse python apps/mcp_server/server.py    # HTTP/SSE on :8000/mcp/sse
"""

from __future__ import annotations

import os
import sys

# Make ``src`` importable no matter how this file is launched (script or -m),
# by adding the sandbox root (…/ai-ecosystem-sandbox) to sys.path.
_SANDBOX_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _SANDBOX_ROOT not in sys.path:
    sys.path.insert(0, _SANDBOX_ROOT)

from mcp.server.fastmcp import FastMCP  # noqa: E402

from src.providers import tool_impls  # noqa: E402

mcp = FastMCP(
    "csi-nora-tools",
    host=os.getenv("MCP_HOST", "0.0.0.0"),
    port=int(os.getenv("MCP_PORT", "8000")),
)


@mcp.tool()
def calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression, e.g. "(2+3)*4"."""
    return tool_impls.calculator(expression)


@mcp.tool()
def web_search(query: str) -> str:
    """Search DuckDuckGo for recent web results (returns the top 3)."""
    return tool_impls.web_search(query)


@mcp.tool()
def wikipedia_lookup(topic: str) -> str:
    """Return a short (3-sentence) English Wikipedia summary for a topic."""
    return tool_impls.wikipedia_lookup(topic)


def _build_sse_app(base_path: str):
    """Prefix-aware SSE ASGI app.

    FastMCP's default SSE app mounts the stream at /sse and the message callback
    at /messages/, and advertises an ABSOLUTE callback path — which breaks when
    served behind a proxy sub-path. Mounting both under ``base_path`` (e.g. /mcp)
    keeps the GET stream and POST callback on the same prefix, so nginx can route
    ``/mcp/`` to this server with no rewrite.
    """
    from mcp.server.sse import SseServerTransport
    from starlette.applications import Starlette
    from starlette.routing import Mount, Route

    base = base_path.rstrip("/")
    sse = SseServerTransport(f"{base}/messages/")
    server = mcp._mcp_server  # low-level Server behind FastMCP

    async def handle_sse(request):
        async with sse.connect_sse(request.scope, request.receive, request._send) as (r, w):
            await server.run(r, w, server.create_initialization_options())

    return Starlette(routes=[
        Route(f"{base}/sse", endpoint=handle_sse),
        Mount(f"{base}/messages/", app=sse.handle_post_message),
    ])


def main() -> None:
    transport = os.getenv("MCP_TRANSPORT", "stdio").lower()
    if transport in ("sse", "http"):
        import uvicorn

        app = _build_sse_app(os.getenv("MCP_BASE_PATH", "/mcp"))
        uvicorn.run(app, host=os.getenv("MCP_HOST", "0.0.0.0"), port=int(os.getenv("MCP_PORT", "8000")))
    else:
        mcp.run()  # stdio


if __name__ == "__main__":
    main()
