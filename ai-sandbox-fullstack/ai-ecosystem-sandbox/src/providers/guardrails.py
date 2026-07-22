"""AI security guardrails: input injection + lean output middleware (Responsible AI).

Designed to stay dependency-light for the Nora bridge image (no Presidio required).
Microsoft Presidio is an **optional add-on**, toggled with:

  PRESIDIO_ENABLED=true|false   (default: false)
  INSTALL_PRESIDIO=1            (Docker build-arg — installs the packages)

When enabled AND installed, Presidio runs as an extra PII pass after the lean regex rules.
When enabled but not installed, lean regex still runs; status reports ``presidio_active=false``.

Output middleware runs AFTER the LLM response and BEFORE it is returned to the client:
  * policy / confidentiality leak blocking
  * prompt-injection remnant blocking
  * lightweight toxicity / unsafe-content blocking
  * PII redaction (email, phone, SG NRIC, card-like digits) — redact rather than hard-block
  * optional Presidio anonymization (when toggled on)
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache


def _enabled() -> bool:
    return os.getenv("GUARDRAILS_ENABLED", "true").lower() not in ("0", "false", "no", "off")


def _presidio_enabled() -> bool:
    """Explicit opt-in toggle for the Presidio add-on (default off)."""
    return os.getenv("PRESIDIO_ENABLED", "false").lower() in ("1", "true", "yes", "on")


@lru_cache(maxsize=1)
def _presidio_available() -> bool:
    try:
        import presidio_analyzer  # noqa: F401
        import presidio_anonymizer  # noqa: F401
        return True
    except Exception:
        return False


_INJECTION_PATTERNS = [
    r"ignore (all )?(previous|prior) instructions",
    r"disregard (your|the) (system|safety)",
    r"reveal (your|the) (system )?prompt",
    r"jailbreak",
    r"developer mode",
    r"bypass (all )?security",
    r"override (the )?system",
]

_POLICY_LEAK = [
    "pricing confidential",
    "customer contract details",
    "reveal all data",
    "internal cost sheet",
    "nric list",
]

_TOXICITY = [
    r"\bkill yourself\b",
    r"\bhow to make a bomb\b",
    r"\bmake a bomb\b",
    r"\bchild sexual\b",
    r"\bterrorist attack plan\b",
]

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
    message: str | None = None
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


def _run_presidio(text: str) -> tuple[str, list[str]]:
    """Apply Presidio anonymization when the add-on is toggled on and installed."""
    if not _presidio_enabled():
        return text, []
    if not _presidio_available():
        return text, ["presidio_skipped:not_installed"]
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_anonymizer import AnonymizerEngine

        analyzer = AnalyzerEngine()
        hits = analyzer.analyze(text=text, language="en")
        if not hits:
            return text, ["presidio_ok:no_entities"]
        anonymizer = AnonymizerEngine()
        out = anonymizer.anonymize(text=text, analyzer_results=hits).text
        types = sorted({r.entity_type for r in hits})
        return out, [f"presidio_redacted:{','.join(types)}"]
    except Exception as exc:  # pragma: no cover — defensive
        return text, [f"presidio_error:{type(exc).__name__}"]


def redact_pii(text: str) -> GuardResult:
    """Redact common PII patterns; optionally run Presidio when toggled on."""
    if not _enabled():
        return GuardResult(True, "guardrails disabled", text)
    out = text
    actions: list[str] = []
    for label, pat in _PII_RULES:
        if pat.search(out):
            out = pat.sub(f"[REDACTED_{label}]", out)
            actions.append(f"pii_redacted:{label}")

    # Optional Presidio add-on (explicit toggle).
    out, p_actions = _run_presidio(out)
    actions.extend(p_actions)

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
    red = redact_pii(text)
    return GuardResult(True, red.reason, red.sanitized_text or text, actions=list(red.actions))


def guard_output(text: str) -> GuardResult:
    """Output middleware: block unsafe/policy content, then redact PII (+ optional Presidio)."""
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
    enabled = _enabled()
    p_on = _presidio_enabled()
    p_avail = _presidio_available()
    return {
        "enabled": enabled,
        "checks": [
            "input_prompt_injection",
            "output_policy_leak",
            "output_injection_remnant",
            "output_toxicity",
            "output_pii_redaction",
            "output_presidio_pii",  # only active when toggle + packages
        ],
        "presidio": {
            "enabled": p_on,
            "available": p_avail,
            "active": bool(enabled and p_on and p_avail),
            "toggle_env": "PRESIDIO_ENABLED",
            "install_hint": (
                "Set PRESIDIO_ENABLED=true and rebuild the bridge with "
                "INSTALL_PRESIDIO=1 (see apps/nora_bridge/requirements-presidio.txt)."
            ),
        },
    }
