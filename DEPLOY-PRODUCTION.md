# CSI Nora — Production deployment (consolidated)

Single entry point for **AI Enterprise Challenge** / enterprise production runs.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 18.x or 20.x LTS |
| npm | 9+ |
| Docker + Compose | Optional but recommended |

---

## Local Ubuntu laptop demo (no cloud)

For **demonstrations on your own machine** — no AWS, no tunnel:

```bash
npm install
npm run demo
```

Open **http://localhost:8080** in Firefox on the **same laptop**.

Full guide: [deploy/ubuntu-laptop/README.md](./deploy/ubuntu-laptop/README.md)

---

## Fastest path — Docker (recommended)

```bash
# 1. Install dependencies (first time)
npm install

# 2. Configure LLM provider keys (never commit this file)
cp deploy/docker/.env.example server/.env
# Edit server/.env — set ANTHROPIC_API_KEY, OPENAI_API_KEY, and/or HUGGINGFACE_API_KEY

# 3. Build and run production stack
npm run docker:up
```

Open **http://localhost:8080**

| Service | Role |
|---------|------|
| **web** (nginx :8080) | Angular SPA + `/api/*` reverse proxy |
| **api** (gateway :3456) | Server-side LLM keys, proxies to providers |

Stop: `npm run docker:down`

---

## Single-process Node (no Docker)

```bash
npm install
cp server/.env.example server/.env    # add provider keys
npm run prod                           # build + start on :8080
```

Uses `server/production.cjs` — serves `dist/csi-nora/browser` and `/api/llm/*` on one port.

---

## Offline release bundle (VM handoff / air-gap)

```bash
npm run package:prod
# With public origin baked in (VM / nginx same host):
npm run package:prod -- --origin=https://203.0.113.10
```

Output: `release/csi-nora-<version>-<timestamp>/` with `browser/`, `server/`, Docker configs, and `RUN-PRODUCTION.md`.

---

## Static-only deploy (Netlify / S3 / CloudFront)

```bash
npm run build
# Publish folder: dist/csi-nora/browser
```

Root `netlify.toml` is preconfigured. SPA fallback is required for Angular routes (`/ask-nora`, `/aichatops`, `/governance`, `/both`).

For server-side keys, deploy the **Docker** or **Node production** stack instead.

---

## VM + public IP (nginx)

```bash
CSI_NORA_PUBLIC_ORIGIN=https://YOUR_IP npm run build:vm
# Copy dist/csi-nora/browser → /var/www/csi-nora/browser
# Use deploy/vm-public-ip/nginx-csi-nora.conf
npm run gateway                         # LLM gateway on :3456
```

Or use `scripts/deploy-laptop.ps1` on Windows.

---

## Product experiences (routes)

| Experience | URL |
|------------|-----|
| Launcher | `/` |
| Ask Nora (Hybrid RAG) | `/ask-nora` |
| Agentic governance | `/governance` |
| **CSI Nora AIChatOps** | `/aichatops` |
| Both | `/both` |

---

## Health & smoke test

```bash
curl http://localhost:8080/
curl http://localhost:8080/api/health
npm run test:uat
```

---

## Security checklist

- [ ] `server/.env` not in git (use `.env.example` templates only)
- [ ] Provider API keys only on server when using gateway / Docker / production.cjs
- [ ] HTTPS at ingress (nginx TLS, CloudFront, or corporate load balancer)
- [ ] CORS limited to known web origins in production
- [ ] Audit trail reviewed for AIChatOps destructive actions (human approval gates)

---

## External storage scaling (browser)

CSI Nora scales session persistence beyond the ~5 MB localStorage budget using a tiered model: **localStorage → IndexedDB → Origin Private File System (OPFS) → user-linked external folder** (USB stick or DASD mount). Browsers cannot detect USB plug events without user permission; after a one-time **Connect folder** grant (banner or info panel), the app stores a `FileSystemDirectoryHandle` in IndexedDB and **implicitly reconnects on startup** when the volume is still connected and permission is granted. Mirrored JSON files live under `.csi-nora/` on the external volume (session, docs, audit, prefs — not raw API keys). OPFS mirrors activate automatically in Chromium-based browsers with no user action.

---

## More detail

| Document | Purpose |
|----------|---------|
| [deploy/OPERATIONS-RUNBOOK.md](./deploy/OPERATIONS-RUNBOOK.md) | AWS, sovereign cloud, on-prem runbooks |
| [deploy/docker/](./deploy/docker/) | Dockerfiles + compose |
| [docs/PUBLIC-URL-TUNNEL-DEPLOY.md](./docs/PUBLIC-URL-TUNNEL-DEPLOY.md) | Tunnels & public URL |
| [presentation material/](./presentation%20material/) | AI Enterprise Challenge pitch |
