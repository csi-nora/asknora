# CSI Nora + AI Ecosystem Sandbox — Deployable Bundle

Version: **1.0.0** · Ready for any Windows / Linux / macOS host with Docker + Node 18+ + Python 3.11+

## What's included

```
csi-nora-fullstack/
├── README.md                          ← this file
├── DEPLOY.md                          ← step-by-step deploy
├── .gitignore
├── csi-nora-v2/                       ← Angular 17 CSI Nora UI
├── ai-ecosystem-sandbox/              ← Docker Compose AI stack + demos
└── docs/                              ← runbooks + integration guide
```

## Prerequisites

| Tool | Version |
|------|---------|
| Docker Desktop / Compose | 24+ |
| Node.js | 18+ (20 LTS recommended) |
| Python | 3.11+ |
| RAM | 8 GB+ (16 GB recommended) |
| Optional GPU | NVIDIA + Container Toolkit |

## Quick start (5 minutes)

```bash
# 1) Infra
cd ai-ecosystem-sandbox
cp .env.example .env
docker compose up -d
docker exec sandbox-ollama ollama pull llama3.2:1b

# 2) Optional bridge (guardrails + device scale API)
python -m venv .venv
# Windows: .\.venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements-smoke.txt fastapi uvicorn
uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090

# 3) CSI Nora UI
cd ../csi-nora-v2
npm install
npm start
# → http://localhost:4200  (provider: Ollama → /ollama/v1)
```

## Ports

| Port | Service |
|------|---------|
| 4200 | CSI Nora (Angular) |
| 8501 | Streamlit sandbox UI |
| 8090 | Nora bridge API |
| 11434 | Ollama |
| 6333 | Qdrant |
| 8000 | Chroma |
| 6379 | Redis |
| 5432 | Postgres + pgvector |

## Docs

- [DEPLOY.md](DEPLOY.md) — full deploy checklist
- [docs/CSI-Nora-Sandbox-Integration.md](docs/CSI-Nora-Sandbox-Integration.md)
- [ai-ecosystem-sandbox/README.md](ai-ecosystem-sandbox/README.md)

## License / use

Internal lab / demo bundle. Do not load real NRIC/PHI without PDPA controls.
