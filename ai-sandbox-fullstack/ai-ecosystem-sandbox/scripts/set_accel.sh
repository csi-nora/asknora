#!/usr/bin/env bash
set -euo pipefail
DEVICE="${1:-cpu}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

case "$DEVICE" in
  cpu|gpu|npu|auto) ;;
  *) echo "Usage: $0 {cpu|gpu|npu|auto}"; exit 1 ;;
esac

OVERLAY="docker-compose.cpu.yml"
NUM_GPU=0
OV_DEVICE=CPU
case "$DEVICE" in
  gpu) OVERLAY="docker-compose.gpu.yml"; NUM_GPU=-1; OV_DEVICE=GPU ;;
  npu) OVERLAY="docker-compose.npu.yml"; NUM_GPU=0; OV_DEVICE=NPU ;;
  auto) OVERLAY="docker-compose.cpu.yml" ;;
esac

[[ -f .env ]] || cp .env.example .env

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    sed -i.bak "s|^${k}=.*|${k}=${v}|" .env && rm -f .env.bak
  else
    echo "${k}=${v}" >> .env
  fi
}

set_kv ACCEL_DEVICE "$DEVICE"
set_kv OLLAMA_NUM_GPU "$NUM_GPU"
set_kv OPENVINO_DEVICE "$OV_DEVICE"

echo "==> Recreating Ollama with ACCEL_DEVICE=$DEVICE ($OVERLAY)"
docker compose -f docker-compose.yml -f "$OVERLAY" up -d ollama

echo "Done. Probe with: python -c \"from src.providers.device import status_report; print(status_report('$DEVICE'))\""
