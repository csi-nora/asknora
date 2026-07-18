#!/usr/bin/env bash
set -euo pipefail
OLLAMA="${OLLAMA_BASE_URL:-http://localhost:11434}"
MODELS=(llama3.1:8b mistral:7b nomic-embed-text)

for m in "${MODELS[@]}"; do
  echo "Pulling $m ..."
  curl -sf "$OLLAMA/api/pull" -d "{\"name\":\"$m\"}" || docker exec sandbox-ollama ollama pull "$m"
done
echo "Ollama models ready."
