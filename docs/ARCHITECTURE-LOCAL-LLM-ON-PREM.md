# Local LLM on‑prem — architecture choices (reference)

Short decision guide: **hardware** (including **NPU**), **serving stack**, **where RAG lives**, **egress policy**, and **GPU / CPU / NPU** scaling. No implementation commitment — pick options when you build.

---

## 1. Target hardware (starting points)

| Profile | Typical use | GPU | CPU | RAM | Notes |
|--------|-------------|-----|-----|-----|--------|
| **Dev / pilot** | Few users, latency OK | 1× 24 GB VRAM (e.g. RTX 4090 / A10) or shared | 8+ cores | 32–64 GB | Fits 7B–13B class models quantized; good for proving RAG + prompts. |
| **Team production** | Concurrent chat | 1× 48–80 GB (A100 40/80, L40S) or **2× 24 GB** with tensor parallel | 16+ cores | 64–128 GB | 13B–34B or larger with room for KV cache + batching. |
| **CPU‑first / air‑gap light** | Offline, cost‑sensitive, low concurrency | None or optional add‑later | 32+ cores | 128 GB+ | Use **quantized CPU** inference (llama.cpp / Ollama CPU); expect **higher latency** and **lower throughput** than GPU. |
| **Scale‑out** | Many seats | **Multiple GPUs** same pool (Kubernetes + device plugin) | Per node as above | Per node | Horizontal **replicas** of inference pods; **load balancer** in front. |
| **NPU‑capable node** | Low power, edge, or “AI PC” class servers | Optional; often **no discrete GPU** | CPU + **integrated NPU** (e.g. Intel Core Ultra / Xeon with NPU, AMD Ryzen AI, Qualcomm) | 32–64 GB+ | Run **vendor‑optimized** or **INT8/quantized** small/medium models; stack is **less uniform** than CUDA (OpenVINO, ONNX Runtime EP, vendor SDKs). |

**Rule of thumb:** interactive quality and speed for **large** LLMs still track **GPU VRAM** and **memory bandwidth**. **CPU** scaling helps throughput of **smaller** models or **parallel** light jobs. **NPU** can improve **perf-per-watt** for **supported** models and tasks (embeddings, small LLMs, rerankers) but needs **explicit** runtime support — not a generic substitute for a datacenter GPU on day one.

---

### NPU compute (what it is, when to use it)

**NPU** (Neural Processing Unit) = on‑chip or discrete **accelerator** for neural net ops (often INT8), common on **client SoCs**, **AI PCs**, and increasingly **servers** with integrated AI engines.

| Aspect | Notes |
|--------|--------|
| **Strengths** | Lower **power** than GPU for suitable workloads; good for **edge** and **dense** CPU‑class nodes without adding GPUs; can offload **embeddings**, **classification**, or **small** LLMs when the stack supports it. |
| **Limits** | **Software fragmentation** (per‑vendor runtimes); not all **LLM** sizes and quant formats are supported; **throughput** for big models usually **below** a mid/high‑end **GPU**; ecosystem **behind** CUDA for large‑scale LLM serving. |
| **Typical roles on‑prem** | (1) **Embedding / rerank** on NPU, **generation** on GPU. (2) **Sole accelerator** on **branch / kiosk** nodes with small quantized models. (3) **Hybrid laptop / SOC** demos before datacenter GPUs arrive. |

**Scaling with NPU:** treat **NPU as a third pool** — nodes labeled for **NPU‑only** inference (supported models only), alongside **GPU** and **CPU** pools. Routing must be **capability‑based** (“this model + quant only runs on NPU profile X”), not blind round‑robin.

---

## 2. One serving stack (pick one primary)

| Option | Best for | Pros | Cons |
|--------|----------|------|------|
| **Ollama** | Fast on‑prem start, dev, single‑node | Simple ops; pulls models; REST; CPU + GPU; **NPU** depends on platform (e.g. some builds / backends) | Less ideal for **large‑scale multi‑tenant** SLAs; less fine‑grained than k8s‑native stacks. |
| **vLLM** | **Production** throughput, batched LLM serving | High throughput, PagedAttention, OpenAI‑compatible APIs common | Needs more **tuning** (K8s, GPUs); ops heavier than Ollama. |
| **TGI (Text Generation Inference)** | Hugging Face ecosystem, multi‑GPU | Mature for **transformers**, good for **multi‑GPU** | Hugging Face–centric; same k8s/GPU ops expectations as vLLM. |

