# CSI Nora ↔ Sandbox bridge (FastAPI). Build context = sandbox root.
# Optional Presidio add-on: build with --build-arg INSTALL_PRESIDIO=1
FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY apps/nora_bridge/requirements.txt /app/requirements.txt
COPY apps/nora_bridge/requirements-presidio.txt /app/requirements-presidio.txt
RUN pip install --no-cache-dir -r requirements.txt

# Optional Microsoft Presidio (PII) — toggled at runtime with PRESIDIO_ENABLED.
ARG INSTALL_PRESIDIO=0
RUN if [ "$INSTALL_PRESIDIO" = "1" ]; then \
      pip install --no-cache-dir -r /app/requirements-presidio.txt ; \
    fi

# App code (device routing + guardrails live under src/)
COPY src /app/src
COPY apps /app/apps

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PRESIDIO_ENABLED=false

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=20s \
    CMD curl -fsS http://127.0.0.1:8090/healthz || exit 1

CMD ["uvicorn", "apps.nora_bridge.main:app", "--host", "0.0.0.0", "--port", "8090"]
