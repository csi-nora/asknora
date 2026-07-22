# Deploy checklist — CSI Nora Full Stack

## ⚠️ Basic requirements (runtime)

To serve CSI Nora at **`:9090`** you need **one** of these platforms running:

| Option | What must be running | Then start the stack with |
|--------|----------------------|---------------------------|
| **(A) Host Docker** | Docker Desktop / Engine on this machine | `RUN-ASKNORA.bat` or §2 / §7 compose up below |
| **(B) Ubuntu VM** | VMware Ubuntu guest powered on (**Bridged**) | `./scripts/start-linux.sh` — see [RUN-ON-UBUNTU.md](RUN-ON-UBUNTU.md) |

If **neither** is up, `http://localhost:9090/` (and the LAN URL) will fail with **`ERR_CONNECTION_REFUSED`** — that is expected.

**Quick recovery:** start Docker Desktop → `RUN-ASKNORA.bat` / compose up; **or** power on the Ubuntu VM → `./scripts/start-linux.sh`.

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

## 6B. LAN / external access (share the demo)

The proxy binds `0.0.0.0`, so other machines on your network can reach the demo.
**Only the proxy is LAN-exposed**; Ollama, the bridge and the DBs bind to
`127.0.0.1` and are reached only through the proxy on the Docker network.

```powershell
# 1) Find your LAN IPv4 (active adapter, e.g. Wi-Fi)
ipconfig                      # e.g. 192.168.1.32

# 2) Allow the port through Windows Firewall (elevated / Admin prompt, once)
netsh advfirewall firewall add rule name="CSI Nora Demo (TCP 9090)" dir=in action=allow protocol=TCP localport=9090
#   remove after demo:
#   netsh advfirewall firewall delete rule name="CSI Nora Demo (TCP 9090)"

# 3) Confirm binding
docker compose -f docker-compose.yml -f docker-compose.proxy.yml ps
netstat -ano | findstr :9090    # expect 0.0.0.0:9090 ... LISTENING
```

Share: **http://<LAN-IP>:9090/** (e.g. `http://192.168.1.32:9090/`). The UI uses
relative API paths, so no rebuild is needed for IP access.

> ⚠️ Security: exposing on the LAN lets anyone on the network use the demo and the
> local LLM via the proxy. Use only on a **trusted** network and stop the stack
> after the demo (`docker compose ... down`).

## 6C. Auto-start on reboot / persistent deployment

Bring the whole stack back **automatically** after a Windows reboot so
`http://<LAN-IP>:9090/` is live with no manual steps. Three layers:

1. **Docker restart policy** — every service uses `restart: unless-stopped`, so
   Docker relaunches all containers once the engine is up.
2. **Docker Desktop autostart** — enable *Settings → General → "Start Docker
   Desktop when you sign in"*.
3. **Scheduled Task fallback** — `scripts/autostart-stack.ps1` runs at logon, waits
   for `docker info`, then runs the compose `up -d` one-liner (idempotent).

**One-time setup — run ONCE in an elevated / Admin PowerShell:**

```powershell
cd ai-ecosystem-sandbox
# creates the LAN firewall rule (TCP 9090) + registers the logon Scheduled Task
powershell -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Port 9090
```

Then enable **Docker Desktop → Settings → General → "Start Docker Desktop when you
sign in"** (Apply & Restart). To keep the URL constant, set a **DHCP reservation /
static IP** for the host (the app binds `0.0.0.0` and follows the DHCP IP).

> WSL2 tradeoff: Docker Desktop needs an interactive user session, so the task runs
> **at logon**. For a login-free boot, run the Docker engine as a Windows service
> instead (more setup; optional). Details: `ai-ecosystem-sandbox/reverse-proxy/README.md`.

## 7. Verify

| Check | Command / URL |
|-------|----------------|
| Ollama models | `curl http://127.0.0.1:11434/v1/models` |
| Bridge | `curl http://127.0.0.1:8090/healthz` |
| Nora | http://localhost:4200 |
| Reverse proxy | `curl http://localhost/healthz` (or your `-Port`) |
| LAN access | `curl http://<LAN-IP>:9090/healthz` (from another host) |
| Restart policy | `docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" sandbox-proxy` → `unless-stopped` |
| Autostart task | `Get-ScheduledTask -TaskName "CSI Nora Stack Autostart"` → `Ready` |
| Firewall rule | `Get-NetFirewallRule -DisplayName "CSI Nora Demo (TCP 9090)"` |
| Qdrant | `curl http://127.0.0.1:6333/readyz` |
| Server KB | `curl http://localhost:9090/sandbox/kb/health` → `docCount`/`chunkCount`/`vectorCount` |
| Guardrails / key pools | `curl http://localhost:9090/sandbox/guardrails/status` → `enabled` + `pool_size` (no secrets) |

## 7C. Responsible AI — key rotation & output guardrails

The primary Hybrid RAG chat path goes through the **Nora bridge** (`/sandbox/v1/chat/completions`) so **output guardrails** always run after the LLM:

- PII redaction (email, SG NRIC, phone, card-like digits)
- Policy / confidentiality leak blocking
- Prompt-injection remnant blocking
- Lightweight toxicity / unsafe-content filter

Toggle: `GUARDRAILS_ENABLED=true` in `ai-ecosystem-sandbox/.env`.

**Cloud API key rotation** (OpenAI / Anthropic / HF — **Ollama needs no keys**): store keys only in `.env` (never commit). Prefer a rotating pool:

```bash
OPENAI_API_KEYS=sk-primary,sk-secondary
# or OPENAI_API_KEY=… + OPENAI_API_KEY_SECONDARY=…
```

On HTTP `401` / `403` / `429` the bridge rotates to the next key. Fingerprints only:

```bash
curl http://localhost:9090/sandbox/guardrails/status
```

Browser "Remember keys" remains optional/local-only. Smoke: `python apps/nora_bridge/smoke_rai.py [--live]`.

## 7B. Knowledge Base — server-side, disk-backed (default)

KB uploads persist **on the host disk** via Qdrant (dense vectors) + Postgres
(registry + chunk text + full-text), so the KB is effectively unlimited, **shared
across browsers/devices**, and **survives browser clearing, `docker compose down`,
and reboots**. If the bridge/DBs are unreachable (e.g. static GitHub Pages demo),
the app falls back to a **browser-local** KB automatically — the sidebar shows
`🗄️ KB: Server (disk)` vs `🌐 KB: Browser`.

- **Data location:** named volumes `ai-ecosystem-sandbox_qdrant_data`
  (`/qdrant/storage`, collection `csinora_kb`) and `ai-ecosystem-sandbox_postgres_data`
  (`/var/lib/postgresql/data`, tables `kb.documents` / `kb.chunks`). Inspect with
  `docker volume inspect <name> --format '{{.Mountpoint}}'`.
- **Back up:** `docker exec sandbox-postgres pg_dump -U sandbox -d ai_sandbox -n kb > kb.sql`
  and tar the `qdrant_data` volume.
- **Reset:** `docker exec sandbox-postgres psql -U sandbox -d ai_sandbox -c "TRUNCATE kb.chunks, kb.documents CASCADE;"`
  then `curl -X DELETE http://localhost:9090/qdrant/collections/csinora_kb`.
- **Keep the KB across restarts:** use `docker compose ... down` (NOT `down -v`).

Full API + backup/reset details: `ai-ecosystem-sandbox/reverse-proxy/README.md`.

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
