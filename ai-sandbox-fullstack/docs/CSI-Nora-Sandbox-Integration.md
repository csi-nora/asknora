# CSI Nora ↔ AI Ecosystem Sandbox Integration

Connects the **CSI Nora** Angular app (`csi-nora-v2`) to the local **AI Ecosystem Sandbox** (Ollama, Qdrant, Streamlit, CPU/GPU/NPU scaling).

## Architecture

```
┌──────────────────────┐     proxy /ollama/*      ┌─────────────────┐
│  CSI Nora :4200      │ ───────────────────────► │  Ollama :11434  │
│  (Angular Hybrid RAG)│     OpenAI-compatible    │  llama3.2:1b    │
│                      │                          └─────────────────┘
│  Provider: Ollama    │     proxy /sandbox/*     ┌─────────────────┐
│  + in-browser RAG    │ ───────────────────────► │  Nora Bridge    │
└──────────────────────┘                          │  :8090 (opt.)   │
                                                  └─────────────────┘
```

## Quick start (lab)

### 1. Start sandbox infra

```powershell
cd C:\Users\admin\Downloads\csi-nora-hybridrag\ai-ecosystem-sandbox
docker compose up -d
# optional GPU:
# .\scripts\set_accel.ps1 -Device gpu
```

Ensure a model is available:

```powershell
docker exec sandbox-ollama ollama list
# if empty: docker exec sandbox-ollama ollama pull llama3.2:1b
```

### 2. (Optional) Start Nora bridge

Adds device probe + guardrails + `/v1/chat`:

```powershell
cd ai-ecosystem-sandbox
.\.venv\Scripts\Activate.ps1
pip install fastapi uvicorn
uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090
```

### 3. Start CSI Nora

```powershell
cd C:\Users\admin\Downloads\csi-nora-hybridrag\csi-nora-v2
npm install
npm start
```

Opens http://localhost:4200 with proxy:
- `/ollama` → `http://127.0.0.1:11434`
- `/sandbox` → `http://127.0.0.1:8090`

### 4. Configure in UI

1. Click the provider badge (header) → **Ollama (Sandbox)**
2. Base URL: `/ollama/v1` (default in dev)
3. Model: `llama3.2:1b` (or your pulled model)
4. Compute scale: Auto / CPU / GPU / NPU
5. **Test Connection** → should show ✅ Sandbox Ollama reachable
6. Chat with sector prompts — Hybrid RAG still runs in-browser; LLM is local

## What changed in Nora

| File | Change |
|------|--------|
| `models/index.ts` | `ollama` provider, `baseUrls`, `accelDevice` |
| `environment.ts` | Sandbox URLs + default provider `ollama` |
| `api.service.ts` | OpenAI-compat client for Ollama + accel options |
| `api-config-modal` | Ollama tab, base URL, compute scale |
| `proxy.conf.json` | CORS-free path to Ollama / bridge |
| `package.json` | `npm start` uses proxy |

## Providers

| Provider | Where | Key |
|----------|-------|-----|
| **Ollama (Sandbox)** | Local Docker | optional (`ollama`) |
| Anthropic / OpenAI / HF | Cloud | required |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Test Connection fails | `docker ps` — is `sandbox-ollama` up? |
| 404 on `/ollama/v1/models` | Proxy not active — use `npm start` (not plain `ng serve` without proxy) |
| Empty LLM replies | Pull model; for Qwen set thinking off (already sent for Ollama) |
| Want Streamlit demos | http://localhost:8501 (`streamlit run dashboard/app_lite.py`) |

## Security note

Lab only. Do not send real NRIC / PHI to local or cloud models without PDPA controls.