**Practical split:** **Ollama** for pilot and small teams; **vLLM or TGI** when you need **strict SLAs**, **many concurrent users**, and **Kubernetes**‑based scaling.

---

## 3. Where RAG lives

| Layer | Where it runs | When to choose |
|-------|----------------|----------------|
| **A. App + API tier (same cluster as today)** | Angular/static front; **Node or Python API** does embed → retrieve → assemble context → call local LLM | Simplest story; one place for **auth**, **audit**, **prompt assembly**. |
| **B. Dedicated RAG / search service** | **Vector DB** (e.g. pgvector, Qdrant, Milvus) + embedder service; chat API calls retrieve API | When **document volume** and **concurrent queries** grow; easier to **scale retrieval** separately from generation. |
| **C. Embeddings on CPU, generation on GPU** | Small **embedding model** on CPU; **LLM** on GPU | Saves VRAM for the large model; may add **latency** if not pipelined. |
| **D. Embeddings or small models on NPU** | **Embedding** / rerank / tiny LLM on **NPU**; **main** chat on GPU | Reduces GPU load and **power** where vendor stack supports it; requires **validated** model formats and runtimes. |

**On‑prem principle:** keep **corpus and indexes** inside the trust boundary; **no** sending chunks to the public internet if policy is strict (see §4).

---

## 4. Egress policy: strict “no egress” vs optional cloud fallback

| Mode | Definition | Pros | Cons |
|------|------------|------|------|
| **Strict no egress** | Inference, embeddings, and RAG **never** call the internet; updates via **internal mirror** or **sneakernet** | Maximum **control** and **compliance** | You own **all** patches, model files, and break‑glass procedures. |
| **Optional cloud fallback** | Default **local**; cloud APIs only if **explicitly** enabled (feature flag, per‑tenant) | **Best quality** when allowed; **graceful** when GPU overloaded | **Data policy** must define what may leave the boundary; risk of **misconfiguration**. |
| **Hybrid by task** | e.g. **sensitive** RAG + local LLM only; **public** research allowed to cloud | Balance of **risk** and **quality** | Two code paths and **clear UX** (“this answer stayed on‑prem”). |

Document **one** default (usually strict local + optional toggle) and **who** can enable fallback.

---

## 5. GPU vs CPU vs NPU scaling (compute)

| Dimension | **GPU scaling** | **CPU scaling** | **NPU scaling** |
|-----------|------------------|------------------|-------------------|
| **What improves** | Tokens/sec, **latency**, larger models, bigger **batch** | **More parallel** small jobs; **no** accelerator cost | **Perf-per-watt** for **supported** graphs; **lighter** footprint at the edge |
| **How** | Add VRAM / multi‑GPU **tensor parallel**; **replicas** + LB | More **cores** / nodes; llama.cpp‑style **CPU** inference | More **NPU‑equipped** nodes or **firmware** that exposes NPU to runtime; **vendor** runtimes |
| **Tradeoff** | Higher **capex**; best UX for big LLMs | Cheapest nodes; **slowest** per heavy model | **Middle** ground for **small** models; **ops** cost to maintain **multiple** stacks |
| **Typical pattern** | **GPU pool** for primary chat LLM | **CPU pool** for embed, queue workers, **fallback** chat | **NPU pool** for **embed / rerank / small LLM** where validated |

**Scale across GPU, CPU, and NPU:** use **three pools** (or two if NPU unused): **GPU** for main generation, **CPU** for generic and fallback, **NPU** for **offload** workloads that match **hardware and runtime**. Route by **model manifest** (this quant + op set → GPU / CPU / NPU), not by user alone.

**Offline / no‑egress:** NPUs add **no** internet requirement; they are **local** accelerators. You still ship **drivers**, **runtime**, and **model** artifacts through your **air‑gap** update process like GPU firmware.

---

## 6. One‑page decision checklist (fill when you implement)

- [ ] Target **users** and **peak concurrent** chats (drives GPU count and serving stack).
- [ ] **Egress**: none / optional cloud / hybrid by sensitivity.
- [ ] **Serving**: Ollama (pilot) vs vLLM/TGI (production K8s).
- [ ] **RAG**: co‑located with API vs separate vector tier.
- [ ] **GPU vs CPU vs NPU**: which **pools** exist; which **models** land on which (manifests); **NPU** runtime (OpenVINO / ONNX EP / vendor).
- [ ] **Update path** for models, **GPU/NPU drivers**, and OS in **air‑gap** (mirror, USB, etc.).

---

*This document is planning-only; implementation stays deferred until you choose.*
