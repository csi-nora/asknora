# Reverse Proxy (nginx) — Runbook

A single nginx entry point that fronts the whole stack over plain HTTP on one
port. The CSI Nora UI is served at `/`, and every backend service is reached
through a path prefix — so the browser only ever talks to **one origin**, which
also removes all CORS problems.

## Routing map

| Path                 | Target (prod)                 | Notes                                    |
|----------------------|-------------------------------|------------------------------------------|
| `/`                  | CSI Nora SPA (static)         | Angular client-side routing (SPA fallback) |
| `/ollama/`           | `ollama:11434`                | OpenAI-compatible LLM API, token streaming |
| `/sandbox/`          | `nora-bridge:8090`            | FastAPI bridge (guardrails + device scale) |
| `/streamlit/`        | `streamlit:8501`              | Dashboard (baseUrlPath=streamlit)          |
| `/qdrant/`           | `qdrant:6333`                 | Vector DB (debug/direct access)            |
| `/chroma/`           | `chroma:8000`                 | Vector DB (debug/direct access)            |
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
