# Runbook: Production AI Agent Stack — Install & Setup

| Field | Value |
|-------|-------|
| **Document ID** | RUN-AGENT-001 |
| **Version** | 1.0 |
| **Audience** | ML Engineers, Backend, SRE, Security, Product |
| **Context** | Healthcare / SME — Singapore (PDPA-aligned); works with local ODS AI server or cloud HF |
| **Status** | Production-ready template |
| **Review cadence** | Quarterly + after model / tool changes |

> **How to use:** Complete each **Checkpoint** before the next phase. Replace `[PLACEHOLDER]` with your values. Prefer **local model serving** (Ollama / ODS llama-server) for sensitive data; use Hugging Face Inference only when residency and DPA allow.

---

## 0) Stack map (what you are installing)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Models          Llama 3.3 · Mistral · Gemma · Qwen3 · Phi-4            │
│  Serving         Ollama  |  Hugging Face  |  ODS llama-server (:11434)  │
│  Backend         FastAPI / Flask  ·  Metaflow (pipelines)               │
│  Retrieval       Vector store + embeddings + RAG pipeline               │
│  Memory          Session / thread state + optional long-term store      │
│  Safety          Guardrails AI · policy filters · tool allowlists       │
│  Observability   Traceloop / OpenTelemetry · eval harness               │
│  Agents / tools  OpenDevin-style coding agent · API tools · automation  │
│  Deploy          Docker · reverse proxy · secrets · SLOs                │
└─────────────────────────────────────────────────────────────────────────┘
```

| Layer | Reference components | Your default (adapt) |
|-------|----------------------|----------------------|
| Models | Llama 3.3, Mistral, Gemma, Qwen3, Phi-4 | Small CPU: Phi-4 / Qwen3-2B; GPU: Llama 3.3 / Mistral |
| Serving | Ollama, Hugging Face, FastAPI/Flask, Metaflow | Local: Ollama **or** ODS at `http://192.168.1.60:11434` |
| Retrieval / memory | Vector DB + app state | Qdrant / Chroma / pgvector |
| Safety / monitoring | Guardrails AI, Traceloop, OpenDevin | Guardrails + OTel traces |
| Deploy | Docker + backend | Compose or K8s |

---

## 1) Install the foundation

### 1.1 Host prerequisites

| Tool | Min version | Purpose |
|------|-------------|---------|
| Python | 3.11+ | App + pipelines |
| Git | 2.40+ | Source control |
| Docker + Compose | 24+ | Services |
| (Optional) CUDA / ROCm | Vendor current | Local GPU inference |
| (Optional) ODS Ubuntu guest | Bridged LAN | Shared model API on LAN |

**Windows (PowerShell)**

```powershell
python --version
git --version
docker --version
docker compose version
```

**Ubuntu / ODS guest**

```bash
sudo apt-get update
sudo apt-get install -y python3.12 python3.12-venv git curl jq
# Docker: https://get.docker.com  (already present on ODS-Ubuntu if you used that path)
```

### 1.2 Project layout + venv

```bash
mkdir -p ~/ai-agent-stack && cd ~/ai-agent-stack
python3 -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
pip install -U pip wheel setuptools

mkdir -p apps/{api,worker} libs/{rag,safety,otel} data/{docs,indexes} configs scripts deploy
```

**`requirements.txt` (baseline — pin in lockfile for prod)**

```text
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
flask>=3.0.0
httpx>=0.27.0
pydantic>=2.8.0
pydantic-settings>=2.4.0
python-dotenv>=1.0.0
qdrant-client>=1.11.0
sentence-transformers>=3.0.0
guardrails-ai>=0.5.0
opentelemetry-api>=1.26.0
opentelemetry-sdk>=1.26.0
opentelemetry-exporter-otlp>=1.26.0
traceloop-sdk>=0.33.0
metaflow>=2.12.0
openai>=1.40.0
```

```bash
pip install -r requirements.txt
```

### Checkpoint 1

- [ ] Python / Git / Docker verified  
- [ ] Venv active; `pip list` shows FastAPI, httpx  
- [ ] No secrets in git (`.env` in `.gitignore`)

---

## 2) Set up the model server

Install serving **first**. Everything else calls this endpoint.

### 2.A Option A — Ollama (local)

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh
# Windows / Mac: install from https://ollama.com/download

ollama serve   # if not already a service
ollama pull llama3.3
# Alternatives: mistral, gemma2, qwen2.5, phi3  (names evolve — check `ollama list`)
ollama run llama3.3 "Reply with exactly: OK"
```

OpenAI-compatible base URL: `http://127.0.0.1:11434/v1`

### 2.B Option B — Hugging Face Inference (managed)

```bash
export HF_TOKEN="[HF_TOKEN]"   # store in Vault / Secret Manager — never commit
# Use OpenAI-compatible HF router or Inference Endpoints for your chosen model
```

Only when: DPA signed, region acceptable (prefer EU/SG if available), no prohibited health data without DPIA.

### 2.C Option C — ODS / Dream Server (your LAN)

If Osmantic ODS is already running on the Ubuntu guest:

