# Local Ubuntu laptop demo

Run CSI Nora **entirely on your laptop** for demonstrations. No AWS, no cloud tunnel, no public IP required.

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Ubuntu** (or Debian-based Linux) | 22.04 / 24.04 recommended |
| **Node.js** | 18.x or 20.x LTS — [nodejs.org](https://nodejs.org/) |
| **npm** | Comes with Node |
| **Firefox / Chrome** | On the **same** machine |

Verify:

```bash
node -v    # v18.x or v20.x
npm -v
```

---

## Quick start (recommended)

From the project root:

```bash
git clone https://github.com/csi-nora/asknora.git
cd asknora
npm run demo
```

Then open **http://localhost:8080** in Firefox on your laptop.

| Route | URL |
|-------|-----|
| Launcher | http://localhost:8080/ |
| Ask Nora | http://localhost:8080/ask-nora |
| AIChatOps | http://localhost:8080/aichatops |
| Governance | http://localhost:8080/governance |

Stop the server with **Ctrl+C**.

---

## Optional: LLM provider keys (server-side)

For gateway mode (keys not in the browser):

```bash
cp server/.env.example server/.env
nano server/.env   # set OPENAI_API_KEY, ANTHROPIC_API_KEY, and/or HUGGINGFACE_API_KEY
npm run demo
```

---

## Alternative: Docker on laptop

If Docker is installed locally:

```bash
npm install
cp deploy/docker/.env.example server/.env   # add keys
npm run docker:up
```

Open **http://localhost:8080** — nginx + API gateway containers.

Stop: `npm run docker:down`

---

## Alternative: dev server (live reload)

For Angular development with hot reload:

```bash
npm install
npm start
```

Open **http://localhost:4200** (not 8080).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **Firefox: Unable to connect** | Run `npm run demo` on the **same** laptop; do not use a cloud agent URL or tunnel. |
| **Port 8080 in use** | `CSI_NORA_DEMO_PORT=8081 npm run demo` |
| **`node` not found** | Install Node 20 LTS and reopen the terminal. |
| **Missing `dist/`** | Run `npm run build` (requires full Angular source tree). |
| **LLM calls fail** | Add keys to `server/.env` and restart `npm run demo`. |

---

## What runs locally

| Component | Port | Role |
|-----------|------|------|
| `server/production.cjs` | **8080** | Angular SPA + `/api/llm/*` gateway |
| Pre-built `dist/csi-nora/browser` | — | Static app assets |

**Billing:** No AWS charges. You may incur LLM API usage if keys are configured.
