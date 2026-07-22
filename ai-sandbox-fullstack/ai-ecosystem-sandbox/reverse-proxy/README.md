# Reverse Proxy (nginx) — Runbook

A single nginx entry point that fronts the whole stack over plain HTTP on one
port. The CSI Nora UI is served at `/`, and every backend service is reached
through a path prefix — so the browser only ever talks to **one origin**, which
also removes all CORS problems.

## ⚠️ Basic requirements (runtime)

This proxy only answers when the Docker stack is up. You need **one** platform:

| Option | What must be running | Then start with |
|--------|----------------------|-----------------|
| **(A) Host Docker** | Docker Desktop / Engine | `scripts/start_proxy.ps1 -Port 9090` or compose up below |
| **(B) Ubuntu VM** | VMware guest powered on (**Bridged**) | `./scripts/start-linux.sh` — see `RUN-ON-UBUNTU.md` |

If **neither** is up, `http://localhost:9090/` fails with **`ERR_CONNECTION_REFUSED`** — expected.

## Responsible AI — key rotation & output guardrails

The Nora bridge (`/sandbox`) is the **guarded inference path**:

- **Output middleware** runs after the LLM and before the client: PII redaction (email / SG NRIC / phone / card), policy-leak blocking, injection-remnant blocking, lightweight toxicity filter. Toggle with `GUARDRAILS_ENABLED=true`.
- **API key rotation** (cloud OpenAI / Anthropic / HF only — **Ollama needs no keys**): put keys in `.env` (never commit). Prefer a pool:
  ```bash
  OPENAI_API_KEYS=sk-primary,sk-secondary
  # or
  OPENAI_API_KEY=sk-primary
  OPENAI_API_KEY_SECONDARY=sk-secondary
  ```
  On HTTP `401` / `403` / `429` the bridge rotates to the next key. Status never returns full keys — only fingerprints + pool sizes:
  ```bash
  curl http://localhost:9090/sandbox/guardrails/status
  ```
- The Angular app prefers `/sandbox/v1/chat/completions` so guardrails apply on the primary Hybrid RAG demo. Direct `/ollama` remains available as a fallback. Browser "Remember keys" stays optional/local-only.

Smoke: `python apps/nora_bridge/smoke_rai.py` (add `--live` against a running stack).

## Routing map

| Path                 | Target (prod)                 | Notes                                    |
|----------------------|-------------------------------|------------------------------------------|
| `/`                  | CSI Nora SPA (static)         | Angular client-side routing (SPA fallback) |
| `/ollama/`           | `ollama:11434`                | OpenAI-compatible LLM API, token streaming |
| `/sandbox/`          | `nora-bridge:8090`            | FastAPI bridge (Responsible AI guardrails + key rotation + device scale + **server-side KB** at `/sandbox/kb/*`) |
| `/sandbox/guardrails/status` | `nora-bridge:8090`     | Guardrails enabled + key-pool sizes (never the keys) |
| `/streamlit/`        | `streamlit:8501`              | Dashboard (baseUrlPath=streamlit)          |
| `/qdrant/`           | `qdrant:6333`                 | Vector DB (debug/direct access)            |
| `/chroma/`           | `chroma:8000`                 | Vector DB (debug/direct access)            |
| `/models/`           | static (SPA dist)             | Self-hosted embedding model (offline dense vectors) |
| `/vendor/`           | static (SPA dist)             | transformers.js + ORT WASM + pdf.js (offline runtime) |
| `/mcp/`              | `mcp:8000`                    | MCP server (FastMCP over SSE; stream at `/mcp/sse`) |
| `/healthz`           | nginx                         | Proxy liveness probe                       |

In **prod** everything is containerized on the `ai-ecosystem-sandbox-net`
network and reached by Docker service name — so a single `docker compose up`
brings up the whole app. In **dev**, nginx instead proxies `/`, `/sandbox/`
and `/streamlit/` to services you run on the host (`ng serve`, uvicorn,
streamlit) via `host.docker.internal`.

## Quick start

### Production (whole app, one command) — recommended

Build the UI once, then bring up the entire stack (infra + Ollama + bridge +
Streamlit + proxy) with a single command:

```powershell
# Windows
.\scripts\start_proxy.ps1                 # builds Nora + starts everything
.\scripts\start_proxy.ps1 -Port 9090      # publish on another port
```

