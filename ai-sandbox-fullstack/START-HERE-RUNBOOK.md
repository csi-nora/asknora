# CSI Nora Full Stack — USB Deploy Runbook

| Field | Value |
|-------|-------|
| **Bundle** | `csi-nora-fullstack` |
| **Media** | USB drive (this folder) |
| **Audience** | Engineer / demo facilitator |
| **Time to first chat** | ~10–20 min (first pull of Docker images + model) |

---

## ⚠️ Basic requirements (runtime)

To serve CSI Nora at **`:9090`** you need **one** of these platforms running:

| Option | What must be running | Then start the stack with |
|--------|----------------------|---------------------------|
| **(A) Host Docker** | Docker Desktop / Engine on this PC | `RUN-ASKNORA.bat` or `bootstrap.ps1` / compose up (see §2) |
| **(B) Ubuntu VM** | VMware Ubuntu guest powered on (**Bridged**) | `./scripts/start-linux.sh` — see [RUN-ON-UBUNTU.md](RUN-ON-UBUNTU.md) |

If **neither** is up, `http://localhost:9090/` (and the LAN URL) will fail with **`ERR_CONNECTION_REFUSED`** — that is expected.

**Quick recovery:** start Docker Desktop → `RUN-ASKNORA.bat` / compose up; **or** power on the Ubuntu VM → `./scripts/start-linux.sh`.

---

## 0) What’s on this USB

```
CSI-Nora-FullStack/
├── START-HERE-RUNBOOK.md          ← you are reading this
├── DEPLOY.md                      ← detailed deploy checklist
├── README.md                      ← project overview
├── csi-nora-fullstack-deploy.zip  ← compressed package
└── csi-nora-fullstack/            ← unpacked source (ready to run / git push)
    ├── bootstrap.ps1              ← Windows one-shot start
    ├── bootstrap.sh               ← Linux/macOS one-shot start
    ├── csi-nora-v2/               ← Angular CSI Nora UI
    ├── ai-ecosystem-sandbox/      ← Docker AI stack (Ollama, Qdrant, …)
    │   ├── docker-compose.proxy.yml   ← single-entry reverse proxy (§2B)
    │   └── reverse-proxy/             ← nginx config + runbook
    └── docs/                      ← integration + ODS/agent runbooks
```

**Requirements on the target PC**

| Tool | Min |
|------|-----|
| Docker Desktop | 24+ (WSL2 backend on Windows) |
| Node.js | 18+ (20 LTS recommended) |
| Python | 3.11+ |
| RAM | 8 GB+ (16 GB better) |
| Disk free | ~10 GB for images + model |

---

## 1) Copy from USB to the PC (recommended)

Running from a fast local disk is more reliable than from USB.

**Windows (PowerShell)**

```powershell
# Adjust drive letter if needed (this USB is often E:)
$Usb = "E:\CSI-Nora-FullStack"
$Dest = "$env:USERPROFILE\Documents\csi-nora-fullstack"
Copy-Item -Path "$Usb\csi-nora-fullstack" -Destination $Dest -Recurse -Force
cd $Dest
```

**Or** expand the zip:

```powershell
Expand-Archive "E:\CSI-Nora-FullStack\csi-nora-fullstack-deploy.zip" -DestinationPath "$env:USERPROFILE\Documents"
cd "$env:USERPROFILE\Documents\csi-nora-fullstack"
```

---

## 2) Start the AI sandbox (Docker)

```powershell
cd ai-ecosystem-sandbox
copy .env.example .env
docker compose up -d
docker compose ps
```

**Checkpoint:** containers `sandbox-ollama`, `sandbox-qdrant`, `sandbox-chroma`, `sandbox-redis`, `sandbox-postgres` show **healthy** / **Up**.

Pull a small local model (first time ~1.3 GB):

```powershell
docker exec sandbox-ollama ollama pull llama3.2:1b
docker exec sandbox-ollama ollama list
```

**Checkpoint:**

```powershell
curl http://127.0.0.1:11434/v1/models
```

Should return JSON including `"llama3.2:1b"`.

### Optional: CPU / GPU / NPU

```powershell
.\scripts\set_accel.ps1 -Device cpu    # safest default
# .\scripts\set_accel.ps1 -Device gpu  # needs NVIDIA + Docker GPU
# .\scripts\set_accel.ps1 -Device npu  # Intel OpenVINO on AI PCs
```

---

## 2B) Single entry point — reverse proxy (recommended)

