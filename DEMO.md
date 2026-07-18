# CSI Nora — Ready-to-Demo Guide

Two ways to demonstrate this project straight from GitHub.

---

## 1. Full stack in GitHub Codespaces (recommended)

Runs the **entire app** (Angular UI + Ollama + vector DBs + bridge + Streamlit)
behind an nginx reverse proxy, in a cloud dev container — no local install.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/csi-nora/asknora?quickstart=1)

**Steps**

1. Click the badge (or **Code ▸ Codespaces ▸ Create codespace**). Pick a
   **4-core / 8 GB** machine.
2. Wait for the automated setup (`.devcontainer/postCreate.sh`) to finish — it
   builds the UI, starts the Docker stack, and pulls a small model
   (`llama3.2:1b`). First run takes a few minutes.
3. In the **PORTS** tab, open port **9090** (globe icon).

**What you get on port 9090**

| Path | Serves |
|------|--------|
| `/` | CSI Nora UI |
| `/ollama/` | Ollama LLM API |
| `/sandbox/` | Nora bridge (guardrails + CPU/GPU/NPU scaling) |
| `/streamlit/` | Streamlit dashboard |
| `/healthz` | proxy health |

In the UI provider settings, keep **Ollama (Sandbox)** with Base URL
`/ollama/v1` and model `llama3.2:1b`, then chat — answers come from the local
model running in your Codespace.

> Re-run setup any time with: `bash .devcontainer/postCreate.sh`

---

## 2. Live UI on GitHub Pages

A static, public link to the CSI Nora interface:

**https://csi-nora.github.io/asknora/**

Published automatically by `.github/workflows/pages.yml` on every push to
`main` that touches the UI.

**One-time setup (repo admin):** Settings ▸ **Pages** ▸ Source = **GitHub
Actions**. After the next push to `main`, the site goes live.

> Pages hosts the **front end only** — there is no Ollama backend on Pages.
> To get working chat on the Pages demo, open the provider settings and enter a
> cloud LLM API key (OpenAI / Anthropic / Google / Groq). In-browser Hybrid RAG
> (retrieval) works without any backend. For a full local-LLM demo, use
> Codespaces (option 1).

---

## Run it locally

```bash
cd ai-sandbox-fullstack/csi-nora-v2 && npm install && npm run build
cd ../ai-ecosystem-sandbox
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
# open http://localhost/  (Windows: add PROXY_HTTP_PORT=9090 if 80/8080 are reserved)
```

See `ai-sandbox-fullstack/DEPLOY.md` and
`ai-sandbox-fullstack/ai-ecosystem-sandbox/reverse-proxy/README.md` for details.
