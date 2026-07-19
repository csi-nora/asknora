#!/usr/bin/env bash
# ============================================================================
# start-linux.sh — one-command launcher for the CSI Nora full stack on Linux
# Tailored for Ubuntu on VMware Workstation with BRIDGED networking.
#
# Usage:
#   ./scripts/start-linux.sh                 # build UI + start on port 9090
#   PORT=80 ./scripts/start-linux.sh         # publish on port 80 instead
#   SKIP_BUILD=1 ./scripts/start-linux.sh    # use a prebuilt dist (no Node needed)
#   PULL_MODEL=0 ./scripts/start-linux.sh    # skip auto-pulling the demo model
#   MODEL=llama3.2:1b ./scripts/start-linux.sh   # use a smaller/faster model
#
# Because the VM is BRIDGED, it gets its own IP on your physical LAN, so the
# printed http://<VM-IP>:<PORT>/ URL is reachable from any device on the network
# (including the Windows host), independently of the Windows instance.
# ============================================================================
set -euo pipefail

PORT="${PORT:-9090}"
MODEL="${MODEL:-llama3.2:3b}"
PULL_MODEL="${PULL_MODEL:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SANDBOX_DIR"

# ── Pre-flight checks ───────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. Install it with:" >&2
  echo "  curl -fsSL https://get.docker.com | sudo sh" >&2
  echo "  sudo usermod -aG docker \$USER   # then log out and back in" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Cannot reach the Docker daemon." >&2
  echo "  sudo systemctl start docker" >&2
  echo "  sudo usermod -aG docker \$USER   # then log out/in if you just installed Docker" >&2
  exit 1
fi
if [ "${SKIP_BUILD:-0}" != "1" ] && ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node/npm not found (needed to build the Angular UI)." >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
  echo "  ...or copy a prebuilt dist and re-run with:  SKIP_BUILD=1 ./scripts/start-linux.sh" >&2
  exit 1
fi

chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# ── Clear any leftover/orphaned containers from a previous run ───────────────
# Prevents "Bind for 0.0.0.0:<port> failed: port is already allocated" when a
# prior partial start left containers behind.
echo "==> Clearing any previous stack containers (safe if none exist)..."
docker compose -f docker-compose.yml -f docker-compose.proxy.yml down --remove-orphans >/dev/null 2>&1 || true

# ── Start the stack via the existing production launcher ─────────────────────
echo "==> Starting CSI Nora full stack on port ${PORT} (build=${SKIP_BUILD:-0 -> yes}) ..."
SKIP_BUILD="${SKIP_BUILD:-0}" PROXY_HTTP_PORT="$PORT" ./scripts/start_proxy.sh

# ── Pull the demo model on first run ────────────────────────────────────────
if [ "$PULL_MODEL" = "1" ]; then
  echo "==> Ensuring Ollama model '${MODEL}' is present (first run downloads ~2 GB, CPU-only in a VM)..."
  for i in $(seq 1 30); do docker exec sandbox-ollama ollama list >/dev/null 2>&1 && break; sleep 3; done
  docker exec sandbox-ollama ollama pull "$MODEL" \
    || echo "WARN: model pull failed; run it later: docker exec sandbox-ollama ollama pull ${MODEL}"
fi

# ── Detect the Bridged LAN IP and report ────────────────────────────────────
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "${LAN_IP:-}" ] && LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')"

# Best-effort: open the firewall if ufw is active
if command -v ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -q "Status: active"; then
  sudo -n ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
fi

echo ""
echo "======================================================================"
echo " CSI Nora is UP  (VMware Bridged networking)"
echo "   On this VM  : http://localhost:${PORT}/"
if [ -n "${LAN_IP:-}" ]; then
  echo "   On the LAN  : http://${LAN_IP}:${PORT}/     <-- share this URL"
else
  echo "   On the LAN  : http://<run 'hostname -I'>:${PORT}/"
fi
echo "   Health      : http://localhost:${PORT}/healthz"
echo "----------------------------------------------------------------------"
echo " If other devices cannot connect and ufw is active:"
echo "     sudo ufw allow ${PORT}/tcp"
echo " Stop the stack:"
echo "     docker compose -f docker-compose.yml -f docker-compose.proxy.yml down"
echo "======================================================================"