Instead of starting the UI, bridge and dashboard separately (sections 3–5),
bring up the **entire app behind one nginx port** with a single command. The
bridge and Streamlit run as containers and the Nora UI is served as a static
build — one origin, no CORS.

```powershell
cd csi-nora-v2
npm install
npm run build                              # produces dist\csi-nora\browser
cd ..\ai-ecosystem-sandbox
.\scripts\start_proxy.ps1 -Port 9090       # builds + starts EVERYTHING
```

Linux/macOS: `./scripts/start_proxy.sh` (or `PROXY_HTTP_PORT=9090 ./scripts/start_proxy.sh`).

Fully manual equivalent:

```powershell
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

**Entry points** (replace 9090 with your port; on Linux you can use 80):

| URL | Serves |
|-----|--------|
| `http://localhost:9090/` | CSI Nora UI |
| `http://localhost:9090/ollama/` | Ollama LLM API |
| `http://localhost:9090/sandbox/` | Nora bridge (guardrails + device scale) |
| `http://localhost:9090/streamlit/` | Streamlit dashboard |
| `http://localhost:9090/healthz` | proxy health |

> **Windows ports:** 80 and 8080 are usually reserved (Hyper-V/http.sys). Use
> `-Port 9090` (or any free port). List reserved ranges with
> `netsh interface ipv4 show excludedportrange protocol=tcp`.

In the Nora UI provider config, Base URL stays `/ollama/v1` — the proxy routes
it. **Sections 3–5 below are the manual / dev alternative** to this one command.
Full routing map: `ai-ecosystem-sandbox/reverse-proxy/README.md`.

---

## 2C) Share the demo on the LAN (other machines on the network)

The reverse proxy binds `0.0.0.0`, so other hosts can open the demo by IP.
**Only the proxy is LAN-exposed** — Ollama, the bridge and the databases bind to
`127.0.0.1` (loopback) and are reached only through the proxy on the Docker
network, so the local LLM is never directly exposed.

```powershell
# 1) Find your LAN IPv4 (active adapter, e.g. Wi-Fi)
ipconfig                      # e.g. 192.168.1.32

# 2) Open the port in Windows Firewall (run once, ELEVATED / Admin prompt)
netsh advfirewall firewall add rule name="CSI Nora Demo (TCP 9090)" dir=in action=allow protocol=TCP localport=9090
#   after the demo, remove it:
#   netsh advfirewall firewall delete rule name="CSI Nora Demo (TCP 9090)"

# 3) Confirm the proxy is bound to all interfaces
netstat -ano | findstr :9090   # expect 0.0.0.0:9090 ... LISTENING
```

Share this URL with the room: **http://<LAN-IP>:9090/** (e.g. `http://192.168.1.32:9090/`).
The UI uses relative API paths, so it works over any IP/hostname with no rebuild.

> ⚠️ **Security:** exposing on the LAN means anyone on the network can use the demo
> and the local LLM through the proxy. Only do this on a **trusted** network, and
> stop the stack after the demo (`docker compose ... down`).

---

## 2D) Auto-start on reboot / persistent deployment

Make the stack come back **automatically** after a Windows reboot, so
`http://<LAN-IP>:9090/` is live again with no manual steps. Three layers work
together:

1. **Docker restart policy** — every service in `docker-compose.yml` /
   `docker-compose.proxy.yml` uses `restart: unless-stopped`, so Docker relaunches
   the containers as soon as the engine is up.
2. **Docker Desktop autostart** — *Settings → General → "Start Docker Desktop when
   you sign in"* brings the engine up at logon.
3. **Scheduled Task fallback** — `scripts/autostart-stack.ps1` runs at logon, waits
   for `docker info` to succeed, then runs the compose `up -d` one-liner (idempotent).

**One-time setup — run ONCE in an elevated / Admin PowerShell:**

```powershell
cd ai-ecosystem-sandbox
# creates the LAN firewall rule (TCP 9090) + registers the logon Scheduled Task
powershell -ExecutionPolicy Bypass -File .\scripts\setup-autostart.ps1 -Port 9090
```

Then do the one GUI step: **Docker Desktop → Settings → General → "Start Docker
Desktop when you sign in"** (Apply & Restart).

**Keep the URL constant (recommended):** the app binds `0.0.0.0` and follows the
host's DHCP IP. Set a **DHCP reservation** (or static IP) for this machine on your
router so `http://192.168.1.32:9090/` doesn't change after reboot.

