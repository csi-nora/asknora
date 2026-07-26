# Agentic AI Threat Modeling — 12-Layer Framework (CSI Nora)

**Secure the Agent. Protect the Mission.**

This document maps the industry Agentic AI threat-modeling approach (STRIDE +
6-step process = **12 layers**) onto the CSI Nora full stack.

Live status: `GET http://localhost:9090/sandbox/threat-model`

---

## Architecture (trust boundaries)

```
User / External Event
        │
        ▼
┌───────────────────┐
│  Angular UI       │  ROLE_ACL · audit · sensitivity
└─────────┬─────────┘
          │  User ↔ Agent
          ▼
┌───────────────────┐
│  nginx proxy      │  sole LAN entry (0.0.0.0:9090)
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  Nora Bridge      │  Orchestrator / BFF — guardrails · key rotation
│  (Agent Brain)    │
└───┬─────┬─────┬───┘
    │     │     │
    ▼     ▼     ▼
 Ollama  MCP   KB Memory
 Tools   Tools (Postgres+Qdrant)
    │             │
    └──────┬──────┘
           ▼
    External Systems (cloud LLMs, web search, Wikipedia)
```

Trust boundaries enforced: **User↔Agent**, **Agent↔Tools**, **Agent↔Memory**,
**Agent↔External Systems**, **Agent↔Other Agents** (future multi-agent).

---

## Layers L1–L6 — STRIDE

| L | ID | Threat focus | Nora controls |
|---|----|--------------|---------------|
| 1 | **S** Spoofing | Fake tools, stolen keys, impersonation | ROLE_ACL, key pools + rotation, loopback backends |
| 2 | **T** Tampering | Prompt injection, KB poisoning, tool input abuse | Input guardrails, MCP tool gate, KB sensitivity filter |
| 3 | **R** Repudiation | Actions without trail | Audit log + CSV, `guard_actions` on responses |
| 4 | **I** Info disclosure | PII / policy / confidential leak | Output guards, PII redact (+ optional Presidio), ROLE_ACL |
| 5 | **D** Denial of service | Exhaustion, oversized payloads | MCP size limits, `max_tokens` caps, Docker restart policy |
| 6 | **E** Elevation | Jailbreak, tool privilege escape | Jailbreak block, least-privilege ACL, fixed MCP allowlist |

---

## Layers L7–L12 — Threat-modeling process

| L | Step | Nora artifact |
|---|------|---------------|
| 7 | Define Scope | This doc §Scope — Hybrid RAG advisor + tools |
| 8 | Map Architecture | Diagram above |
| 9 | Identify Threats | STRIDE catalog in `src/providers/threat_model.py` |
| 10 | Assess Risks | Coverage % on `/threat-model` |
| 11 | Define Controls | Guardrails, keys, ACL, audit, MCP gate, Presidio |
| 12 | Monitor & Iterate | `/guardrails/status`, audit UI, `smoke_rai.py` |

---

## Key mitigations (implemented)

1. Strong IAM — role clearance + server key pools  
2. Input validation & prompt guardrails  
3. Least privilege for tools (MCP allowlist + gate)  
4. Secure memory — KB sensitivity + PII redaction  
5. Logging & monitoring — audit + guard metadata  
6. Human-in-the-loop — sensitivity / role gates before chat & RAG  
7. Continuous evaluation — RAI smoke + security demos  

---

## Red flags watched

Unrestricted tools · no I/O validation · missing audit · over-autonomy · no monitoring  

---

## API

```bash
curl http://localhost:9090/sandbox/threat-model
curl http://localhost:9090/sandbox/guardrails/status   # includes coverage summary
```

UI: right-hand **🛡️ STRIDE · 12-Layer** panel (live coverage chips S–E).
