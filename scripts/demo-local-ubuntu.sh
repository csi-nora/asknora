#!/usr/bin/env bash
# CSI Nora — local Ubuntu laptop demo (single command)
#
# Serves the pre-built SPA + LLM gateway on http://localhost:8080
# No AWS, no tunnel — runs entirely on your machine.
#
# Usage:
#   npm run demo
#   ./scripts/demo-local-ubuntu.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${CSI_NORA_DEMO_PORT:-8080}"
BROWSER_DIST="$ROOT/dist/csi-nora/browser"
ENV_FILE="$ROOT/server/.env"

echo "=== CSI Nora — local Ubuntu demo ==="
echo "Project: $ROOT"
echo ""

# Node.js check
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js not found. Install Node 18 or 20 LTS:"
  echo "  https://nodejs.org/   or   sudo apt install nodejs npm"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "ERROR: Node.js 18+ required (found $(node -v))"
  exit 1
fi
echo "Node: $(node -v)  npm: $(npm -v)"

# Dependencies
if [[ ! -d node_modules ]]; then
  echo ""
  echo "Installing dependencies (first run)…"
  npm install
else
  echo "Dependencies: node_modules present"
fi

# Env file
if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  echo "Creating server/.env from template…"
  cp server/.env.example "$ENV_FILE"
fi

# Ensure production server port (production.cjs defaults to 8080; gateway uses 3456)
if ! grep -q '^PORT=' "$ENV_FILE" 2>/dev/null; then
  echo "PORT=$PORT" >> "$ENV_FILE"
elif grep -q '^PORT=3456' "$ENV_FILE"; then
  sed -i "s/^PORT=3456/PORT=$PORT/" "$ENV_FILE"
fi

# Pre-built SPA required for demo without full Angular build
if [[ ! -f "$BROWSER_DIST/index.html" ]]; then
  echo ""
  echo "ERROR: Missing $BROWSER_DIST/index.html"
  echo "This repo includes a pre-built dist/. If missing, run from full source:"
  echo "  npm run build"
  exit 1
fi

# Port check
if command -v ss >/dev/null 2>&1 && ss -tln | grep -q ":${PORT} "; then
  echo ""
  echo "WARNING: Port $PORT is already in use."
  echo "Stop the other process or set CSI_NORA_DEMO_PORT=8081 npm run demo"
  exit 1
fi

echo ""
echo "────────────────────────────────────────────"
echo "  Open in Firefox on THIS laptop:"
echo "    http://localhost:${PORT}/"
echo "    http://localhost:${PORT}/ask-nora"
echo "    http://localhost:${PORT}/aichatops"
echo ""
echo "  API health: http://localhost:${PORT}/api/health"
echo ""
echo "  Optional: add LLM keys in server/.env then restart."
echo "  Stop: Ctrl+C"
echo "────────────────────────────────────────────"
echo ""

export PORT
exec node server/production.cjs
