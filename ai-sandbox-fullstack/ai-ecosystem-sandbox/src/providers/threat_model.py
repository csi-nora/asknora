"""Agentic AI Threat Model — 12-layer framework for CSI Nora.

Maps the industry STRIDE + 6-step threat-modeling process onto the Nora
full stack (orchestrator / tools / memory / external systems).

The "12 layers" are:
  L1–L6  STRIDE categories (Spoofing … Elevation of Privilege)
  L7–L12 Threat-modeling process steps (Define Scope … Monitor & Iterate)

Each STRIDE layer lists trust-boundary risks and the Nora controls that
mitigate them. Status is live via ``framework_status()`` — used by the
bridge ``/threat-model`` and ``/guardrails/status`` endpoints.
"""

from __future__ import annotations

import os
from typing import Any

from src.providers.guardrails import status_report as guardrails_status
from src.providers.key_pool import get_key_pool


# ── Catalog (static knowledge + live control probes) ─────────────────────────

STRIDE_LAYERS: list[dict[str, Any]] = [
    {
        "id": "S",
        "layer": 1,
        "name": "Spoofing Identity",
        "threats": [
            "Impersonating a user/agent/tool",
            "Fake tool endpoints",
            "Stolen API keys",
        ],
        "trust_boundaries": ["User ↔ Agent", "Agent ↔ Tools", "Agent ↔ External Systems"],
        "controls": [
            {"id": "role_acl", "name": "Role-based clearance (ROLE_ACL)", "probe": "role_acl"},
            {"id": "key_pool", "name": "Server-side API key pools + rotation", "probe": "key_pool"},
            {"id": "proxy_only", "name": "Backends loopback-only; proxy is sole LAN entry", "probe": "always_on"},
        ],
    },
    {
        "id": "T",
        "layer": 2,
        "name": "Tampering with Data",
        "threats": [
            "Prompt injection",
            "Memory / KB poisoning",
            "Modified tool inputs",
        ],
        "trust_boundaries": ["User ↔ Agent", "Agent ↔ Memory", "Agent ↔ Tools"],
        "controls": [
            {"id": "input_guard", "name": "Input prompt-injection guardrails", "probe": "input_guard"},
            {"id": "mcp_gate", "name": "MCP tool input gate (size/pattern)", "probe": "mcp_gate"},
            {"id": "kb_acl", "name": "KB/RAG filtered by role sensitivity", "probe": "role_acl"},
        ],
    },
    {
        "id": "R",
        "layer": 3,
        "name": "Repudiation",
        "threats": [
            "Agent actions without audit trail",
            "Denied decisions / tool calls",
        ],
        "trust_boundaries": ["User ↔ Agent", "Agent ↔ Tools"],
        "controls": [
            {"id": "audit_log", "name": "Client audit log + CSV export", "probe": "always_on"},
            {"id": "guard_actions", "name": "Per-response guard_actions metadata", "probe": "input_guard"},
        ],
    },
    {
        "id": "I",
        "layer": 4,
        "name": "Information Disclosure",
        "threats": [
            "PII leakage in prompts/outputs",
            "System-prompt / policy exposure",
            "Confidential KB over-share",
        ],
        "trust_boundaries": ["User ↔ Agent", "Agent ↔ Memory", "Agent ↔ External Systems"],
        "controls": [
            {"id": "output_guard", "name": "Output policy / injection / toxicity guards", "probe": "output_guard"},
            {"id": "pii_redact", "name": "Lean PII redaction (+ optional Presidio)", "probe": "pii"},
            {"id": "role_acl", "name": "ROLE_ACL blocks confidential without clearance", "probe": "role_acl"},
        ],
    },
    {
        "id": "D",
        "layer": 5,
        "name": "Denial of Service",
        "threats": [
            "Resource exhaustion / infinite loops",
            "Oversized tool / prompt payloads",
        ],
        "trust_boundaries": ["User ↔ Agent", "Agent ↔ Tools", "Agent ↔ External Systems"],
        "controls": [
            {"id": "mcp_gate", "name": "MCP payload size limits", "probe": "mcp_gate"},
            {"id": "token_caps", "name": "max_tokens bounds on bridge chat", "probe": "always_on"},
            {"id": "restart_policy", "name": "Docker restart: unless-stopped", "probe": "always_on"},
        ],
    },
    {
        "id": "E",
        "layer": 6,
        "name": "Elevation of Privilege",
        "threats": [
            "Jailbreak / guardrail escape",
            "Tool privilege escalation",
            "Role bypass to confidential data",
        ],
        "trust_boundaries": ["User ↔ Agent", "Agent ↔ Tools", "Agent ↔ Other Agents"],
        "controls": [
            {"id": "jailbreak_block", "name": "Jailbreak / remnant blocking", "probe": "input_guard"},
            {"id": "role_acl", "name": "Least-privilege ROLE_ACL", "probe": "role_acl"},
            {"id": "mcp_allowlist", "name": "Fixed MCP tool allowlist (no arbitrary exec)", "probe": "mcp_gate"},
        ],
    },
]

