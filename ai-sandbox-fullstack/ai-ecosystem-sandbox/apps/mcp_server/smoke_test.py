"""MCP smoke test — spawns the server over stdio and calls a tool.

Proves the MCP server starts, advertises its tools, and returns a real result
for a tool invocation (calculator). Exit code 0 on success.

Run from the sandbox root:
    python apps/mcp_server/smoke_test.py
"""

from __future__ import annotations

import asyncio
import os
import sys

_SANDBOX_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _SANDBOX_ROOT not in sys.path:
    sys.path.insert(0, _SANDBOX_ROOT)

from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402


async def _run() -> int:
    params = StdioServerParameters(
        command=sys.executable,
        args=[os.path.join(_SANDBOX_ROOT, "apps", "mcp_server", "server.py")],
        env={**os.environ, "MCP_TRANSPORT": "stdio"},
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = (await session.list_tools()).tools
            names = sorted(t.name for t in tools)
            print(f"[smoke] server started; tools advertised: {names}")
            assert {"calculator", "web_search", "wikipedia_lookup"} <= set(names), names

            res = await session.call_tool("calculator", {"expression": "(2+3)*4"})
            text = res.content[0].text if res.content else ""
            print(f"[smoke] calculator('(2+3)*4') -> {text}")
            assert text.strip() in ("20.0", "20"), text

    print("[smoke] PASS - MCP server responds to tool calls")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_run()))
