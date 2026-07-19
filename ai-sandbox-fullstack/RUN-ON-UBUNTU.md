# Run CSI Nora on Ubuntu (VMware Workstation — Bridged networking)

This runbook brings the **entire CSI Nora full stack** up on an Ubuntu VM. The stack is
fully self-contained in Docker Compose — the Angular UI, nginx reverse proxy, Ollama
(local LLM), the FastAPI bridge, Streamlit, and the vector DBs are **all containers**, so
there is **no dependency on the Windows host**. You can run this VM instance alongside the
Windows instance; both are independent.

> **Networking assumption:** your VM uses **VMware Bridged** mode, so the VM gets its own
> IP on your physical LAN (e.g. `192.168.1.40`). That means the VM's app is reachable from
> any device on the network — including the Windows host — with no port forwarding.

---

## 0) Give the VM enough resources (important)

The earlier `500 INTERNAL ERROR` was VM memory exhaustion. This stack runs Ollama plus
~7 other containers, so in **VMware → VM Settings**:

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| Memory   | 8 GB    | 12–16 GB    |
| Processors | 4 vCPU | 4–8 vCPU   |
| Disk     | 20 GB free | 30 GB+   |

GPU passthrough is normally unavailable in VMware, so Ollama runs **CPU-only** in the VM
(functional, just slower than a GPU host).

---

## 1) Confirm Bridged networking

In **VMware Workstation → VM → Settings → Network Adapter**, select **Bridged
(Automatic)** and tick *"Replicate physical network connection state"*. Boot the VM, then:

```bash
hostname -I          # note the first IP, e.g. 192.168.1.40 — this is your VM's LAN IP
ip route get 1.1.1.1 # confirms the VM routes out via the bridged adapter
```

Your VM's LAN IP should be on the **same subnet** as the Windows host (`192.168.1.x`).
If it shows a `172.16.x`/`10.x` NAT-style address, the adapter is still on NAT — switch it
to Bridged.

> **Tip — keep the URL stable:** give this VM a **DHCP reservation** on your router (bind
> its MAC to a fixed IP) so the shared `http://<VM-IP>:9090/` never changes across reboots.

---

## 2) One-time setup

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # then LOG OUT and back in so the group applies

# Node 20 — only needed to BUILD the UI (skip if you use a prebuilt dist, see step 4)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Open the firewall for LAN access (if ufw is enabled)
sudo ufw allow 9090/tcp
```

---

## 3) Get the code onto the VM (pick one)

**A. Clone from GitHub (public):**
```bash
git clone https://github.com/csi-nora/asknora.git
cd asknora/ai-sandbox-fullstack/ai-ecosystem-sandbox
```

**B. Copy from the USB / deploy zip:** mount the USB (or copy `csi-nora-fullstack-deploy.zip`
over the network), unzip, then:
```bash
cd csi-nora-fullstack/ai-ecosystem-sandbox
```

---

## 3B) Updating an existing VM clone (resolving `git pull` conflicts)

Already have the repo on the VM and want the latest version? Just `git pull`. If you
see this, git is protecting local edits to tracked files:

```
error: Your local changes to the following files would be overwritten by merge:
    ai-sandbox-fullstack/ai-ecosystem-sandbox/scripts/start-linux.sh
    ai-sandbox-fullstack/ai-ecosystem-sandbox/scripts/start_proxy.sh
