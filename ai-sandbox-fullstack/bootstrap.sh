#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "==> Docker sandbox"
cd ai-ecosystem-sandbox
[[ -f .env ]] || cp .env.example .env
docker compose up -d
docker exec sandbox-ollama ollama pull llama3.2:1b
python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements-smoke.txt fastapi uvicorn streamlit
uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090 &
streamlit run dashboard/app_lite.py --server.port 8501 --server.headless true &
cd ../csi-nora-v2
[[ -d node_modules ]] || npm install
npm start
