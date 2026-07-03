# Public URL — tunnel (local dev) or deployment (static host)

Use a **tunnel** when you need a temporary **HTTPS URL** that forwards to your machine (demos, mobile testing on the same build). Use **deployment** when you want a **stable** URL backed by a CDN or company hosting.

**Switch ngrok vs Cloudflare Tunnel:** see **[TUNNEL-NGROK-CLOUDFLARE.md](./TUNNEL-NGROK-CLOUDFLARE.md)** — `npm run tunnel:ngrok` or `npm run tunnel:cloudflare` (default port **8090** for nginx).

**Security:** Tunnels expose whatever is listening on the target port. Do not demo confidential data; treat tunnel URLs as **semi-public**. For production, use proper auth, environment config, and approved hosting.

---

## Option A — Tunnel to `localhost:4200` (ngrok)

Best for quick shares while `npm start` is running.

### 1. Install ngrok

- Download: [ngrok.com/download](https://ngrok.com/download)  
- Or (with Node): `npm install -g ngrok`  
- Sign up at [ngrok.com](https://ngrok.com) and add your **authtoken** once:  
  `ngrok config add-authtoken YOUR_TOKEN`

### 2. Run the app locally

```bash
npm start
```

Leave this running (serves on **port 4200**).

### 3. Start the tunnel (second terminal)

```bash
ngrok http 4200
```

ngrok prints an **HTTPS** URL such as `https://xxxx.ngrok-free.app` — that is your public address. Open it or put it in your short link (e.g. `csiaidea.short.gy` → that URL).

### Notes

- The free tier URL **changes** when you restart ngrok unless you use a **reserved domain** (paid feature on some plans).
- If you use **port 4300** (`npm run start:sandbox`), run `ngrok http 4300` instead.

---

## Option B — Cloudflare Tunnel (`cloudflared`)

Useful if your org prefers Cloudflare.

1. Install: [Cloudflare Zero Trust — cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)  
2. With the dev server on 4200:

```bash
cloudflared tunnel --url http://localhost:4200
```

Follow the CLI output for the trycloudflare.com (or configured) HTTPS URL.

---

## Option C — Deploy the production build (stable public URL)

Build once, upload the **browser** output to any static host. This is the right approach for **lasting** links and production.

### 1. Build

```bash
npm run build
```

Output folder: **`dist/csi-nora/browser/`** (contains `index.html` and hashed JS/CSS).

### 2. SPA routing

The host must serve **`index.html`** for unknown paths (Angular routes). Examples:

| Host | What to configure |
|------|---------------------|
| **Netlify** | Use repo `netlify.toml` (see project root) or Netlify UI: publish `dist/csi-nora/browser`, redirect `/*` → `/index.html` (200). |
| **Vercel** | Set output to `dist/csi-nora/browser`, add SPA rewrite `/*` → `/index.html`. |
| **Azure Static Web Apps** | Build command `npm run build`, app location `dist/csi-nora/browser`. |
| **nginx** | `try_files $uri $uri/ /index.html;` |

### 3. Environment / API

Production builds use `environment.prod.ts`. Set **`backendBaseUrl`** and related flags for your **CSI Nora API gateway** in the build or via your deployment pipeline. Optional local YAML in the app is for dev-style overrides only — not a substitute for secure production config.

### 4. Point your short link

After deployment, set your short link (e.g. `csiaidea.short.gy`) to the **HTTPS URL** from Netlify/Vercel/Azure (not `localhost`).

---

## Option D — Linux VM with a public IP (nginx + optional gateway)

Use your **own server** with a public IP (or DNS name). The repo includes:

| Artifact | Purpose |
|----------|---------|
| **`npm run build:vm`** | Sets `backendBaseUrl` from env **`CSI_NORA_PUBLIC_ORIGIN`** (your `https://IP` or hostname) and builds the app. |
| **`deploy/vm-public-ip/nginx-csi-nora.conf`** | Serves `dist/csi-nora/browser` and proxies **`/api/`** to the Node gateway on `127.0.0.1:3456`. |
| **`deploy/vm-public-ip/README.md`** | Step-by-step: build, copy files, firewall, TLS notes. |

**Example (replace with your public IP or hostname):**

```bash
export CSI_NORA_PUBLIC_ORIGIN=https://203.0.113.10
npm run build:vm
```

Then deploy `dist/csi-nora/browser/` and configure nginx per **`deploy/vm-public-ip/README.md`**. When you have the IP, pass it in **`CSI_NORA_PUBLIC_ORIGIN`** (scheme + host; bare IP is accepted and `https://` is added).

Point your short link to **`https://your-ip-or-host/`** (same origin as `CSI_NORA_PUBLIC_ORIGIN`).

---

## Short link + public URL

| Target | Works for others? |
|--------|-------------------|
| `http://localhost:4200` | No — only your PC. |
| `https://xxxx.ngrok-free.app` | Yes — while tunnel is running. |
| `https://your-app.netlify.app` | Yes — permanent (until you change deploy). |
| `https://YOUR_PUBLIC_IP` (VM + nginx) | Yes — your VM + `build:vm` + gateway (see Option D). |

Configure **csiaidea.short.gy** (or any shortener) to redirect to the **HTTPS** (or HTTP) URL from options A–D.
