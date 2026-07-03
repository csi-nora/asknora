# CSI Nora — Enterprise Portfolio Advisor (Angular)

**Singtel CSI** · Angular 17 · Standalone components · Hybrid AI (API + local KB) · Browser persistence

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | **18.x or 20.x LTS** recommended (matches Angular 17). [nodejs.org](https://nodejs.org/) |
| **npm** | Comes with Node.js (`npm -v`) |
| **Browser** | Chrome, Edge, or Firefox (latest) |
| **Git** | Optional — only if you clone from a repository |

Verify versions:

```bash
node -v
npm -v
```

---

## Run the project (step by step)

### 1. Get the source code

**Option A — you already have the folder**

```bash
cd path\to\csi-nora
```

**Option B — clone from Git**

```bash
git clone https://github.com/dreamworks-dmr/csi-asknora-ent.git
cd csi-asknora-ent
```

### 2. Install dependencies

From the project root (folder that contains `package.json` and `angular.json`):

```bash
npm install
```

Wait until it finishes without errors. If you see peer-dependency warnings, they are often safe to ignore unless `npm install` fails outright.

### 3. Start the development server

```bash
npm start
```

This runs `ng serve` on **port 4200** and may open your browser automatically.

### 4. Open the app

In the browser, go to:

**http://localhost:4200**

You should see the CSI Nora UI. If the port is in use, stop the other process or use a different port (see [Troubleshooting](#troubleshooting)).

### 5. Configure AI access (first-time)

1. Use the **API / provider** controls in the app (header or settings flow for your build).
2. Choose **Anthropic**, **OpenAI**, or **Hugging Face**, enter a valid **API key**, pick a **model**, then **Save & Activate**.
3. Optional: enable **Remember API keys** only on a trusted machine (keys stay in browser storage).

Without a key, the app can still use **local / offline** behaviour where implemented (keyword search over bundled KB), depending on mode.

### 6. (Optional) Run with the local API gateway

Use this when you want LLM traffic to go through the **Node gateway** (proxied from `/api/llm`) instead of calling providers directly from the browser.

**Terminal 1 — gateway**

```bash
npm run gateway
```

Default gateway port: **3456** (see `server/.env.example`).

**Terminal 2 — Angular with proxy**

```bash
npm run start:with-gateway
```

Ensure `proxy.conf.json` targets the same host/port as the gateway (`http://127.0.0.1:3456`). Configure the app’s **backend / gateway URL** (and related flags) via deployment environment or the **optional local YAML** in API settings, as documented in `docs/`.

Copy `server/.env.example` → `server/.env` and set provider keys **only** if the gateway should call providers server-side. Do **not** commit real `.env` files.

### 7. (Optional) Public HTTPS URL — tunnel or deployment

`localhost` is not reachable from the internet. To get a **shareable link** (for demos, short links, or testers):

| Approach | Use when |
|----------|----------|
| **Tunnel** (ngrok, Cloudflare) | Quick demo while `npm start` is running; temporary URL. |
| **Deploy** (Netlify, Vercel, Azure, etc.) | Stable URL; use production build. |
| **VM + public IP** | `npm run build:vm` with **`CSI_NORA_PUBLIC_ORIGIN`**, nginx sample in **`deploy/vm-public-ip/`**. |

**Step-by-step:** [`docs/PUBLIC-URL-TUNNEL-DEPLOY.md`](docs/PUBLIC-URL-TUNNEL-DEPLOY.md)

- **Tunnel example:** **`npm run tunnel:ngrok`** or **`npm run tunnel:cloudflare`** (defaults to nginx port **8090**; see [`docs/TUNNEL-NGROK-CLOUDFLARE.md`](docs/TUNNEL-NGROK-CLOUDFLARE.md)). For dev only: `tunnel:ngrok:dev` / `tunnel:cloudflare:dev` (port **4200**).  
- **Deploy example:** root **`netlify.toml`** is set up for `npm run build` and publish folder `dist/csi-nora/browser` with SPA fallback. Connect the repo in [Netlify](https://www.netlify.com/) or adapt the same paths for Vercel/Azure.  
- **Own VM / public IP:** set your origin and build — `CSI_NORA_PUBLIC_ORIGIN=https://YOUR_IP npm run build:vm` — then follow **`deploy/vm-public-ip/README.md`** (nginx + gateway).  
- **Windows laptop as server:** **`deploy/windows-laptop-nginx/README.md`** — nginx for Windows, router port-forward, `scripts/deploy-laptop.ps1`.

---

## Other useful commands

| Goal | Command |
|------|---------|
| **Production run** (build + serve on **8080**) | `npm run prod` |
| **Production Docker** (web + API gateway) | `npm run docker:up` |
| **Production release bundle** | `npm run package:prod` |
| Full deploy guide | [`DEPLOY-PRODUCTION.md`](./DEPLOY-PRODUCTION.md) |
| Dev server, **sandbox** build config, port **4300** | `npm run start:sandbox` |
| **Production** build (output in `dist/csi-nora/browser`) | `npm run build` |
| **VM / public IP** build (`backendBaseUrl` from env) | `CSI_NORA_PUBLIC_ORIGIN=https://YOUR_HOST npm run build:vm` |
| **Sandbox** build | `npm run build:sandbox` |
| **Unit tests** (interactive) | `npm test` |
| **UAT-style tests** (headless, subset) | `npm run test:uat` |
| Run **gateway** only | `npm run gateway` |
| **Public URL** — **ngrok** (→8090) | `npm run tunnel:ngrok` |
| **Public URL** — **Cloudflare** (→8090) | `npm run tunnel:cloudflare` |

---

## Verify the build

After `npm run build`, check that **`dist/csi-nora/browser/`** contains `index.html` and JS bundles. Quick local smoke test:

```bash
npx --yes http-server dist/csi-nora/browser -p 8080
```

Open `http://localhost:8080`. For SPA routing, the server must **fallback to `index.html`** for unknown paths (see `netlify.toml` or nginx `try_files`).

---

## Troubleshooting

| Issue | What to try |
|-------|-------------|
| **`ng` / `npm` not found** | Install Node.js LTS and reopen the terminal. On Windows, confirm **Add to PATH** was selected. |
| **Port 4200 already in use** | Stop the other app, or run: `npx ng serve --port 4201` and open `http://localhost:4201`. |
| **`npm install` errors** | Delete `node_modules` and `package-lock.json`, then run `npm install` again (only if you accept lockfile regeneration). |
| **Blank page / console errors** | Hard-refresh (Ctrl+F5). Check browser console and that you used `http://localhost:4200`, not `file://`. |
| **Gateway / proxy errors** | Confirm gateway is running **before** the app, and ports match `proxy.conf.json` and `server/.env`. |

---

## Project structure (overview)

```
csi-nora/
├── src/app/           # Angular app (components, services, routes)
├── src/environments/  # Build-time environment files
├── public/            # Static assets (served as `/`)
├── server/            # Optional Node gateway (gateway.cjs)
├── docs/              # Extra documentation
├── deploy/            # Deployment notes and examples
└── angular.json       # Angular CLI configuration
```

More detail: **`docs/README.md`**, **`docs/UAT-SANDBOX-PRODUCTION.md`**, **`docs/PUBLIC-URL-TUNNEL-DEPLOY.md`** (tunnels & public deploy).

---

## localStorage keys (reference)

| Key prefix / name | Purpose |
|-------------------|---------|
| `csinora_session`, `csinora_docs`, `csinora_audit`, … | Session, documents, audit, API prefs, named sessions |
| `asknora-secrets-yaml-v1` (optional) | Local YAML overrides for gateway URL / flags (may be encrypted in-app) |

---

## Tech stack

- **Angular 17** — Standalone components, signals, routing  
- **TypeScript** · **RxJS** · **SCSS**  
- **PDF.js** — client-side PDF text extraction  

---

## Development with Cursor

The repo may include `.cursorrules` for AI-assisted edits: Angular patterns, services, security notes. Treat suggestions as proposals and review changes before commit.

---

*CSI Nora · Singtel CSI enterprise chatbot experience*
