"""MCP tool gate — least-privilege / DoS / tampering mitigations for tool calls.

Enabled by default (MCP_TOOL_GATE=true). Blocks oversized or injection-like
tool arguments before they reach ``tool_impls``.
"""

from __future__ import annotations

import os
import re
from typing import Callable

_MAX_LEN = int(os.getenv("MCP_TOOL_MAX_ARG_LEN", "2000"))
_INJECTION = re.compile(
    r"(ignore (all )?(previous|prior) instructions|jailbreak|bypass (all )?security|"
    r"reveal (your|the) (system )?prompt|;\s*rm\s+-|`[^`]+`|\$\()",
    re.I,
)


def gate_enabled() -> bool:
    return os.getenv("MCP_TOOL_GATE", "true").lower() not in ("0", "false", "no", "off")


def check_arg(name: str, value: str) -> str | None:
    """Return an error message if the argument is rejected, else None."""
    if not gate_enabled():
        return None
    if value is None:
        return f"{name}: empty argument"
    if len(value) > _MAX_LEN:
        return f"{name}: exceeds max length {_MAX_LEN} (DoS / Tampering control)"
    if _INJECTION.search(value):
        return f"{name}: blocked by MCP tool gate (prompt-injection / unsafe pattern)"
    return None


def guarded(tool_fn: Callable[..., str], **kwargs: str) -> str:
    for k, v in kwargs.items():
        err = check_arg(k, v if isinstance(v, str) else str(v))
        if err:
            return f"⚠️ MCP tool gate: {err}"
    return tool_fn(**kwargs)
