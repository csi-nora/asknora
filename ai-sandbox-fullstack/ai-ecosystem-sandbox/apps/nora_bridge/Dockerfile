# CSI Nora ↔ Sandbox bridge (FastAPI). Build context = sandbox root.
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY apps/nora_bridge/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# App code (device routing + guardrails live under src/)
COPY src /app/src
COPY apps /app/apps

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
    CMD curl -fsS http://127.0.0.1:8090/healthz || exit 1

CMD ["uvicorn", "apps.nora_bridge.main:app", "--host", "0.0.0.0", "--port", "8090"]
