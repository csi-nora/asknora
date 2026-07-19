# CSI Nora MCP Server

A genuine [Model Context Protocol](https://modelcontextprotocol.io) server
(FastMCP) that exposes the sandbox's tools so any MCP client — **Cursor**, Claude
Desktop, or a custom client — can call them:

| MCP tool | What it does |
|----------|--------------|
| `calculator`       | Safe arithmetic eval, e.g. `(2+3)*4` |
| `web_search`       | DuckDuckGo top-3 results |
| `wikipedia_lookup` | 3-sentence English Wikipedia summary |

The tool logic is **shared** with the LangChain agent — both import
`src/providers/tool_impls.py`, so there is a single source of truth.

## Transports

- **stdio** (default) — for local clients / Cursor. No container required.
- **SSE (HTTP)** — for networked clients, served behind the nginx proxy at
  `/mcp/` (stream at `/mcp/sse`). The server is base-path aware
  (`MCP_BASE_PATH=/mcp`) so the SSE stream and its POST callback share the prefix
  and work correctly through the proxy.

## Run it

### Local / Cursor (stdio)

Cursor auto-discovers `.cursor/mcp.json`. Or run directly:

```bash
cd ai-ecosystem-sandbox
pip install -r apps/mcp_server/requirements.txt
python apps/mcp_server/server.py            # stdio
```

`.cursor/mcp.json` (already shipped at the repo/sandbox root):

```json
{ "mcpServers": { "csi-nora-tools": {
  "command": "python",
  "args": ["apps/mcp_server/server.py"],
  "env": { "MCP_TRANSPORT": "stdio" } } } }
```

### Containerized / networked (SSE via proxy)

The `mcp` service is part of the full stack (no host port published — internal to
the sandbox network, reachable only through the proxy):

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
# SSE endpoint (via nginx):  http://localhost:9090/mcp/sse
```

Connect an SSE client to `http://<host>:<PROXY_HTTP_PORT>/mcp/sse`.

## Smoke tests (prove it works)

```bash
cd ai-ecosystem-sandbox
python apps/mcp_server/smoke_test.py       # stdio: lists tools + calls calculator
python apps/mcp_server/smoke_test_sse.py   # SSE: starts server + round-trips a tool call
```

Expected:

```
[smoke] server started; tools advertised: ['calculator', 'web_search', 'wikipedia_lookup']
[smoke] calculator('(2+3)*4') -> 20.0
[smoke] PASS - MCP server responds to tool calls
```

## Security

No host port is published for the MCP container; SSE is reachable only through the
nginx proxy, consistent with the rest of the stack (only the proxy is LAN-exposed).
For local Cursor use, prefer the stdio transport (no network at all).
