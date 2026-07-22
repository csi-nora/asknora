#!/usr/bin/env bash
# Start the nginx reverse proxy in front of the CSI Nora + AI sandbox stack.
#
# By DEFAULT the proxy binds 0.0.0.0:9090 so it is reachable from other hosts
# on the LAN (http://<LAN-IP>:9090/). Override with PROXY_BIND_HOST / PROXY_HTTP_PORT.
#
# Usage:
#   ./scripts/start_proxy.sh                 # prod: build + serve on 0.0.0.0:9090
#   PROXY_HTTP_PORT=8080 ./scripts/start_proxy.sh
#   PROXY_BIND_HOST=127.0.0.1 ./scripts/start_proxy.sh   # localhost only
#   MODE=dev ./scripts/start_proxy.sh        # dev: proxy to ng serve :4200
#   SKIP_BUILD=1 ./scripts/start_proxy.sh    # prod without rebuilding the SPA
set -euo pipefail

MODE="${MODE:-prod}"
export PROXY_HTTP_PORT="${PROXY_HTTP_PORT:-9090}"
export PROXY_BIND_HOST="${PROXY_BIND_HOST:-0.0.0.0}"

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
    echo "Starting full stack (prod: bind ${PROXY_BIND_HOST}:${PROXY_HTTP_PORT})..."
    docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build --remove-orphans
else
    echo "Starting reverse proxy (dev, proxies to ng serve :4200)..."
    echo "Make sure 'npm start' is running in csi-nora-v2."
    docker compose -f docker-compose.yml -f docker-compose.proxy.dev.yml up -d reverse-proxy
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${LAN_IP:-}" ] && LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"

echo ""
echo "Reverse proxy is up (LAN bind ${PROXY_BIND_HOST}:${PROXY_HTTP_PORT}):"
echo "  Local     : http://localhost:${PROXY_HTTP_PORT}/"
if [ -n "${LAN_IP:-}" ]; then
  echo "  LAN       : http://${LAN_IP}:${PROXY_HTTP_PORT}/     <-- share this URL"
else
  echo "  LAN       : http://<your-LAN-IP>:${PROXY_HTTP_PORT}/"
fi
echo "  Ollama    : http://localhost:${PROXY_HTTP_PORT}/ollama/"
echo "  Bridge    : http://localhost:${PROXY_HTTP_PORT}/sandbox/"
echo "  Streamlit : http://localhost:${PROXY_HTTP_PORT}/streamlit/"
echo "  Health    : http://localhost:${PROXY_HTTP_PORT}/healthz"
