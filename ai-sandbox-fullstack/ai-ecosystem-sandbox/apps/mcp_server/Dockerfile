# CSI Nora MCP server (FastMCP, SSE transport). Build context = sandbox root.
FROM python:3.11-slim-bookworm

WORKDIR /app

COPY apps/mcp_server/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Only the dependency-light tool logic is needed at runtime.
COPY src /app/src
COPY apps /app/apps

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MCP_TRANSPORT=sse \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

EXPOSE 8000

# SSE has no plain health route; a TCP connect is enough to prove it's listening.
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=15s \
    CMD python -c "import socket; socket.create_connection(('127.0.0.1',8000),3).close()" || exit 1

CMD ["python", "apps/mcp_server/server.py"]