| Service | URL |
|---------|-----|
| Local API (llama-server) | `http://192.168.1.60:11434` |
| Open WebUI | `http://192.168.1.60:3000` |
| Bind | `0.0.0.0` (LAN) |

```bash
curl -sS http://192.168.1.60:11434/v1/models | jq .
curl -sS http://192.168.1.60:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"[MODEL_ID]","messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":16}'
```

### 2.D Env template

```bash
# configs/.env.example → copy to .env
LLM_BASE_URL=http://192.168.1.60:11434/v1
LLM_API_KEY=sk-local-not-needed
LLM_MODEL=qwen3.5-2b
# Or Ollama:
# LLM_BASE_URL=http://127.0.0.1:11434/v1
# LLM_MODEL=llama3.3
```

### 2.E Smoke test (Python)

```python
# scripts/smoke_llm.py
import os, httpx
from dotenv import load_dotenv
load_dotenv("configs/.env")

base = os.environ["LLM_BASE_URL"].rstrip("/")
r = httpx.post(
    f"{base}/chat/completions",
    headers={"Authorization": f"Bearer {os.getenv('LLM_API_KEY','sk-local')}"},
    json={
        "model": os.environ["LLM_MODEL"],
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 16,
    },
    timeout=60.0,
)
r.raise_for_status()
print(r.json()["choices"][0]["message"]["content"])
```

```bash
python scripts/smoke_llm.py
```

### Checkpoint 2

- [ ] Model endpoint returns a completion  
- [ ] Latency / OOM acceptable for chosen tier  
- [ ] Prod path does not send PII to public HF without approval  

---

## 3) Add retrieval and memory

### 3.1 Index documents

```bash
mkdir -p data/docs
# Drop PDFs / Markdown / TXT into data/docs
```

**Minimal RAG indexer (embeddings + Qdrant)**

```python
# scripts/index_docs.py — outline
# 1. Load files from data/docs
# 2. Chunk (512–1024 tokens, 10–15% overlap)
# 3. Embed with sentence-transformers or TEI / ODS embeddings (:8090 if enabled)
# 4. Upsert into Qdrant collection `kb_main`
```

Docker Qdrant (if not using ODS Qdrant on `:6333`):

```bash
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant:latest
```

### 3.2 Wire retrieval into the agent

Flow per request:

1. Embed user query  
2. Top-k search (`k=4–8`) with metadata filters (tenant, sector, sensitivity)  
3. Build grounded prompt: system policy + retrieved chunks + user message  
4. Call LLM  
5. Cite sources in response  

### 3.3 Memory / state

| Type | Store | TTL |
|------|-------|-----|
| Session chat | Redis or Postgres JSON | 24–72h |
| User preferences | Postgres | Policy-driven |
| Long-term facts | Vector + curated KB | Stewards only |

Do **not** persist raw NRIC / clinical free-text in memory without classification and retention rules.

### Checkpoint 3

- [ ] ≥1 document indexed; retrieval returns relevant chunks  
- [ ] Agent answers change when KB changes (grounding check)  
- [ ] Session continuity works across 2+ turns  

---

## 4) Add safety and monitoring

### 4.1 Guardrails AI (input / output)

```python
# libs/safety/guards.py — pattern
from guardrails import Guard
# Define: topic allowlist, PII detection, toxic content, max tool hops
# Fail closed on policy violation → return safe message + log reason code
```

Policy starters (healthcare / SME SG):

| Rule | Action |
|------|--------|
| Prompt injection patterns | Block + audit |
| Request for raw NRIC / full clinical dump | Refuse |
| Tool calls outside allowlist | Deny |
| Hallucinated citations | Flag / regenerate with “cite or say unknown” |

### 4.2 Traceloop / OpenTelemetry

```python
# apps/api/main.py — early init
from traceloop.sdk import Traceloop
Traceloop.init(app_name="ai-agent-stack", disable_batch=False)
# Export OTLP to Jaeger / Grafana Tempo / vendor
```

Trace at minimum: `retrieve` → `llm.completion` → `tool.call` → `guardrail.check`.

### 4.3 OpenDevin / coding-agent governance

If you run an OpenDevin-style agent:

- Sandbox filesystem + network egress allowlist  
- No production credentials in agent env  
- Human approval for `apply_patch` / deploy actions  
- Separate non-prod cluster  

### 4.4 Eval harness (pre-prod gate)

| Eval | Pass bar |
|------|----------|
| Groundedness (sample 50 Qs) | ≥ 80% cited correctly |
| Safety red-team set | 0 critical escapes |
| Latency p95 | Within SLO (e.g. ≤ 5s local) |
| Cost / tokens | Budget envelope |

### Checkpoint 4

- [ ] Guardrails block a known injection prompt  
- [ ] Traces visible in backend for one end-to-end request  
- [ ] Red-team checklist signed off  

---

## 5) Connect tools and deploy

### 5.1 Tool / action layer

Register tools with explicit schemas (OpenAI tools / JSON schema):

```text
search_kb(query, filters)
create_ticket(summary, severity)      # allowlist only
lookup_order(order_id)                # read-only CRM/HIS API
# Forbidden by default: shell, arbitrary HTTP, DB write
```