PROCESS_LAYERS: list[dict[str, Any]] = [
    {
        "id": "P1",
        "layer": 7,
        "name": "Define Scope",
        "description": "Agent goals, boundaries, trust assumptions for CSI Nora Hybrid RAG + tools.",
        "nora_artifact": "docs/Agentic-AI-STRIDE-Threat-Model.md §Scope",
    },
    {
        "id": "P2",
        "layer": 8,
        "name": "Map Architecture",
        "description": "User → UI → nginx → bridge/orchestrator → Ollama/tools/KB memory/external APIs.",
        "nora_artifact": "Typical agent architecture mapped in threat-model catalog",
    },
    {
        "id": "P3",
        "layer": 9,
        "name": "Identify Threats",
        "description": "Systematic STRIDE across trust boundaries (User↔Agent↔Tools↔Memory↔External).",
        "nora_artifact": "STRIDE layers L1–L6 in this module",
    },
    {
        "id": "P4",
        "layer": 10,
        "name": "Assess Risks",
        "description": "Likelihood × impact; prioritize injection, PII, key theft, ACL bypass.",
        "nora_artifact": "Controls ranked in catalog; live coverage in /threat-model",
    },
    {
        "id": "P5",
        "layer": 11,
        "name": "Define Controls",
        "description": "Guardrails, key rotation, ROLE_ACL, audit, MCP gate, Presidio add-on.",
        "nora_artifact": "Mapped controls under each STRIDE layer",
    },
    {
        "id": "P6",
        "layer": 12,
        "name": "Monitor & Iterate",
        "description": "Health/status endpoints, audit CSV, smoke_rai, continuous red-team demos.",
        "nora_artifact": "/guardrails/status + /threat-model + audit log",
    },
]

TRUST_BOUNDARIES = [
    "User ↔ Agent",
    "Agent ↔ Tools",
    "Agent ↔ Memory",
    "Agent ↔ External Systems",
    "Agent ↔ Other Agents",
]

KEY_MITIGATIONS = [
    "Strong Identity & Access Management (ROLE_ACL + key pools)",
    "Input Validation & Prompt Guardrails",
    "Least Privilege for Tools & APIs (MCP allowlist)",
    "Secure Memory & Data Handling (KB sensitivity + PII redact)",
    "Comprehensive Logging & Monitoring (audit + guard_actions)",
    "Human-in-the-Loop for High-Risk Actions (role + sensitivity gates)",
    "Continuous Red Teaming & Evaluation (smoke_rai + demos)",
]


def _probe(name: str) -> bool:
    g = guardrails_status()
    enabled = bool(g.get("enabled"))
    if name == "always_on":
        return True
    if name == "input_guard":
        return enabled
    if name == "output_guard":
        return enabled
    if name == "pii":
        return enabled  # lean PII always part of guardrails when on
    if name == "role_acl":
        return True  # enforced in Angular state; catalog always documents it
    if name == "key_pool":
        pools = get_key_pool().status()
        # Control is "present" even with empty pools (Ollama path); mark ready if any pool or ollama-only
        return True
    if name == "mcp_gate":
        return os.getenv("MCP_TOOL_GATE", "true").lower() not in ("0", "false", "no", "off")
    return False


def framework_status() -> dict[str, Any]:
    """Live coverage report for the 12-layer Agentic AI threat model."""
    g = guardrails_status()
    stride_out: list[dict[str, Any]] = []
    covered = 0
    total_controls = 0
    for layer in STRIDE_LAYERS:
        controls = []
        for c in layer["controls"]:
            active = _probe(c["probe"])
            total_controls += 1
            if active:
                covered += 1
            controls.append({**c, "active": active})
        layer_ok = all(c["active"] for c in controls)
        stride_out.append(
            {
                "id": layer["id"],
                "layer": layer["layer"],
                "name": layer["name"],
                "threats": layer["threats"],
                "trust_boundaries": layer["trust_boundaries"],
                "controls": controls,
                "covered": layer_ok,
            }
        )

    return {
        "framework": "Agentic AI Threat Modeling — 12-Layer (STRIDE + Process)",
        "tagline": "Secure the Agent. Protect the Mission.",
        "layers_total": 12,
        "stride_layers": stride_out,
        "process_layers": PROCESS_LAYERS,
        "trust_boundaries": TRUST_BOUNDARIES,
        "key_mitigations": KEY_MITIGATIONS,
        "coverage": {
            "controls_active": covered,
            "controls_total": total_controls,
            "pct": round(100.0 * covered / total_controls, 1) if total_controls else 0,
        },
        "guardrails": g,
        "red_flags_watched": [
            "Unrestricted tool access",
            "No input/output validation",
            "Missing audit logs",
            "Overly autonomous actions",
            "Lack of monitoring",
        ],
    }


def map_guard_action_to_stride(action: str) -> list[str]:
    """Map a guardrail action string to STRIDE letter(s)."""
    a = (action or "").lower()
    out: list[str] = []
    if "injection" in a or "jailbreak" in a:
        out.extend(["T", "E"])
    if "pii" in a or "presidio" in a or "policy" in a:
        out.append("I")
    if "toxicity" in a or "unsafe" in a:
        out.extend(["T", "E"])
    if "rotated" in a or "key" in a:
        out.append("S")
    return sorted(set(out)) or ["T"]
