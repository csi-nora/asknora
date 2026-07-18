# Modern AI Ecosystem Sandbox

A **modular, reproducible sandbox** (Docker Compose + Python 3.11 venv) demonstrating a representative subset of the **Modern AI Ecosystem** — LLMs, agents, RAG, embeddings, vector DBs, memory, observability, automation, and security.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Demo interfaces: Jupyter Lab (:8888) · Streamlit (:8501)       │
├─────────────────────────────────────────────────────────────────┤
│  Python src/providers: llm · rag · agents · embeddings · tools  │
├──────────┬──────────┬──────────┬──────────┬───────────────────┤
│  Ollama  │  Qdrant  │  Chroma  │  Redis   │  Postgres+pgvector│
│  :11434  │  :6333   │  :8000   │  :6379   │  :5432            │
└──────────┴──────────┴──────────┴──────────┴───────────────────┘
         Optional profile: Langfuse (:3000) for self-hosted tracing
```

## Ecosystem coverage

| Category | Tools demonstrated |
|----------|-------------------|
| **LLM Layer** | OpenAI, Anthropic, Google Gemini, Groq, Ollama (Llama/Mistral) |
| **Agentic AI** | LangGraph, CrewAI, AutoGen, Semantic Kernel (via deps) |
| **RAG** | LangChain, LlamaIndex, Haystack, DSPy (deps) |
| **Embeddings** | OpenAI, Cohere, Voyage, Sentence-Transformers, BGE |
| **Vector DBs** | Chroma, Qdrant, pgvector, Redis cache |
| **Memory / Observability** | Redis, Zep (optional), LangSmith, Langfuse, Phoenix, TruLens |
| **Automation / Tools** | LangChain agents, DuckDuckGo, Wikipedia, MCP client |
| **Security** | Presidio PII, prompt-injection heuristics, Guardrails AI |

> Cloud API keys are **optional**. All demos fall back to **Ollama** when keys are absent.

## CSI Nora integration

Wire the Angular app (`../csi-nora-v2`) to this sandbox — see **[../docs/CSI-Nora-Sandbox-Integration.md](../docs/CSI-Nora-Sandbox-Integration.md)**.

```powershell
docker compose up -d
# optional: uvicorn apps.nora_bridge.main:app --port 8090
cd ..\csi-nora-v2; npm start   # provider: Ollama → /ollama/v1
```

---

## Compute scaling (CPU / GPU / NPU)

| Target | How to switch | What it does |
|--------|---------------|--------------|
| **CPU** | `.\scripts\set_accel.ps1 -Device cpu` | `OLLAMA_NUM_GPU=0` — portable default |
| **GPU** | `.\scripts\set_accel.ps1 -Device gpu` | NVIDIA passthrough + `OLLAMA_NUM_GPU=-1` |
| **NPU** | `.\scripts\set_accel.ps1 -Device npu` | Sets `OPENVINO_DEVICE=NPU` for Intel AI PC / OpenVINO |
| **Auto** | `ACCEL_DEVICE=auto` in `.env` | Probe: CUDA → ROCm → MPS → OpenVINO NPU → CPU |

**Streamlit UI:** sidebar → **Compute scale** → pick CPU / GPU / NPU → **Apply device**.

**Manual compose:**
```bash
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d   # needs NVIDIA toolkit
docker compose -f docker-compose.yml -f docker-compose.npu.yml up -d
```

**Probe from Python:**
```bash
python -c "from src.providers.device import status_report; import json; print(json.dumps(status_report('auto'), indent=2))"
```

> **Note:** Ollama accelerates well on **GPU**. **NPU** is best for OpenVINO IR models / embeddings on Intel AI PCs (`pip install openvino`). Chat remains on CPU unless a GPU is also available.

---

## Quick start

### Prerequisites

- Docker Desktop / Docker Compose v2
- Python 3.11+
- 8 GB+ RAM (16 GB recommended for full stack)
- Optional: NVIDIA GPU for faster Ollama inference

### 1. Clone & configure

```bash
cd ai-ecosystem-sandbox
cp .env.example .env
# Edit .env — add OPENAI_API_KEY etc. if available
```

### 2. One-command setup

**Windows (PowerShell):**
```powershell
.\scripts\setup.ps1
```

**Linux / macOS:**
```bash
bash scripts/setup.sh
```

**Manual:**
```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
docker compose up -d
bash scripts/pull_ollama_models.sh
```

### 3. Verify infrastructure

```bash
docker compose ps
pytest tests/test_infra_health.py -q
curl http://localhost:11434/api/tags
curl http://localhost:6333/readyz
```

### 4. Run demos

**Python scripts (fastest):**
```bash
python demos/run_01_llm.py
python demos/run_02_rag.py
python demos/run_03_agents.py
python demos/run_04_embeddings.py
python demos/run_05_memory_observability.py
python demos/run_06_tools.py
python demos/run_07_security.py
```

**Jupyter Lab:** http://localhost:8888 (token: `sandbox`) → open `demos/*.ipynb`

**Streamlit dashboard:**
```bash
# Option A — Docker profile
docker compose --profile dashboard up -d

# Option B — local venv
streamlit run dashboard/app.py
```
→ http://localhost:8501

---

## Docker Compose profiles

| Command | Services |
|---------|----------|
| `docker compose up -d` | Ollama, Qdrant, Chroma, Redis, Postgres |
| `docker compose --profile jupyter up -d --build` | + Jupyter Lab |
| `docker compose --profile observability up -d` | + Langfuse |
| `docker compose --profile dashboard up -d --build` | + Streamlit |

### Ports

| Service | Port | Purpose |
|---------|------|---------|
| Ollama | 11434 | Local LLMs |
| Qdrant | 6333 | Vector search |
| Chroma | 8000 | Vector store |
| Redis | 6379 | Session memory |
| Postgres | 5432 | pgvector |
| Jupyter | 8888 | Notebooks |
| Langfuse | 3000 | Tracing UI |
| Streamlit | 8501 | Unified dashboard |

---

## Environment variables

See [`.env.example`](.env.example). Key variables:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | GPT + embeddings |
| `ANTHROPIC_API_KEY` | Claude |
| `GOOGLE_API_KEY` | Gemini |
| `GROQ_API_KEY` | Groq fast inference |
| `OLLAMA_BASE_URL` | Default `http://localhost:11434` |
| `LANGSMITH_API_KEY` | LangChain tracing |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Self-hosted or cloud Langfuse |
| `ZEP_API_KEY` | Zep cloud memory (optional) |

Provider fallback order: `LLM_PROVIDER_ORDER=openai,anthropic,google,groq,ollama`

---

## Project layout

```
ai-ecosystem-sandbox/
├── docker-compose.yml
├── requirements.txt
├── .env.example
├── src/providers/          # Reusable library modules
├── demos/                  # Scripts + Jupyter notebooks
├── dashboard/app.py        # Streamlit UI
├── data/sample_docs/       # RAG sample corpus
├── infra/                  # Dockerfiles, Postgres init
├── scripts/                # setup.sh, pull_ollama_models.sh
└── tests/
```

---

## Extending the sandbox

1. **Add a provider** → implement in `src/providers/` and register in `config.py`
2. **Add a vector backend** → extend `vectorstores.py`
3. **Add a demo** → create `demos/run_XX_*.py` + notebook + Streamlit tab
4. **Optional heavy tools** → `pip install -r requirements-optional.txt` (Zep, W&B, EmbedChain, GraphRAG)

### MCP / FastMCP

The `mcp` package is included. Add MCP server configs under `infra/mcp/` (future extension point).

### GPU passthrough (Ollama)

Uncomment the `deploy.resources` GPU block in `docker-compose.yml` (Linux/WSL2 + NVIDIA).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Ollama model not found | `docker exec sandbox-ollama ollama pull llama3.1:8b` |
| Presidio PII scan skipped | `python -m spacy download en_core_web_sm` |
| CrewAI slow on CPU | Reduce agents or use Groq/OpenAI key |
| Out of memory | Stop optional containers; use smaller Ollama models |
| Port conflict | Change ports in `.env` |

---

## Security note

This is a **lab sandbox**. Do not load real NRIC, PHI, or production secrets. Use synthetic data only. Enable guardrails (`GUARDRAILS_ENABLED=true`) for demos involving user input.

---

## License

Internal / educational use. Adapt stack placeholders for your organisation's governance requirements (e.g. Singapore PDPA).