```bash
# Linux / macOS
./scripts/start_proxy.sh
PROXY_HTTP_PORT=9090 ./scripts/start_proxy.sh
```

Or fully manual:

```bash
cd ../csi-nora-v2 && npm run build && cd -
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

Then open **http://localhost/** (or the port you chose). The `/sandbox/` and
`/streamlit/` routes are live immediately — the bridge and dashboard are
containers in the same stack.

### Dev (proxy to `ng serve`, live reload — no build)

```powershell
# Terminal 1: cd csi-nora-v2 && npm start        (ng serve on :4200)
# Terminal 2:
.\scripts\start_proxy.ps1 -Mode dev
```

## LAN / external access (share the demo with other machines)

The proxy binds `0.0.0.0`, so it is reachable from other hosts on your network.
**Only the proxy is LAN-exposed** — Ollama, the bridge and the databases bind to
`127.0.0.1` (loopback) and are reached only through the proxy on the internal
Docker network, so the local LLM is never directly exposed.

1. Find your LAN IP (Windows):
   ```powershell
   ipconfig    # use the IPv4 Address of your active adapter (e.g. Wi-Fi), e.g. 192.168.1.32
   ```
2. Allow the port through Windows Firewall (run once, in an **elevated / Admin** prompt):
   ```powershell
   netsh advfirewall firewall add rule name="CSI Nora Demo (TCP 9090)" dir=in action=allow protocol=TCP localport=9090
   ```
   Remove it after the demo:
   ```powershell
   netsh advfirewall firewall delete rule name="CSI Nora Demo (TCP 9090)"
   ```
3. Share the URL: **http://<LAN-IP>:9090/**  (e.g. `http://192.168.1.32:9090/`).

Verify the binding:
```powershell
docker compose -f docker-compose.yml -f docker-compose.proxy.yml ps
netstat -ano | findstr :9090      # expect 0.0.0.0:9090 ... LISTENING
```

The Angular UI uses relative API paths (`/ollama`, `/sandbox`, `/streamlit`), so
it works over any host/IP with **no rebuild**. nginx uses `server_name _;` so any
`Host` header (IP or hostname) is accepted.

> ⚠️ **Security:** exposing on the LAN lets anyone on the network use the demo and
> the local LLM through the proxy. Only do this on a **trusted** network, and stop
> the stack after the demo (`docker compose ... down`). Keep Ollama/bridge/DBs on
> loopback — do not add LAN port bindings for them.

## Auto-start on reboot / persistent deployment

Make the stack come back automatically after a Windows reboot — no manual steps —
so `http://<LAN-IP>:9090/` is live again on its own.

**How it works (three layers, belt-and-suspenders):**

1. **Docker restart policy** — every service in `docker-compose.yml` /
   `docker-compose.proxy.yml` has `restart: unless-stopped`, so Docker relaunches
   all containers automatically as soon as the engine is up.
2. **Docker Desktop autostart** — enable *Settings → General → "Start Docker
   Desktop when you sign in"* so the engine comes up at logon (the WSL2 backend
   needs a user session — see the tradeoff below).
3. **Scheduled Task fallback** — `scripts/autostart-stack.ps1` runs at logon,
   loops until `docker info` succeeds, then runs the compose `up -d` one-liner as
   a guarantee. It is idempotent and logs to `autostart-stack.log`.

### One-time setup (run ONCE in an elevated / Admin PowerShell)

```powershell
cd <repo>\ai-ecosystem-sandbox
# creates the LAN firewall rule (TCP 9090) + registers the logon Scheduled Task
powershell -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Port 9090
```

Then do the one manual GUI step: **Docker Desktop → Settings → General →
"Start Docker Desktop when you sign in"** (Apply & Restart).

Prefer `schtasks` directly? Equivalent one-liner (Admin shell):

```powershell
schtasks /create /tn "CSI Nora Stack Autostart" /sc onlogon /rl highest /f `
  /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"<repo>\ai-ecosystem-sandbox\scripts\autostart-stack.ps1\" -Port 9090"