### 5.2 Backend service (FastAPI preferred)

```python
# apps/api/main.py — skeleton
from fastapi import FastAPI
app = FastAPI(title="AI Agent API", version="1.0.0")

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

@app.post("/v1/chat")
async def chat(body: dict):
    # 1) guardrails input
    # 2) retrieve
    # 3) llm
    # 4) guardrails output
    # 5) return {answer, citations, trace_id}
    ...
```

Flask is fine for simple services; prefer FastAPI for async + OpenAPI in new work.

### 5.3 Metaflow (batch / offline pipelines)

Use Metaflow for: nightly re-index, eval jobs, model bake-offs — not for every chat request.

```bash
python pipelines/reindex_flow.py run
```

### 5.4 Docker deploy

```dockerfile
# deploy/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps apps
COPY libs libs
COPY configs configs
ENV PYTHONUNBUFFERED=1
CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
```

```yaml
# deploy/docker-compose.yml
services:
  agent-api:
    build: ..
    ports: ["8080:8080"]
    env_file: ../configs/.env
    restart: unless-stopped
```

```bash
docker compose -f deploy/docker-compose.yml up -d --build
curl -sS http://127.0.0.1:8080/healthz
```

Expose `0.0.0.0` only behind auth / reverse proxy on trusted LAN. For public Internet: TLS + SSO + WAF.

### Checkpoint 5

- [ ] Tool allowlist enforced in code + tests  
- [ ] `/healthz` and one authenticated chat work in Compose  
- [ ] Secrets via env/Vault; image has no `.env` baked in  

---

## 6) Example setup order (rollout)

| Step | Action | Exit criteria |
|------|--------|---------------|
| 1 | Install Python, Git, Docker | Versions OK |
| 2 | Run Ollama **or** point to ODS / HF | `smoke_llm.py` prints OK |
| 3 | FastAPI/Flask skeleton | `/healthz` 200 |
| 4 | Retrieval + memory | Grounded answer from your docs |
| 5 | Guardrails + Traceloop | Block + trace visible |
| 6 | Tools + deploy | Compose up; integration test green |

**Suggested timeline (SME):** Day 1 foundation+LLM · Day 2 RAG · Day 3 safety/otel · Day 4 tools+deploy · Day 5 hardening/game day.

---

## 7) SLIs / SLOs (drop into SRE docs)

| SLI | SLO (starter) |
|-----|----------------|
| Chat success rate | ≥ 99.5% (excl. client 4xx) |
| End-to-end p95 latency | ≤ 5 s (local LLM) / ≤ 3 s (GPU) |
| Retrieval hit rate (eval set) | ≥ 85% |
| Guardrail false-negative on critical red-team | 0 |
| Model endpoint availability | ≥ 99.5% |

**Page:** model endpoint down, success rate drop, guardrail service down.  
**Ticket:** elevated latency, eval drift, disk for indexes.

---

## 8) Singapore / PDPA notes

- Prefer **local serving** (Ollama / ODS) for personal / health-adjacent data.  
- Classify fields before indexing; hash or exclude NRIC-class identifiers.  
- Log access to sensitive prompts; retain per retention policy.  
- Cross-border HF / US endpoints → DPIA + transfer basis before go-live.  
- Align vendor DPAs (HF, cloud vector DB, tracing SaaS) with your DPO.

---

## 9) Mapping to your current lab

| Already have (ODS Ubuntu) | Agent stack use |
|---------------------------|-----------------|
| `http://192.168.1.60:11434` | `LLM_BASE_URL` |
| Open WebUI `:3000` | Manual chat / UAT |
| Qdrant `:6333` (if enabled) | Vector store |
| Embeddings `:8090` (if enabled) | Optional embed API |
| LiteLLM `:4000` | Multi-model gateway |

Login (guest): `ods` / `OdsLocal2026!` · Bridged LAN IP may change; re-check with `vmrun getGuestIPAddress` if needed.

---

## 10) Go-live checklist

- [ ] Owners + on-call named  
- [ ] Model + RAG + safety + traces in prod-like env  
- [ ] Red-team + groundedness eval archived  
- [ ] Backup of indexes + restore tested  
- [ ] Rollback: previous image tag + prior model tag  
- [ ] Runbook links on alerts  

---

## Appendix A — Quick commands cheat sheet

```bash
# Activate
cd ~/ai-agent-stack && source .venv/bin/activate

# LLM smoke
python scripts/smoke_llm.py

# Re-index
python scripts/index_docs.py

# API local
uvicorn apps.api.main:app --reload --host 127.0.0.1 --port 8080

# Deploy
docker compose -f deploy/docker-compose.yml up -d --build
```

## Appendix B — Document control

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-07-16 | Initial production template from agent-stack guide |

## Sources (orientation)

1–2. Industry / social posts describing layered AI agent stacks (models, serving, retrieval, safety, monitoring, tools, deploy) naming Llama 3.3, Mistral, Gemma, Qwen3, Phi-4, Ollama, Hugging Face, Metaflow, Flask, Guardrails AI, Traceloop, OpenDevin.
