# Deploy checklist — CSI Nora Full Stack

## 1. Unpack

```bash
# Windows
Expand-Archive csi-nora-fullstack-*.zip -DestinationPath .
cd csi-nora-fullstack

# Linux / macOS
unzip csi-nora-fullstack-*.zip && cd csi-nora-fullstack
```

## 2. Start AI sandbox (Docker)

```bash
cd ai-ecosystem-sandbox
cp .env.example .env
docker compose up -d
docker compose ps
docker exec sandbox-ollama ollama pull llama3.2:1b
```

### CPU / GPU / NPU

```powershell
# Windows
.\scripts\set_accel.ps1 -Device cpu   # or gpu | npu
```

```bash
# Linux / macOS
bash scripts/set_accel.sh cpu
```

## 3. Python bridge (optional but recommended)

```bash
cd ai-ecosystem-sandbox
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements-smoke.txt fastapi uvicorn
uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090
```

Smoke:

```bash
curl http://127.0.0.1:8090/healthz
```

## 4. Streamlit demo UI (optional)

```bash
cd ai-ecosystem-sandbox
source .venv/bin/activate
streamlit run dashboard/app_lite.py --server.port 8501
# → http://localhost:8501
```

## 5. CSI Nora Angular app

```bash
cd csi-nora-v2
npm install
npm start
# → http://localhost:4200
```

In the UI: provider badge → **Ollama (Sandbox)** → Base URL `/ollama/v1` → Test Connection.

## 6. Reverse proxy — single entry point (recommended prod)

Put the whole app behind one nginx port. `/` serves the built Nora UI; the
APIs are routed by prefix, so there is one origin and no CORS. The bridge and
Streamlit are containerized, so the entire stack starts with one command.

```bash
# Build the UI once
cd csi-nora-v2 && npm run build && cd ..

# Bring up EVERYTHING (infra + Ollama + bridge + Streamlit + nginx)
cd ai-ecosystem-sandbox
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

Windows/Linux helper (builds UI + starts stack):

```powershell
.\scripts\start_proxy.ps1              # add -Port 9090 if 80/8080 are reserved
```

```bash
./scripts/start_proxy.sh               # PROXY_HTTP_PORT=9090 ./scripts/start_proxy.sh
```

Entry points (default port 80, or the port you set):

| URL | Serves |
|-----|--------|
| `http://localhost/` | CSI Nora UI |
| `http://localhost/ollama/` | Ollama LLM API |
| `http://localhost/sandbox/` | Nora bridge (guardrails + device scale) |
| `http://localhost/streamlit/` | Streamlit dashboard |
| `http://localhost/healthz` | proxy health |

> On Windows, ports 80 and 8080 are often reserved (Hyper-V/http.sys). If you
> see a socket bind error, use `-Port 9090`. On Linux, port 80 works directly.

Dev variant (live reload, proxies to `ng serve`; run host services yourself):

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.dev.yml up -d reverse-proxy
```

See `ai-ecosystem-sandbox/reverse-proxy/README.md` for the full routing map.

## 7. Verify

| Check | Command / URL |
|-------|----------------|
| Ollama models | `curl http://127.0.0.1:11434/v1/models` |
| Bridge | `curl http://127.0.0.1:8090/healthz` |
| Nora | http://localhost:4200 |
| Reverse proxy | `curl http://localhost/healthz` (or your `-Port`) |
| Qdrant | `curl http://127.0.0.1:6333/readyz` |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Nora Test Connection fails | Ensure `npm start` uses proxy; Ollama container up |
| Out of memory | `.\scripts\set_accel.ps1 -Device cpu`; use `llama3.2:1b` |
| Port in use | Change ports in `.env` / `angular.json` |
| GPU not used | NVIDIA toolkit + `docker-compose.gpu.yml` |

## GitHub / GitLab push

```bash
cd csi-nora-fullstack
git init
git add .
git commit -m "Initial CSI Nora + AI sandbox deployable bundle"
git branch -M main
git remote add origin <YOUR_REPO_URL>
git push -u origin main
```