```

### Firewall persistence

The inbound firewall rule for TCP 9090 is **permanent** across reboots (it lives in
the Windows Firewall configuration, not in memory). `setup-autostart.ps1` calls
`scripts/enable-lan-firewall.ps1`, which creates the rule only if it's missing.

### Keep the LAN URL constant (recommended)

The app binds `0.0.0.0`, so it follows whatever IP the host receives from DHCP. To
keep `http://192.168.1.32:9090/` stable, set a **DHCP reservation** for this host on
your router (or assign a static IP). This is a network setting and is **not** changed
automatically.

### Headless / no-login tradeoff

Docker Desktop's WSL2 backend needs an **interactive user session**, so the task
triggers **at logon** and the engine starts after you sign in. For a fully headless
boot (no login at all), run the Docker **engine as a Windows service** instead of
Docker Desktop (e.g. `wsl --update` + `dockerd`, or Docker CE inside WSL) — more
setup and not required for the demo. The Scheduled Task + Docker Desktop autostart
is the practical default.

### Verify (no reboot needed)

```powershell
docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" sandbox-proxy   # -> unless-stopped
Get-ScheduledTask -TaskName "CSI Nora Stack Autostart"                  # -> Ready
Get-NetFirewallRule  -DisplayName "CSI Nora Demo (TCP 9090)"            # -> exists / Enabled
```

## Manual commands

```bash
# Prod
cd ../csi-nora-v2 && npm run build && cd -
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d reverse-proxy

# Dev
docker compose -f docker-compose.yml -f docker-compose.proxy.dev.yml up -d reverse-proxy

# Logs / stop
docker compose -f docker-compose.yml -f docker-compose.proxy.yml logs -f reverse-proxy
docker compose -f docker-compose.yml -f docker-compose.proxy.yml down reverse-proxy
```

## Dev mode: host services behind the proxy

In dev mode the proxy expects these on the host (prod runs them as containers):

```powershell
# CSI Nora UI ->  http://localhost/           (live reload)
cd ../csi-nora-v2; npm start

# Nora bridge ->  http://localhost/sandbox/
uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090

# Streamlit   ->  http://localhost/streamlit/
streamlit run dashboard/app_lite.py --server.baseUrlPath=streamlit --server.port 8501
```

The `--server.baseUrlPath=streamlit` flag is required so Streamlit generates its
asset/websocket URLs under `/streamlit/`.

## Offline / air-gapped embeddings (dense vectors with no internet)

The CSI Nora KB embeds documents with `Xenova/all-MiniLM-L6-v2` via
transformers.js. To make this work on an **isolated VM with no internet**, the
model, the onnxruntime-web WASM backend, and pdf.js are **vendored into
`csi-nora-v2/public/`** and therefore ship in the Angular `dist` and are served
by this proxy **same-origin** under `/models/` and `/vendor/`:

- `EmbeddingService` loads **local-first** (`allowLocalModels`, `localModelPath=/models/`,
  `wasmPaths=/vendor/transformers/`, single-threaded WASM) and only falls back to
  the public CDN if the local assets are missing — so the online path still works.
- Uploaded docs then show **`dense + BM25 ✓`** and the RAG panel shows
  **`Model source: self-hosted ✓`**. If assets are absent it shows the amber
  **`BM25 only ⓘ`** tag with a tooltip explaining the offline/CDN cause.

Vendor the assets once (on a machine **with** internet) so they travel with the
bundle (~44 MB total):

```powershell
# Windows
.\scripts\fetch-embedding-model.ps1
```
```bash
# Linux / macOS
./scripts/fetch-embedding-model.sh
```

Then `npm run build` (or the `start_proxy` / `start-linux` launchers) picks them up.
`.onnx`/`.wasm` are committed as binary (see repo `.gitattributes`); the only
remaining online asset is the cosmetic Google Fonts stylesheet.

## Server-side, disk-backed Knowledge Base (persists on the host)

By default the KB is now **disk-backed on the host** via the sandbox's existing
Dockerized stores, so it is effectively unlimited, **shared across every browser
and device** hitting this deployment, and it **survives browser clearing AND
`docker compose down` / reboots**. The browser-side store remains an automatic
**offline fallback** (e.g. the static GitHub Pages demo, or when the bridge is down).

**How it works**

- The Angular app probes `GET /sandbox/kb/health` on startup. If Postgres **and**
  Qdrant are reachable it runs in **server mode** (sidebar shows `🗄️ KB: Server
  (disk)`); otherwise it falls back to **browser mode** (`🌐 KB: Browser`).
