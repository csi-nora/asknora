#!/usr/bin/env bash
# ============================================================================
#  run-asknora.sh  -  One-shot bootstrap for the CSI Nora full stack (Ubuntu)
#
#  Wraps the standard quickstart into a single runnable file:
#      git clone https://github.com/csi-nora/asknora.git
#      cd asknora/ai-sandbox-fullstack/ai-ecosystem-sandbox
#      chmod +x scripts/*.sh
#      ./scripts/start-linux.sh
#
#  Tailored for Ubuntu on VMware Workstation (Bridged networking).
#
#  Usage:
#      chmod +x run-asknora.sh
#      ./run-asknora.sh                 # clone (if needed) + build + start on 9090
#      PORT=80 ./run-asknora.sh         # publish on port 80
#      SKIP_BUILD=1 ./run-asknora.sh    # use a prebuilt dist (no Node needed)
# ============================================================================
set -euo pipefail

REPO_URL="https://github.com/csi-nora/asknora.git"
CLONE_DIR="${CLONE_DIR:-asknora}"
PORT="${PORT:-9090}"

# If we're already inside the sandbox (file shipped in the bundle), just launch.
if [ -f "scripts/start-linux.sh" ] && [ -f "docker-compose.yml" ]; then
  SANDBOX_DIR="$(pwd)"
elif [ -d "ai-sandbox-fullstack/ai-ecosystem-sandbox" ]; then
  SANDBOX_DIR="ai-sandbox-fullstack/ai-ecosystem-sandbox"
elif [ -d "csi-nora-fullstack/ai-ecosystem-sandbox" ]; then
  SANDBOX_DIR="csi-nora-fullstack/ai-ecosystem-sandbox"
else
  # Fresh machine: clone from GitHub.
  if ! command -v git >/dev/null 2>&1; then
    echo "ERROR: git is not installed.  sudo apt-get update && sudo apt-get install -y git" >&2
    exit 1
  fi
  if [ ! -d "$CLONE_DIR" ]; then
    echo "==> Cloning $REPO_URL ..."
    git clone "$REPO_URL" "$CLONE_DIR"
  else
    echo "==> Reusing existing clone: $CLONE_DIR (git pull)"
    git -C "$CLONE_DIR" pull --ff-only || true
  fi
  SANDBOX_DIR="$CLONE_DIR/ai-sandbox-fullstack/ai-ecosystem-sandbox"
fi

cd "$SANDBOX_DIR"
echo "==> Sandbox: $(pwd)"
chmod +x scripts/*.sh 2>/dev/null || true

PORT="$PORT" ./scripts/start-linux.sh
