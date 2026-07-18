#!/usr/bin/env bash
# Start the nginx reverse proxy in front of the CSI Nora + AI sandbox stack.
#
# Usage:
#   ./scripts/start_proxy.sh                 # prod: build + serve on http://localhost
#   PROXY_HTTP_PORT=8080 ./scripts/start_proxy.sh
#   MODE=dev ./scripts/start_proxy.sh        # dev: proxy to ng serve :4200
#   SKIP_BUILD=1 ./scripts/start_proxy.sh    # prod without rebuilding the SPA
set -euo pipefail

MODE="${MODE:-prod}"
export PROXY_HTTP_PORT="${PROXY_HTTP_PORT:-80}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(dirname "$SCRIPT_DIR")"
NORA_DIR="$(dirname "$SANDBOX_DIR")/csi-nora-v2"

cd "$SANDBOX_DIR"

if [ "$MODE" = "prod" ]; then
    if [ "${SKIP_BUILD:-0}" != "1" ]; then
        echo "Building CSI Nora UI (production)..."
        ( cd "$NORA_DIR" && { [ -d node_modules ] || npm install; } && npm run build )
    fi
    DIST="$NORA_DIR/dist/csi-nora/browser"
    if [ ! -f "$DIST/index.html" ]; then
        echo "ERROR: Built SPA not found at $DIST" >&2
        exit 1
    fi
    echo "Starting full stack (prod: infra + bridge + streamlit + proxy)..."
    docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
else
    echo "Starting reverse proxy (dev, proxies to ng serve :4200)..."
    echo "Make sure 'npm start' is running in csi-nora-v2."
    docker compose -f docker-compose.yml -f docker-compose.proxy.dev.yml up -d reverse-proxy
fi

echo ""
echo "Reverse proxy is up:"
echo "  UI        : http://localhost:${PROXY_HTTP_PORT}/"
echo "  Ollama    : http://localhost:${PROXY_HTTP_PORT}/ollama/"
echo "  Bridge    : http://localhost:${PROXY_HTTP_PORT}/sandbox/"
echo "  Streamlit : http://localhost:${PROXY_HTTP_PORT}/streamlit/"
echo "  Health    : http://localhost:${PROXY_HTTP_PORT}/healthz"