**Headless tradeoff:** Docker Desktop's WSL2 backend needs an interactive user
session, so the task runs **at logon**. For a truly login-free boot, run the Docker
engine as a Windows service instead (more setup; not required for the demo).

**Verify (no reboot needed):**

```powershell
docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" sandbox-proxy   # unless-stopped
Get-ScheduledTask -TaskName "CSI Nora Stack Autostart"                  # Ready
Get-NetFirewallRule  -DisplayName "CSI Nora Demo (TCP 9090)"            # exists / Enabled
```

Full details: `ai-ecosystem-sandbox/reverse-proxy/README.md` → *Auto-start on reboot*.

---

## 3) Start the Nora bridge API (optional)

Adds health, device probe, and guardrails on port **8090**.

```powershell
cd ai-ecosystem-sandbox
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-smoke.txt fastapi uvicorn
uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090
```

**Checkpoint:**

```powershell
curl http://127.0.0.1:8090/healthz
```

Expect `"status":"ok"` and `"ollama":true`.

---

## 4) Start CSI Nora (Angular UI)

Open a **new** terminal:

```powershell
cd csi-nora-v2
npm install
npm start
```

Browser opens **http://localhost:4200**.

### Configure the LLM (first run)

1. Click the **provider badge** in the header (⚙️).
2. Select **Ollama (Sandbox)**.
3. Base URL: `/ollama/v1` (dev proxy — do not change unless you know why).
4. Model: `llama3.2:1b`.
5. Compute scale: **CPU** or **Auto**.
6. Click **Test Connection** → expect ✅ Sandbox Ollama reachable.
7. **Save & Activate**.

### Chat

1. Pick a sector (left panel).
2. Ask a question (or use a quick prompt).
3. Hybrid RAG uses in-browser retrieval; answers come from local Ollama.

---

## 5) Optional demos

| UI | How |
|----|-----|
| Streamlit sandbox | `streamlit run dashboard/app_lite.py --server.port 8501` → http://localhost:8501 |
| Jupyter | `docker compose --profile jupyter up -d --build` → http://localhost:8888 (token: `sandbox`) |

---

## 6) One-shot Windows bootstrap (advanced)

From the unpacked folder:

```powershell
.\bootstrap.ps1
```

Starts Docker, pulls the model, starts the bridge + Streamlit, then Nora.

---

## 7) Ports cheat sheet

| Port | Service | Binding |
|------|---------|---------|
| **80 / 9090** | Reverse proxy (single entry point; see §2B/§2C) | `0.0.0.0` (LAN) |
| **4200** | CSI Nora UI (dev `ng serve`) | localhost |
| **11434** | Ollama | `127.0.0.1` (internal) |
| **8090** | Nora bridge | `127.0.0.1` (internal) |
| **8501** | Streamlit | `127.0.0.1` (internal) |
| **6333** | Qdrant | `127.0.0.1` (internal) |
| **8000** | Chroma | `127.0.0.1` (internal) |
| **6379** | Redis | `127.0.0.1` (internal) |
| **5432** | Postgres + pgvector | `127.0.0.1` (internal) |

---

## 8) Push to GitHub / GitLab (optional)

The unpacked folder already has an initial git commit.

```powershell
cd csi-nora-fullstack
git remote add origin https://github.com/<ORG>/<REPO>.git
git branch -M main
git push -u origin main
```

---

## 9) Troubleshooting

| Symptom | Fix |
|---------|-----|
| Docker not running | Start Docker Desktop; wait until it is healthy |
| Test Connection fails | `docker compose ps`; confirm `npm start` (proxy enabled) |
| Port 4200 busy | Stop other `ng serve` or change port in `package.json` |
| Slow / timeouts | Use `llama3.2:1b` + CPU; free RAM (close heavy apps) |
| GPU not used | Install NVIDIA Container Toolkit; `set_accel.ps1 -Device gpu` |
| Running from USB is slow | Copy folder to local SSD first (Step 1) |

---

## 10) Security note

This is a **lab / demo** stack. Do **not** load real NRIC, medical records, or production secrets. Enable guardrails and follow PDPA practices for any Singapore customer data.

---

## Quick success criteria

- [ ] `curl http://127.0.0.1:11434/v1/models` works  
- [ ] http://localhost:4200 loads CSI Nora  
- [ ] Provider **Ollama** Test Connection = ✅  
- [ ] Sector chat returns a local model answer  

**You’re done.** For deeper detail see `DEPLOY.md` and `docs/CSI-Nora-Sandbox-Integration.md`.
