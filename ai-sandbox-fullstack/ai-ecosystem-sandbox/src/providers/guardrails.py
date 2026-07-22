"""AI security guardrails: input injection + lean output middleware (Responsible AI).

Designed to stay dependency-light for the Nora bridge image (no Presidio required).
Presidio is used when available (full sandbox venv) as an optional extra PII pass.

Output middleware runs AFTER the LLM response and BEFORE it is returned to the client:
  * policy / confidentiality leak blocking
  * prompt-injection remnant blocking
  * lightweight toxicity / unsafe-content blocking
  * PII redaction (email, phone, SG NRIC, card-like digits) — redact rather than hard-block
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

# Soft toggle (env); defaults on.
def _enabled() -> bool:
    return os.getenv("GUARDRAILS_ENABLED", "true").lower() not in ("0", "false", "no", "off")


_INJECTION_PATTERNS = [
    r"ignore (all )?(previous|prior) instructions",
    r"disregard (your|the) (system|safety)",
    r"reveal (your|the) (system )?prompt",
    r"jailbreak",
    r"developer mode",
    r"bypass (all )?security",
    r"override (the )?system",
]

# Phrases that should never appear in model output (policy / confidential).
_POLICY_LEAK = [
    "pricing confidential",
    "customer contract details",
    "reveal all data",
    "internal cost sheet",
    "nric list",
]

# Lightweight toxicity / unsafe content (deterministic keyword gate — demo-grade).
_TOXICITY = [
    r"\bkill yourself\b",
    r"\bhow to make a bomb\b",
    r"\bmake a bomb\b",
    r"\bchild sexual\b",
    r"\bterrorist attack plan\b",
]

# Lean PII patterns (Singapore-aware where practical).
_PII_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("NRIC", re.compile(r"\b[STFGstfg]\d{7}[A-Za-z]\b")),
    ("PHONE_SG", re.compile(r"\b(?:\+65[-\s]?)?[689]\d{3}[-\s]?\d{4}\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]*?){13,19}\b")),
]


@dataclass
class GuardResult:
    allowed: bool
    reason: str
    sanitized_text: str | None = None
    message: str | None = None  # client-facing text when blocked
    actions: list[str] = field(default_factory=list)


def check_prompt_injection(text: str) -> GuardResult:
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)
    lowered = text.lower()
    for pat in _INJECTION_PATTERNS:
        if re.search(pat, lowered):
            return GuardResult(
                False,
                f"blocked: prompt injection pattern ({pat})",
                message="⚠️ Request blocked by input guardrails (prompt injection).",
                actions=["input_injection_blocked"],
            )
    return GuardResult(True, "ok", text)


def redact_pii(text: str) -> GuardResult:
    """Redact common PII patterns in-place (output middleware)."""
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)
    out = text
    actions: list[str] = []
    for label, pat in _PII_RULES:
        if pat.search(out):
            out = pat.sub(f"[REDACTED_{label}]", out)
            actions.append(f"pii_redacted:{label}")
    # Optional Presidio pass when installed (full sandbox); never required for bridge.
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_anonymizer import AnonymizerEngine

        analyzer = AnalyzerEngine()
        hits = analyzer.analyze(text=out, language="en")
        if hits:
            anonymizer = AnonymizerEngine()
            out = anonymizer.anonymize(text=out, analyzer_results=hits).text
            types = sorted({r.entity_type for r in hits})
            actions.append(f"presidio_redacted:{','.join(types)}")
    except Exception:
        pass
    if actions:
        return GuardResult(True, "redacted: " + ", ".join(actions), out, actions=actions)
    return GuardResult(True, "ok", out)


def check_policy_leak(text: str) -> GuardResult:
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)
    lowered = text.lower()
    for phrase in _POLICY_LEAK:
        if phrase in lowered:
            return GuardResult(
                False,
                f"blocked: policy phrase ({phrase})",
                message="⚠️ Response restricted by output guardrails (confidential policy).",
                actions=["policy_leak_blocked"],
            )
    return GuardResult(True, "ok", text)


def check_injection_remnants(text: str) -> GuardResult:
    """Catch jailbreak / system-prompt leak phrases that slipped into the answer."""
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)
    lowered = text.lower()
    for pat in _INJECTION_PATTERNS:
        if re.search(pat, lowered):
            return GuardResult(
                False,
                f"blocked: injection remnant ({pat})",
                message="⚠️ Response restricted by output guardrails (unsafe instruction remnant).",
                actions=["injection_remnant_blocked"],
            )
    return GuardResult(True, "ok", text)


def check_toxicity(text: str) -> GuardResult:
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)
    lowered = text.lower()
    for pat in _TOXICITY:
        if re.search(pat, lowered):
            return GuardResult(
                False,
                f"blocked: unsafe content ({pat})",
                message="⚠️ Response restricted by output guardrails (unsafe content).",
                actions=["toxicity_blocked"],
            )
    return GuardResult(True, "ok", text)


def guard_input(text: str) -> GuardResult:
    res = check_prompt_injection(text)
    if not res.allowed:
        return res
    # Input-side lean PII: redact before it reaches the model (don't hard-block demos).
    red = redact_pii(text)
    return GuardResult(True, red.reason, red.sanitized_text or text, actions=list(red.actions))


def guard_output(text: str) -> GuardResult:
    """Output middleware: block unsafe/policy content, then redact PII."""
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)

    for fn in (check_policy_leak, check_injection_remnants, check_toxicity):
        res = fn(text)
        if not res.allowed:
            return res

    red = redact_pii(text)
    if red.actions:
        return GuardResult(
            True,
            red.reason,
            red.sanitized_text,
            message=red.sanitized_text,
            actions=list(red.actions),
        )
    return GuardResult(True, "ok", text)


def status_report() -> dict:
    return {
        "enabled": _enabled(),
        "checks": [
            "input_prompt_injection",
            "output_policy_leak",
            "output_injection_remnant",
            "output_toxicity",
            "output_pii_redaction",
        ],
        "presidio_optional": True,
    }
