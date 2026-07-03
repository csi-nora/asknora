# Switch between ngrok and Cloudflare Tunnel (CSI Nora)

Use this when **home port forwarding / public IP** does not work (e.g. CGNAT on Singtel). A **tunnel** gives you an **HTTPS URL** that forwards to your PC without opening inbound ports on the router.

**Default target:** **`http://127.0.0.1:8090`** — nginx serving the **production build** in `C:\csi-nora-deploy\browser`.  
For **dev** (`ng serve`), use **`-Port 4200`** instead.

**Prerequisites on the PC**

1. **nginx** on **8090** (or `npm start` on **4200** for dev).
2. **`npm run gateway`** in another window if you need **`/api/`** (LLM) through the same origin — tunnel forwards to nginx; nginx proxies `/api/` to port **3456**.

---

## Install both tools (one-time)

### Windows — winget (fastest)

**Open a new PowerShell or Terminal** after install (PATH refresh), then verify:

```powershell
winget install --id Ngrok.Ngrok -e --accept-package-agreements --accept-source-agreements
winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
ngrok version
cloudflared --version
```

### ngrok — authtoken (required before first tunnel)

1. Sign up at [ngrok.com](https://ngrok.com) → copy your authtoken.  
2. Run:
   ```powershell
   ngrok config add-authtoken YOUR_TOKEN_HERE
   ```

### Manual install (alternative)

- **ngrok:** [ngrok.com/download](https://ngrok.com/download) → add `ngrok.exe` to **PATH**.  
- **cloudflared:** [Install on Windows](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/#windows).

---

## Switch — run **one** tunnel at a time

Stop the previous tunnel (**Ctrl+C**) before starting the other.

### Option A — npm scripts (from project root)

| Command | What it does |
|---------|----------------|
| `npm run tunnel:ngrok` | Starts **ngrok** → port **8090** |
| `npm run tunnel:cloudflare` | Starts **cloudflared** quick tunnel → **8090** |

### Option B — PowerShell directly

```powershell
cd path\to\csi-nora
.\scripts\tunnel.ps1 -Provider Ngrok
# or
.\scripts\tunnel.ps1 -Provider Cloudflare
```

### Dev server on 4200 instead of nginx 8090

```powershell
.\scripts\tunnel.ps1 -Provider Ngrok -Port 4200
.\scripts\tunnel.ps1 -Provider Cloudflare -Port 4200
```

---

## After the tunnel starts

- **ngrok** prints something like **`https://xxxx.ngrok-free.app`** → use **`https://.../ask-nora`** for Ask Nora.  
- **cloudflared** prints a **`https://....trycloudflare.com`** URL (quick tunnel) → same path suffix.

Put that **HTTPS** URL (with `/ask-nora` if you want to skip the launcher) in **Short.io → Original URL**.

**Rebuild not required for tunnel hostname:** the app uses **relative** `/api/` calls; same origin is the tunnel host. If you previously set `backendBaseUrl` to a **public IP** in `build:vm`, tunnel + nginx same-origin may still work for static assets; for simplest behaviour with gateway, keep **nginx + gateway** and tunnel to **8090**.

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| `ngrok` / `cloudflared` not recognized | Fix **PATH** or use full path to the `.exe`. |
| 502 / connection refused | **nginx** not running on 8090, or wrong **`-Port`**. |
| `/api/` fails | Run **`npm run gateway`** on the PC. |
| URL changes every restart | Normal on free tiers; paid ngrok / named Cloudflare tunnel for stable hostnames. |

---

## Security

Tunnels are **public**. Do not expose secrets; use demo data for presentations.
