# Deploy CSI Nora on a Windows laptop with nginx (public IP)

Use this when the **same machine** that builds the app also **hosts** nginx and is reachable on a **public IP** (e.g. `66.249.73.198`). Typical setup: laptop on a network with **router port forwarding** (WAN → your laptop LAN IP) and **Windows Firewall** allowing inbound HTTP.

**Verify the IP:** From the laptop, run `curl.exe -s https://ifconfig.me` — that value should match what you use in `CSI_NORA_PUBLIC_ORIGIN`. If it does not match `66.249.73.198`, use the address you get from ifconfig.me (your real WAN IP).

---

## 0. Prerequisites

| Item | Action |
|------|--------|
| **Router** | Forward **TCP 8090** (and **443** if you add HTTPS later) to this laptop’s **LAN IP** (e.g. `192.168.1.x`). |
| **Windows Firewall** | Allow inbound **8090** (and **443** if needed). See [Firewall](#windows-firewall) below. |
| **Build** | Node.js LTS, `npm ci` in the project folder. |
| **nginx** | [nginx for Windows](https://nginx.org/en/download.html) (stable zip) **or** WSL2 Ubuntu + `apt install nginx`. |

---

## 1. Build with your public origin (HTTP on port 8090)

Until you have a TLS certificate, serve **HTTP** on port **8090** and bake the same origin into the app (must include **`:8090`**):

**PowerShell (project root):**

```powershell
$env:CSI_NORA_PUBLIC_ORIGIN="http://66.249.73.198:8090"
npm run build:vm
```

Use **`http://`** (not `https://`) so `backendBaseUrl` matches what nginx serves. After you add HTTPS, rebuild with `https://YOUR_HOST` (port 443, no `:8090` in URL).

---

## 2. One-step build + copy (optional script)

From the project root:

```powershell
.\scripts\deploy-laptop.ps1 -PublicOrigin "http://66.249.73.198:8090" -DeployRoot "C:\csi-nora-deploy\browser"
```

This runs `build:vm` and copies `dist\csi-nora\browser\*` into `C:\csi-nora-deploy\browser\`. Point **nginx `root`** at that folder (see nginx config — use forward slashes `C:/csi-nora-deploy/browser`).

---

## 3. Run the LLM gateway (same laptop)

The Angular app calls **`/api/...`** on the **same origin** as the page. nginx must proxy `/api/` to the Node gateway.

**Second PowerShell window (project root):**

```powershell
cd "C:\path\to\csi-nora"
npm run gateway
```

Default: **http://127.0.0.1:3456**. Keep this running (or install [NSSM](https://nssm.cc/) / Task Scheduler to start it at boot).

---

## 4. nginx on Windows (recommended for “laptop server”)

**Full install & start steps:** [`INSTALL-NGINX-WINDOWS.md`](./INSTALL-NGINX-WINDOWS.md)

1. Download **nginx/Windows-1.xx.x** zip from [nginx.org](https://nginx.org/en/download.html).
2. Extract to e.g. `C:\tools\nginx`.
3. Edit `C:\tools\nginx\conf\nginx.conf`:
   - Inside the top-level `http { ... }` block, **paste** the contents of **`csi-nora-http.conf`** from this folder (or merge the `upstream` + `server` blocks).
4. Set `root` to your deploy folder, e.g. `root C:/csi-nora-deploy/browser;` (forward slashes).
5. Start nginx:

```powershell
cd C:\tools\nginx
.\nginx.exe
```

Reload after config changes: `.\nginx.exe -s reload`

**Test:** On the laptop, open **http://127.0.0.1:8090/** — from a phone on cellular, open **http://66.249.73.198:8090/** (use your real public IP if different).

---

## 5. nginx in WSL2 (alternative)

If you use **WSL Ubuntu** for nginx, copy the built files into WSL, e.g. `/var/www/csi-nora/browser`, and use **`deploy/vm-public-ip/nginx-csi-nora.conf`** with `server_name` set to your IP.

**Important:** Run **`npm run gateway`** **inside WSL** from the project on `/mnt/c/...` so the gateway listens on `127.0.0.1:3456` in the same environment as nginx. External access to port **8090** may require [port forwarding from Windows to WSL](https://learn.microsoft.com/en-us/windows/wsl/networking#accessing-a-wsl-2-distribution-from-your-local-area-network-lan).

---

## 6. Short link

Point **csiaidea.short.gy** → **`http://66.249.73.198:8090/`** (or `https://...` once TLS is configured).

---

## Windows Firewall

**PowerShell (Administrator):**

```powershell
New-NetFirewallRule -DisplayName "CSI Nora HTTP 8090" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8090
New-NetFirewallRule -DisplayName "CSI Nora HTTPS" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
```

Do **not** expose port **3456** to the internet; only nginx (**8090** / **443**) should be public. The gateway stays on localhost.

---

## Troubleshooting

| Problem | What to check |
|---------|----------------|
| Site works on laptop, not from internet | Router port forward, firewall, correct **public** IP. |
| 502 on `/api/` | Gateway running on 3456; nginx `proxy_pass` matches. |
| API calls wrong host | Rebuild with `CSI_NORA_PUBLIC_ORIGIN` exactly matching browser URL (include **`:8090`**, http vs https, no trailing slash). |
| Blank Angular routes | `try_files $uri $uri/ /index.html;` and `root` points to folder containing `index.html`. |
