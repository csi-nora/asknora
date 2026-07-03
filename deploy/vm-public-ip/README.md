# Deploy CSI Nora on a Linux VM (public IP)

Serve the Angular app and (optionally) the Node LLM gateway behind **nginx** on a machine with a **public IP**. The app is built with **`backendBaseUrl`** set to the same origin nginx exposes (HTTPS or HTTP).

## What you need

- A **VM** (AWS EC2, Azure VM, GCP, on‑prem, etc.) with a **public IP** (or DNS A record).
- **Node.js 18+** on the VM to build and to run `server/gateway.cjs`.
- **nginx** installed.

## 1. Build on the VM (or CI) with your public origin

From the project root, set **`CSI_NORA_PUBLIC_ORIGIN`** to the URL users will type in the browser **for this app** (same host nginx will serve). Examples:

| Scenario | Value |
|----------|--------|
| HTTP on port 80 | `http://203.0.113.10` |
| HTTPS on 443 (after TLS) | `https://csi.example.com` |
| Bare IP (script adds `https://`) | `203.0.113.10` |

**PowerShell (Windows build machine):**

```powershell
$env:CSI_NORA_PUBLIC_ORIGIN="203.0.113.10"
npm ci
npm run build:vm
```

**bash (Linux / macOS):**

```bash
export CSI_NORA_PUBLIC_ORIGIN=https://203.0.113.10
npm ci
npm run build:vm
```

This generates `src/environments/environment.vm.generated.ts` (gitignored) and builds **`dist/csi-nora/browser/`** with `backendBaseUrl` pointing at that origin so API calls hit your nginx `/api/` proxy.

## 2. Copy static files to the VM

```bash
sudo mkdir -p /var/www/csi-nora
sudo rsync -a dist/csi-nora/browser/ /var/www/csi-nora/browser/
# or scp from your workstation
```

## 3. Gateway (same VM)

```bash
cd /path/to/csi-nora
cp server/.env.example server/.env
# Edit server/.env — set ANTHROPIC_API_KEY / OPENAI_API_KEY / HUGGINGFACE_API_KEY as needed
PORT=3456 node server/gateway.cjs
```

Run under **systemd** or **pm2** in production. nginx proxies `/api/` → `http://127.0.0.1:3456`.

## 4. nginx

1. Copy `nginx-csi-nora.conf` from this folder to `/etc/nginx/sites-available/csi-nora`.
2. Replace **`YOUR_PUBLIC_IP_OR_HOSTNAME`** with your IP or hostname.
3. Ensure `root` matches `/var/www/csi-nora/browser`.
4. Enable site and reload:

```bash
sudo ln -s /etc/nginx/sites-available/csi-nora /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Firewall

Open **80** (and **443** if using TLS) to the world; keep **3456** closed externally (gateway is localhost-only).

```bash
# ufw example
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## HTTPS

- **Best:** DNS name → public IP, then **Let’s Encrypt** (`certbot --nginx`).
- **Raw IP only:** browsers trust HTTPS on IP poorly; prefer a **hostname** or terminate TLS on a load balancer / Cloudflare.

## Rebuild after code changes

```bash
CSI_NORA_PUBLIC_ORIGIN=https://your-host npm run build:vm
sudo rsync -a dist/csi-nora/browser/ /var/www/csi-nora/browser/
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Blank page | `root` points to `.../browser` with `index.html`; `try_files` for SPA. |
| API / LLM errors | Gateway running on 3456; nginx `location /api/`; `backendBaseUrl` in build matches `https://` vs `http://` and host. |
| CORS | Gateway uses `cors({ origin: true })`; same-origin requests from the app should be fine. |