Please commit your changes or stash them before you merge. Aborting
```

**Why it happens:** the `*.sh` launchers are tracked in git, so any local change —
manual edits, an editor rewriting **line endings** (CRLF↔LF), or `chmod +x` flipping
the file mode — makes git think you have uncommitted work that a pull would clobber.

**Recommended fix — GitHub is the source of truth, discard the local script copies:**
```bash
# from the ai-ecosystem-sandbox dir (where you saw the error)
git checkout -- scripts/start-linux.sh scripts/start_proxy.sh
git pull
```

**Nuclear option — make the clone match GitHub exactly** (discards ALL local changes):
```bash
git fetch origin && git reset --hard origin/main
```
> Safe for your data: uploaded **Knowledge Base docs live in the browser**
> (localStorage → IndexedDB), **not** in the repo, so a hard reset never touches them.

**If you WANT to keep your local edits**, stash them across the pull, or commit them:
```bash
git stash && git pull && git stash pop        # re-apply your edits on top of the update
# — or —
git commit -am "local VM tweaks" && git pull --rebase   # (git push too, if you have write access)
```

**Prevent it from recurring:** `.gitattributes` now normalizes line endings
(`*.sh`=LF, `*.bat`/`*.ps1`=CRLF). If `chmod` keeps producing spurious diffs on the
scripts, tell git to ignore file-mode bits on this VM:
```bash
git config core.fileMode false
```

**Then restart cleanly** (clears any orphaned containers before the fresh start):
```bash
cd ai-ecosystem-sandbox   # if not already there
docker compose -f docker-compose.yml -f docker-compose.proxy.yml down --remove-orphans
./scripts/start-linux.sh
```

Want it to survive reboots after updating? See **§6 Auto-start on reboot** — the
services already carry `restart: unless-stopped`; just ensure `sudo systemctl enable
docker` (and optionally add the `@reboot` crontab one-liner documented there).

---

## 4) Start the whole stack — one command

```bash
chmod +x scripts/*.sh
./scripts/start-linux.sh
```

This builds the Angular UI, starts all containers on **port 9090**, pulls the demo model
(`llama3.2:3b`, ~2 GB on first run), auto-detects your Bridged LAN IP, and prints the
share URL.

Useful variants:
```bash
PORT=80 ./scripts/start-linux.sh          # publish on port 80 (Linux allows it)
SKIP_BUILD=1 ./scripts/start-linux.sh     # use a prebuilt dist — no Node required
MODEL=llama3.2:1b ./scripts/start-linux.sh  # smaller/faster model for low-RAM VMs
PULL_MODEL=0 ./scripts/start-linux.sh     # don't auto-download a model
```

When it finishes you'll see:
```
 On this VM  : http://localhost:9090/
 On the LAN  : http://192.168.1.40:9090/     <-- share this URL
 Health      : http://localhost:9090/healthz
```

---

## 4B) Offline / air-gapped embeddings (dense vectors with NO internet)

The Knowledge Base uses a dense-embedding model (`Xenova/all-MiniLM-L6-v2`) for
hybrid (dense + BM25) retrieval. The deploy bundle **ships this model, its WASM
runtime, and pdf.js vendored under `csi-nora-v2/public/`**, served same-origin by
nginx — so **document embedding works fully offline** on an isolated VM. When the
model is self-hosted, uploaded docs show **`dense + BM25 ✓`** and the RAG panel
reports **`Model source: self-hosted ✓`**.

If you cloned/copied a bundle **without** the vendored assets (they're large,
~44 MB), the app will fall back to keyword-only search and docs will show the
amber **`BM25 only ⓘ`** tag. To vendor them once, on a machine **with internet**:

```bash
cd ai-ecosystem-sandbox
./scripts/fetch-embedding-model.sh      # downloads model + WASM + pdf.js into ../csi-nora-v2/public
cd ../csi-nora-v2 && npm run build       # (or re-run ./scripts/start-linux.sh)
```

> The only remaining online asset is the Google Fonts stylesheet (cosmetic); if
> blocked, the UI simply falls back to system fonts. All KB/RAG functionality is
> offline-capable.

---

## 5) Running on BOTH platforms at once

With Bridged mode you get two fully independent instances on the same LAN:

| Platform | URL | Notes |
|----------|-----|-------|
| Windows host | `http://192.168.1.32:9090/` | Docker Desktop stack |
| Ubuntu VM    | `http://192.168.1.40:9090/` | this runbook (replace with your `hostname -I`) |

Both are reachable from any device on the LAN. The Knowledge Base is stored **per browser**
(localStorage → auto-tiering to IndexedDB), so each instance/browser keeps its own KB.

---

## 6) Auto-start on reboot (Linux — simpler than Windows)

Native Docker starts on boot via systemd, and every service has `restart: unless-stopped`,
so after one successful start the whole stack returns automatically after a reboot:

```bash
sudo systemctl enable docker     # usually already enabled
```

No Scheduled Task / login-session workaround is needed (unlike Docker Desktop on Windows).
If you want a guaranteed re-`up` after boot even if a container was removed, add a user cron:

```bash
( crontab -l 2>/dev/null; echo "@reboot cd $PWD && ./scripts/start-linux.sh SKIP_BUILD=1 PULL_MODEL=0 >> \$HOME/csi-nora-boot.log 2>&1" ) | crontab -
```

---

## 7) Verify & troubleshoot

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml ps   # all healthy?
curl http://localhost:9090/healthz                                    # {"status":"ok",...}
docker exec sandbox-ollama ollama list                                # model present?
```

| Symptom | Fix |
|---------|-----|
| Other devices can't connect | `sudo ufw allow 9090/tcp`; confirm VM IP with `hostname -I` |
| `permission denied` on docker | `sudo usermod -aG docker $USER`, then log out/in |
| VM IP on `172.x`/`10.x` | Network adapter is on NAT — switch to **Bridged** |
| Slow answers | CPU-only inference in the VM; try `MODEL=llama3.2:1b` or add vCPUs/RAM |
| Port 9090 in use | `PORT=9091 ./scripts/start-linux.sh` |

**Stop the stack:**
```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml down
```

---

## 8) MCP tools server (optional)

The stack now includes a genuine **MCP server** (FastMCP) exposing `calculator`,
`web_search` and `wikipedia_lookup`. It starts as the `mcp` container (no host
port — internal only) and is reachable through the proxy over SSE:

```bash
curl -N http://localhost:9090/mcp/sse        # event stream (Ctrl-C to stop)
```

For **Cursor / local** use, prefer the stdio transport (no container):

```bash
cd ai-ecosystem-sandbox
python apps/mcp_server/smoke_test.py         # proves it lists tools + runs calculator
```

`.cursor/mcp.json` is shipped at the repo root so Cursor auto-discovers it. See
`ai-ecosystem-sandbox/apps/mcp_server/README.md` for details.

---

## Security note

Bridged + LAN exposure means **anyone on the network can reach the demo and drive the local
LLM** through the proxy. Only run this on a **trusted** network, and stop the stack after the
demo. Ollama, the bridge, and the databases are intentionally kept **internal to the Docker
network** — only the nginx proxy (port 9090) is exposed. Do not add LAN port bindings for the
backend services.
