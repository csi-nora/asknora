"""AI security guardrails: Presidio PII + prompt injection heuristics."""

from __future__ import annotations

import re
from dataclasses import dataclass

from src.config import get_settings

_INJECTION_PATTERNS = [
    r"ignore (all )?(previous|prior) instructions",
    r"disregard (your|the) (system|safety)",
    r"reveal (your|the) (system )?prompt",
    r"jailbreak",
    r"developer mode",
]


@dataclass
class GuardResult:
    allowed: bool
    reason: str
    sanitized_text: str | None = None


def check_prompt_injection(text: str) -> GuardResult:
    s = get_settings()
    if not s.guardrails_enabled:
        return GuardResult(True, "guardrails disabled", text)
    lowered = text.lower()
    for pat in _INJECTION_PATTERNS:
        if re.search(pat, lowered):
            return GuardResult(False, f"blocked: prompt injection pattern ({pat})")
    return GuardResult(True, "ok", text)


def scan_pii(text: str) -> GuardResult:
    s = get_settings()
    if not s.guardrails_enabled:
        return GuardResult(True, "guardrails disabled", text)
    try:
        from presidio_analyzer import AnalyzerEngine

        analyzer = AnalyzerEngine()
        results = analyzer.analyze(text=text, language="en")
        if results:
            types = sorted({r.entity_type for r in results})
            return GuardResult(False, f"blocked: detected PII types {types}")
        return GuardResult(True, "ok", text)
    except Exception as exc:
        # Presidio may need spaCy model download on first run
        return GuardResult(True, f"pii scan skipped ({exc})", text)


def guard_input(text: str) -> GuardResult:
    for fn in (check_prompt_injection, scan_pii):
        res = fn(text)
        if not res.allowed:
            return res
    return GuardResult(True, "ok", text)


def guard_output(text: str) -> GuardResult:
    return scan_pii(text)
