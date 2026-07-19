"""MCP SSE (HTTP) smoke test — starts the server over SSE and calls a tool.

Proves the HTTP transport works with the proxy-friendly base path (/mcp), i.e.
the SSE stream and its message callback share the prefix. Exit code 0 on success.

Run from the sandbox root:
    python apps/mcp_server/smoke_test_sse.py
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time

_SANDBOX_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PORT = int(os.getenv("SMOKE_PORT", "8765"))
BASE = "/mcp"
URL = f"http://127.0.0.1:{PORT}{BASE}/sse"


async def _client() -> int:
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    async with sse_client(URL) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = sorted(t.name for t in (await session.list_tools()).tools)
            print(f"[sse] connected {URL}; tools: {tools}")
            res = await session.call_tool("calculator", {"expression": "7*6"})
            text = res.content[0].text if res.content else ""
            print(f"[sse] calculator('7*6') -> {text}")
            assert text.strip() in ("42.0", "42"), text
    print("[sse] PASS - MCP SSE transport responds to tool calls")
    return 0


def main() -> int:
    env = {**os.environ, "MCP_TRANSPORT": "sse", "MCP_PORT": str(PORT), "MCP_BASE_PATH": BASE}
    proc = subprocess.Popen(
        [sys.executable, os.path.join(_SANDBOX_ROOT, "apps", "mcp_server", "server.py")],
        env=env,
    )
    try:
        time.sleep(4)  # let uvicorn bind
        return asyncio.run(_client())
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(main())
