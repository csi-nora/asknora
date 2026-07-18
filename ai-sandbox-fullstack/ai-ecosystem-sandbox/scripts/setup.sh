#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Creating Python 3.11 venv"
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example — add API keys as needed."
fi

echo "==> Starting Docker Compose stack"
docker compose up -d

echo "==> Pulling Ollama models (may take a while)"
bash scripts/pull_ollama_models.sh

echo ""
echo "Ready!"
echo "  Jupyter:   http://localhost:8888  (token: sandbox)"
echo "  Streamlit: docker compose --profile dashboard up -d  then http://localhost:8501"
echo "  Tests:     pytest tests/ -q"
