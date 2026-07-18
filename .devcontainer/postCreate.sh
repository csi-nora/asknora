#!/usr/bin/env bash
# One-shot setup for the CSI Nora AI Sandbox demo in GitHub Codespaces.
# Builds the Angular UI, brings up the full Docker stack behind the reverse
# proxy, and pulls a small local model — so the demo is ready on port 9090.
set -euo pipefail

BUNDLE="ai-sandbox-fullstack"
UI="$BUNDLE/csi-nora-v2"
SANDBOX="$BUNDLE/ai-ecosystem-sandbox"
export PROXY_HTTP_PORT="${PROXY_HTTP_PORT:-9090}"

echo "==> [1/4] Building CSI Nora UI (Angular production)"
pushd "$UI" >/dev/null
npm ci || npm install
npm run build
popd >/dev/null

echo "==> [2/4] Preparing sandbox environment"
pushd "$SANDBOX" >/dev/null
[ -f .env ] || cp .env.example .env

echo "==> [3/4] Starting full stack (proxy on :$PROXY_HTTP_PORT)"
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build

echo "==> [4/4] Pulling demo models — llama3.2:3b (default, ~2 GB) + llama3.2:1b (fast option)"
# Wait for Ollama to accept connections, then pull. Tolerate slow first boot.
for i in $(seq 1 30); do
  if docker exec sandbox-ollama ollama list >/dev/null 2>&1; then break; fi
  sleep 3
done
# 3b is the UI default (matches the README demo) — better instruction-following.
docker exec sandbox-ollama ollama pull llama3.2:3b || echo "WARN: 3b pull failed; run it manually later."
# 1b is an optional faster fallback selectable from the API config modal.
docker exec sandbox-ollama ollama pull llama3.2:1b || echo "WARN: 1b pull failed (optional fast model)."
popd >/dev/null

cat <<'EOF'

============================================================
 CSI Nora AI Sandbox is ready.
 Open the forwarded port 9090 (PORTS tab -> globe icon) for:
   /            CSI Nora UI
   /ollama/     Ollama LLM API
   /sandbox/    Nora bridge (guardrails + device scale)
   /streamlit/  Streamlit dashboard
   /healthz     proxy health
============================================================
EOF