- On upload it chunks + embeds each document **client-side** (self-hosted MiniLM,
  384-dim) and POSTs `{chunks + vectors}` to the bridge. Retrieval calls
  `POST /sandbox/kb/query` (dense from Qdrant + sparse from Postgres full-text,
  fused with RRF on the server) — citations look identical to browser mode.

**KB API (bridge, reached via the proxy at `/sandbox/kb`)**

| Method & path                     | Purpose                                             |
|-----------------------------------|-----------------------------------------------------|
| `GET  /sandbox/kb/health`         | store status + `docCount` / `chunkCount` / `vectorCount` |
| `GET  /sandbox/kb/documents`      | list docs (shared registry)                         |
| `POST /sandbox/kb/documents`      | ingest doc: registry + chunk text + dense vectors   |
| `DELETE /sandbox/kb/documents/{id}` | remove doc + its chunks + vectors                 |
| `POST /sandbox/kb/query`          | hybrid retrieve (dense + sparse + RRF, top-K)       |

**Where the data physically lives (named Docker volumes on the host disk)**

| Store    | Container         | Volume                                   | In-container path            | Holds |
|----------|-------------------|------------------------------------------|------------------------------|-------|
| Qdrant   | `sandbox-qdrant`  | `ai-ecosystem-sandbox_qdrant_data`       | `/qdrant/storage`            | dense vectors (collection `csinora_kb`, 384-d cosine) |
| Postgres | `sandbox-postgres`| `ai-ecosystem-sandbox_postgres_data`     | `/var/lib/postgresql/data`   | doc registry + chunk text + full-text (`kb.documents`, `kb.chunks`) |

Find the real host paths:
```bash
docker volume inspect ai-ecosystem-sandbox_qdrant_data ai-ecosystem-sandbox_postgres_data --format '{{.Name}} -> {{.Mountpoint}}'
```
(On Docker Desktop / WSL2 these live inside the Docker VM under
`\\wsl$\docker-desktop-data\...`; on native Linux under `/var/lib/docker/volumes/...`.)

**Inspect / verify**
```bash
curl http://localhost:9090/sandbox/kb/health
docker exec sandbox-postgres psql -U sandbox -d ai_sandbox -c "SELECT count(*) FROM kb.documents; SELECT count(*) FROM kb.chunks;"
curl http://localhost:9090/qdrant/collections/csinora_kb   # points_count
```

**Back it up** (stop-free logical backups):
```bash
docker exec sandbox-postgres pg_dump -U sandbox -d ai_sandbox -n kb > kb_pg_backup.sql
docker run --rm -v ai-ecosystem-sandbox_qdrant_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/qdrant_data_backup.tgz -C /data .
```

**Reset the KB** (wipe all server-side docs/vectors):
```bash
docker exec sandbox-postgres psql -U sandbox -d ai_sandbox -c "TRUNCATE kb.chunks, kb.documents CASCADE;"
curl -X DELETE http://localhost:9090/qdrant/collections/csinora_kb   # recreated automatically on next ingest
```
> A normal `docker compose ... down` keeps the KB. Only `down -v` deletes the
> volumes (and the KB). To force browser-only mode, stop the bridge/DBs — the app
> falls back automatically.

## Notes & troubleshooting

- **Port 80 (and 8080) reserved on Windows**: Docker Desktop / Hyper-V and
  `http.sys` reserve several port ranges. If you see
  `bind: An attempt was made to access a socket in a way forbidden`, pick a free
  port, e.g. `-Port 9090`, and browse `http://localhost:9090/`. Check reserved
  ranges with `netsh interface ipv4 show excludedportrange protocol=tcp`.
  On Linux, the default port 80 works out of the box.
- **`502 Bad Gateway` on `/sandbox/` or `/streamlit/`**: that service container
  isn't up yet (or, in dev, the host process isn't running). Check
  `docker compose ps` — the proxy resolves upstreams lazily, so a down service
  doesn't stop nginx from booting.
- **Blank UI / 404 on refresh**: the SPA fallback (`try_files … /index.html`)
  handles Angular routes; ensure the build produced
  `csi-nora-v2/dist/csi-nora/browser/index.html`.
- **HTTPS later**: add a `listen 443 ssl;` server block and mount certs, or put
  Caddy in front for automatic Let's Encrypt certificates.
