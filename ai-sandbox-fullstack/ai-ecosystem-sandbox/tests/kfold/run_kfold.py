#!/usr/bin/env python3
"""K-fold (k=5) full-stack evaluation harness for CSI Nora @ proxy :9090.

Usage (from ai-ecosystem-sandbox root or any cwd):
  .venv/Scripts/python.exe tests/kfold/run_kfold.py
  .venv/Scripts/python.exe tests/kfold/run_kfold.py --base http://localhost:9090 --k 5

Writes:
  tests/kfold/results/kfold_report.json
  tests/kfold/results/kfold_report.md
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import socket
import statistics
import sys
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HERE = Path(__file__).resolve().parent
CASES_PATH = HERE / "cases.json"
RESULTS_DIR = HERE / "results"
DEFAULT_BASE = "http://localhost:9090"
DEFAULT_MODEL = os.getenv("LLM_MODEL_OLLAMA", "llama3.2:1b")


# ── HTTP helpers (stdlib; httpx used when available for better HTTP/1.1) ─────────
def _http_request(
    method: str,
    url: str,
    *,
    body: dict | list | None = None,
    timeout: float = 30.0,
    headers: dict[str, str] | None = None,
    read_partial: int | None = None,
) -> tuple[int, str, float, bool]:
    """Return (status, body_text, latency_ms, is_flake_retry)."""
    data = None
    hdrs = {"Accept": "*/*", **(headers or {})}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs.setdefault("Content-Type", "application/json")

    # Prefer httpx when present (correct HTTP/1.1 for Chroma, etc.)
    try:
        import httpx

        t0 = time.perf_counter()
        timeout_cfg = httpx.Timeout(timeout)
        with httpx.Client(timeout=timeout_cfg, follow_redirects=True) as client:
            if read_partial is not None and method.upper() == "GET":
                chunks: list[bytes] = []
                status_code = 0
                try:
                    with client.stream("GET", url, headers=hdrs) as resp:
                        status_code = resp.status_code
                        for chunk in resp.iter_bytes():
                            chunks.append(chunk)
                            if sum(len(c) for c in chunks) >= read_partial:
                                break
                        # SSE streams forever — close without draining the rest.
                        resp.close()
                except (httpx.ReadTimeout, httpx.RemoteProtocolError):
                    # First-event read succeeded; timeout on idle stream is expected.
                    if not chunks:
                        raise
                text = b"".join(chunks).decode("utf-8", "replace")
                ms = (time.perf_counter() - t0) * 1000
                return status_code or 200, text, ms, False
            r = client.request(method.upper(), url, content=data, headers=hdrs)
            ms = (time.perf_counter() - t0) * 1000
            return r.status_code, r.text, ms, False
    except ImportError:
        pass

    req = Request(url, data=data, headers=hdrs, method=method.upper())
    t0 = time.perf_counter()
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read(read_partial) if read_partial else resp.read()
            ms = (time.perf_counter() - t0) * 1000
            return resp.status, raw.decode("utf-8", "replace"), ms, False
    except HTTPError as e:
        raw = e.read() if hasattr(e, "read") else b""
        ms = (time.perf_counter() - t0) * 1000
        return e.code, raw.decode("utf-8", "replace"), ms, False


def _with_retry(
    fn,
    *,
    timeout: float,
    retry_timeout: float | None = None,
) -> tuple[Any, bool]:
    """Run fn(timeout=...); on timeout/connection error retry once with longer timeout."""
    try:
        return fn(timeout), False
    except (TimeoutError, socket.timeout, URLError, OSError) as first:
        try:
            import httpx

            transient = (httpx.TimeoutException, httpx.TransportError)
        except ImportError:
            transient = ()
        if transient and isinstance(first, transient):
            pass
        elif not isinstance(first, (TimeoutError, socket.timeout, URLError, OSError)):
            raise
        t2 = retry_timeout or (timeout * 2.5)
        try:
            return fn(t2), True
        except Exception as second:
            raise second from first


def _jp(obj: Any, dotted: str) -> Any:
    cur = obj
    for part in dotted.split("."):
        if cur is None:
            return None
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _parse_json(text: str) -> Any:
    try:
        return json.loads(text)
    except Exception:
        return None


def _answer_from_completions(data: dict) -> str:
    try:
        return (data["choices"][0]["message"]["content"] or "")
    except Exception:
        return ""


# ── Shared KB fixtures (seeded once per run) ────────────────────────────────────
_SHARED: dict[str, Any] = {}


def ensure_shared_kb(base: str) -> None:
    if _SHARED.get("seeded"):
        return
    doc_id = f"kfold-shared-{uuid.uuid4().hex[:8]}"
    keyword = "KFOLD_SHARED_BETA_TOKEN"
    content = (
        f"CSI Nora evaluation document. Unique token {keyword}. "
        "Singapore PDPA and MAS TRM apply to enterprise portfolio guidance."
    )
    payload = {
        "id": doc_id,
        "name": "kfold-shared-beta.md",
        "type": "text/markdown",
        "size": len(content),
        "sensitivity": "internal",
        "content": content,
        "chunks": [
            {
                "id": f"{doc_id}-c0",
                "docId": doc_id,
                "docName": "kfold-shared-beta.md",
                "content": content,
                "sensitivity": "internal",
            }
        ],
    }
    status, text, _, _ = _http_request(
        "POST", f"{base}/sandbox/kb/documents", body=payload, timeout=30
    )
    _SHARED["seeded"] = True
    _SHARED["doc_id"] = doc_id
    _SHARED["keyword"] = keyword
    _SHARED["upsert_ok"] = status < 300
    _SHARED["upsert_body"] = text[:300]


def cleanup_shared_kb(base: str) -> None:
    doc_id = _SHARED.get("doc_id")
    if not doc_id:
        return
    try:
        _http_request("DELETE", f"{base}/sandbox/kb/documents/{doc_id}", timeout=15)
    except Exception:
        pass


# ── Case executors ──────────────────────────────────────────────────────────────
def exec_http(case: dict, base: str) -> dict[str, Any]:
    method = case.get("method", "GET")
    path = case["path"]
    timeout = float(case.get("timeout", 15))
    body = case.get("body")

    def run(t: float):
        return _http_request(method, f"{base}{path}", body=body, timeout=t)

    (status, text, ms, _), flake = _with_retry(run, timeout=timeout)
    data = _parse_json(text)
    return {
        "status": status,
        "text": text,
        "json": data,
        "latency_ms": ms,
        "flake": flake,
        "answer": None,
    }


def exec_chat(case: dict, base: str) -> dict[str, Any]:
    timeout = float(case.get("timeout", 120))
    body = dict(case.get("body") or {})
    body.setdefault("provider", "ollama")
    if not body.get("model"):
        body["model"] = DEFAULT_MODEL

    def run(t: float):
        return _http_request("POST", f"{base}{case['path']}", body=body, timeout=t)

    (status, text, ms, _), flake = _with_retry(run, timeout=timeout, retry_timeout=min(timeout * 1.5, 240))
    data = _parse_json(text) or {}
    return {
        "status": status,
        "text": text,
        "json": data,
        "latency_ms": ms,
        "flake": flake,
        "answer": data.get("answer") if isinstance(data, dict) else None,
    }


def exec_chat_completions(case: dict, base: str) -> dict[str, Any]:
    timeout = float(case.get("timeout", 120))
    body = dict(case.get("body") or {})
    body.setdefault("model", DEFAULT_MODEL)
    body.setdefault("nora_provider", "ollama")

    def run(t: float):
        return _http_request("POST", f"{base}{case['path']}", body=body, timeout=t)

    (status, text, ms, _), flake = _with_retry(run, timeout=timeout, retry_timeout=min(timeout * 1.5, 240))
    data = _parse_json(text) or {}
    answer = _answer_from_completions(data) if isinstance(data, dict) else ""
    return {
        "status": status,
        "text": text,
        "json": data,
        "latency_ms": ms,
        "flake": flake,
        "answer": answer,
    }


def exec_redis_ping(case: dict, base: str) -> dict[str, Any]:
    _ = base
    t0 = time.perf_counter()
    ok = False
    detail = ""
    try:
        import redis

        r = redis.from_url("redis://127.0.0.1:6379/0", socket_timeout=float(case.get("timeout", 5)))
        ok = bool(r.ping())
        detail = "PONG"
    except Exception as exc:
        detail = f"{type(exc).__name__}: {exc}"
    return {
        "status": 200 if ok else 503,
        "text": detail,
        "json": {"ping": ok},
        "latency_ms": (time.perf_counter() - t0) * 1000,
        "flake": False,
        "answer": None,
    }


def exec_mcp_sse(case: dict, base: str) -> dict[str, Any]:
    timeout = float(case.get("timeout", 6))

    def run(t: float):
        return _http_request(
            "GET",
            f"{base}{case['path']}",
            timeout=t,
            headers={"Accept": "text/event-stream"},
            read_partial=512,
        )

    try:
        (status, text, ms, _), flake = _with_retry(run, timeout=timeout, retry_timeout=timeout + 4)
    except Exception as exc:
        return {
            "status": 0,
            "text": f"{type(exc).__name__}: {exc}",
            "json": None,
            "latency_ms": timeout * 1000,
            "flake": True,
            "answer": None,
        }
    return {
        "status": status,
        "text": text,
        "json": None,
        "latency_ms": ms,
        "flake": flake,
        "answer": None,
    }


def exec_kb_roundtrip(case: dict, base: str) -> dict[str, Any]:
    exp = case.get("expect") or {}
    keyword = exp.get("keyword") or f"KFOLD_{uuid.uuid4().hex[:10].upper()}"
    doc_id = f"kfold-rt-{uuid.uuid4().hex[:10]}"
    content = (
        f"Hybrid RAG evaluation chunk containing {keyword}. "
        "This document validates sparse FTS retrieval in Postgres."
    )
    t0 = time.perf_counter()
    evidence: dict[str, Any] = {"doc_id": doc_id, "keyword": keyword}

    up_status, up_text, _, _ = _http_request(
        "POST",
        f"{base}/sandbox/kb/documents",
        body={
            "id": doc_id,
            "name": f"{doc_id}.txt",
            "type": "text/plain",
            "size": len(content),
            "sensitivity": "internal",
            "content": content,
            "chunks": [
                {
                    "id": f"{doc_id}-c0",
                    "docId": doc_id,
                    "docName": f"{doc_id}.txt",
                    "content": content,
                    "sensitivity": "internal",
                }
            ],
        },
        timeout=float(case.get("timeout", 40)),
    )
    evidence["upsert_status"] = up_status
    evidence["upsert_snippet"] = up_text[:200]

    q_status, q_text, _, _ = _http_request(
        "POST",
        f"{base}/sandbox/kb/query",
        body={"query": keyword, "mode": "sparse", "topK": 5, "minScore": 0.0},
        timeout=20,
    )
    q_data = _parse_json(q_text) or []
    hit = False
    if isinstance(q_data, list):
        blob = json.dumps(q_data)
        hit = keyword in blob or doc_id in blob
    evidence["query_status"] = q_status
    evidence["query_hit"] = hit
    evidence["query_count"] = len(q_data) if isinstance(q_data, list) else 0
    evidence["query_snippet"] = q_text[:300]

    del_status, del_text, _, _ = _http_request(
        "DELETE", f"{base}/sandbox/kb/documents/{doc_id}", timeout=15
    )
    del_json = _parse_json(del_text) or {}
    evidence["delete_status"] = del_status
    evidence["delete_removed"] = bool(del_json.get("removed", 0)) if isinstance(del_json, dict) else False

    gone = True
    if exp.get("gone_after_delete"):
        _, list_text, _, _ = _http_request("GET", f"{base}/sandbox/kb/documents", timeout=15)
        lst = _parse_json(list_text) or []
        if isinstance(lst, list):
            gone = all((d.get("id") if isinstance(d, dict) else None) != doc_id for d in lst)
        evidence["gone_after_delete"] = gone

    ms = (time.perf_counter() - t0) * 1000
    return {
        "status": up_status,
        "text": json.dumps(evidence)[:800],
        "json": evidence,
        "latency_ms": ms,
        "flake": False,
        "answer": None,
    }


def exec_kb_sparse_hit(case: dict, base: str) -> dict[str, Any]:
    ensure_shared_kb(base)
    exp = case.get("expect") or {}
    keyword = exp.get("keyword") or _SHARED.get("keyword") or ""
    k = int(exp.get("hit_at_k", 5))
    t0 = time.perf_counter()
    status, text, ms, _ = _http_request(
        "POST",
        f"{base}/sandbox/kb/query",
        body={"query": keyword, "mode": "sparse", "topK": k, "minScore": 0.0},
        timeout=float(case.get("timeout", 30)),
    )
    data = _parse_json(text) or []
    hit = False
    rank = None
    if isinstance(data, list):
        for i, item in enumerate(data):
            blob = json.dumps(item)
            if keyword in blob or _SHARED.get("doc_id", "") in blob:
                hit = True
                rank = i + 1
                break
    evidence = {
        "hit": hit,
        "rank": rank,
        "hit_at_k": k,
        "keyword": keyword,
        "shared_upsert_ok": _SHARED.get("upsert_ok"),
        "result_count": len(data) if isinstance(data, list) else 0,
    }
    return {
        "status": status,
        "text": text[:400],
        "json": evidence,
        "latency_ms": (time.perf_counter() - t0) * 1000 if ms else ms,
        "flake": False,
        "answer": None,
    }


def exec_kb_acl_filter(case: dict, base: str) -> dict[str, Any]:
    """Seed confidential doc; public sensitivity list should miss it; confidential list should hit."""
    doc_id = f"kfold-acl-{uuid.uuid4().hex[:8]}"
    token = f"KFOLD_ACL_{uuid.uuid4().hex[:8].upper()}"
    content = f"Confidential clearance note {token} for engineers only."
    t0 = time.perf_counter()
    _http_request(
        "POST",
        f"{base}/sandbox/kb/documents",
        body={
            "id": doc_id,
            "name": "acl-confidential.txt",
            "type": "text/plain",
            "size": len(content),
            "sensitivity": "confidential",
            "content": content,
            "chunks": [
                {
                    "id": f"{doc_id}-c0",
                    "docId": doc_id,
                    "docName": "acl-confidential.txt",
                    "content": content,
                    "sensitivity": "confidential",
                }
            ],
        },
        timeout=30,
    )
    # public / internal roles cannot see confidential
    _, pub_text, _, _ = _http_request(
        "POST",
        f"{base}/sandbox/kb/query",
        body={
            "query": token,
            "mode": "sparse",
            "topK": 5,
            "sensitivities": ["public", "internal"],
        },
        timeout=20,
    )
    pub = _parse_json(pub_text) or []
    pub_hit = token in json.dumps(pub)

    # engineer / support clearance includes confidential
    _, eng_text, _, _ = _http_request(
        "POST",
        f"{base}/sandbox/kb/query",
        body={
            "query": token,
            "mode": "sparse",
            "topK": 5,
            "sensitivities": ["public", "internal", "confidential"],
        },
        timeout=20,
    )
    eng = _parse_json(eng_text) or []
    eng_hit = token in json.dumps(eng)

    _http_request("DELETE", f"{base}/sandbox/kb/documents/{doc_id}", timeout=15)
    evidence = {
        "public_hit": pub_hit,
        "engineer_hit": eng_hit,
        "public_role_misses_confidential": not pub_hit,
        "engineer_role_hits_confidential": eng_hit,
        "token": token,
        "doc_id": doc_id,
    }
    return {
        "status": 200,
        "text": json.dumps(evidence),
        "json": evidence,
        "latency_ms": (time.perf_counter() - t0) * 1000,
        "flake": False,
        "answer": None,
    }


EXECUTORS = {
    "http": exec_http,
    "chat": exec_chat,
    "chat_completions": exec_chat_completions,
    "redis_ping": exec_redis_ping,
    "mcp_sse": exec_mcp_sse,
    "kb_roundtrip": exec_kb_roundtrip,
    "kb_sparse_hit": exec_kb_sparse_hit,
    "kb_acl_filter": exec_kb_acl_filter,
}


# ── Scoring ─────────────────────────────────────────────────────────────────────
def score_case(case: dict, result: dict[str, Any]) -> tuple[bool, list[str]]:
    exp = case.get("expect") or {}
    fails: list[str] = []
    status = result.get("status")
    text = result.get("text") or ""
    data = result.get("json")
    answer = result.get("answer")

    if "status" in exp and status not in exp["status"]:
        fails.append(f"status {status} not in {exp['status']}")

    if "ping" in exp:
        ping = (data or {}).get("ping") if isinstance(data, dict) else False
        if bool(ping) != bool(exp["ping"]):
            fails.append(f"ping expected {exp['ping']} got {ping}")

    if "json_equals" in exp and isinstance(data, dict):
        for k, v in exp["json_equals"].items():
            if data.get(k) != v:
                fails.append(f"json[{k}]={data.get(k)!r} != {v!r}")

    if "json_path_equals" in exp and isinstance(data, dict):
        for path, v in exp["json_path_equals"].items():
            got = _jp(data, path)
            if got != v:
                fails.append(f"path {path}={got!r} != {v!r}")

    if "json_path_not_equals" in exp and isinstance(data, dict):
        for path, v in exp["json_path_not_equals"].items():
            got = _jp(data, path)
            if got == v:
                fails.append(f"path {path} unexpectedly equals {v!r}")

    if "json_path_truthy" in exp and isinstance(data, dict):
        for path in exp["json_path_truthy"]:
            if not _jp(data, path):
                fails.append(f"path {path} not truthy")

    if "json_path_min_len" in exp and isinstance(data, dict):
        for path, n in exp["json_path_min_len"].items():
            got = _jp(data, path)
            if not isinstance(got, (list, str, dict)) or len(got) < n:
                fails.append(f"path {path} len < {n}")

    if "json_list_contains" in exp and isinstance(data, dict):
        for key, needle in exp["json_list_contains"].items():
            lst = data.get(key) or []
            if needle not in lst:
                fails.append(f"{key} missing {needle!r} (got {lst!r})")

    if "body_contains" in exp:
        for needle in exp["body_contains"]:
            if needle not in text:
                fails.append(f"body missing {needle!r}")

    if "body_contains_any" in exp:
        if not any(n in text for n in exp["body_contains_any"]):
            fails.append(f"body missing any of {exp['body_contains_any']}")

    if "is_json_array" in exp and exp["is_json_array"]:
        if not isinstance(data, list):
            fails.append("expected JSON array")

    if "json_array_len" in exp:
        if not isinstance(data, list) or len(data) != exp["json_array_len"]:
            fails.append(f"array len != {exp['json_array_len']}")

    if "min_answer_len" in exp:
        a = answer if answer is not None else (
            data.get("answer") if isinstance(data, dict) else ""
        )
        if not isinstance(a, str) or len(a.strip()) < exp["min_answer_len"]:
            fails.append("answer too short")

    if "answer_not_contains" in exp:
        a = answer or ""
        for needle in exp["answer_not_contains"]:
            if needle in a:
                fails.append(f"answer still contains {needle!r}")

    if "answer_contains_any" in exp:
        a = answer or ""
        if not any(n in a for n in exp["answer_contains_any"]):
            # also check nora metadata / full body for scrub evidence
            if not any(n in text for n in exp["answer_contains_any"]):
                fails.append(f"answer missing any of {exp['answer_contains_any']}")

    if exp.get("nora_guarded_or_redacted"):
        a = answer or ""
        nora = (data or {}).get("nora") if isinstance(data, dict) else {}
        actions = []
        if isinstance(nora, dict):
            actions = list(nora.get("guard_actions") or [])
        scrubbed = "[REDACTED" in a or "[REDACTED" in text or any("pii" in str(x).lower() for x in actions)
        guarded = bool((nora or {}).get("guarded")) if isinstance(nora, dict) else False
        leaked = "alice@singtel.com" in a or "alice@singtel.com" in (answer or "")
        if leaked:
            fails.append("PII email leaked in answer")
        elif not (scrubbed or guarded or "alice@singtel.com" not in text):
            fails.append("expected redaction, guard metadata, or non-echo of PII")

    if "coverage_pct_gte" in exp and isinstance(data, dict):
        pct = _jp(data, "coverage.pct")
        if pct is None or float(pct) < float(exp["coverage_pct_gte"]):
            fails.append(f"coverage.pct {pct} < {exp['coverage_pct_gte']}")

    # kind-specific evidence checks
    kind = case.get("kind")
    if kind == "kb_roundtrip" and isinstance(data, dict):
        if data.get("upsert_status") not in (exp.get("upsert_status") or [200]):
            fails.append(f"upsert_status {data.get('upsert_status')}")
        if exp.get("query_hit") and not data.get("query_hit"):
            fails.append("query_hit false")
        if exp.get("delete_removed") and not data.get("delete_removed"):
            fails.append("delete_removed false")
        if exp.get("gone_after_delete") and not data.get("gone_after_delete", True):
            fails.append("doc still listed after delete")

    if kind == "kb_sparse_hit" and isinstance(data, dict):
        if not data.get("hit"):
            fails.append(f"hit@{exp.get('hit_at_k', '?')} miss for {data.get('keyword')}")

    if kind == "kb_acl_filter" and isinstance(data, dict):
        if exp.get("public_role_misses_confidential") and not data.get(
            "public_role_misses_confidential"
        ):
            fails.append("public role incorrectly retrieved confidential")
        if exp.get("engineer_role_hits_confidential") and not data.get(
            "engineer_role_hits_confidential"
        ):
            fails.append("engineer role missed confidential doc")

    return len(fails) == 0, fails


# ── Stratified k-fold ───────────────────────────────────────────────────────────
def stratified_folds(cases: list[dict], k: int, seed: int = 42) -> list[list[dict]]:
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for c in cases:
        by_cat[c.get("category", "other")].append(c)
    rng = random.Random(seed)
    for cat in by_cat:
        rng.shuffle(by_cat[cat])

    folds: list[list[dict]] = [[] for _ in range(k)]
    for cat, items in sorted(by_cat.items()):
        for i, item in enumerate(items):
            folds[i % k].append(item)
    # keep deterministic order within fold
    for f in folds:
        f.sort(key=lambda c: c["id"])
    return folds


def run_case(case: dict, base: str) -> dict[str, Any]:
    kind = case.get("kind", "http")
    executor = EXECUTORS.get(kind)
    if not executor:
        return {
            "id": case["id"],
            "category": case.get("category"),
            "pass": False,
            "skipped": True,
            "errors": [f"unknown kind {kind}"],
            "latency_ms": 0,
            "flake": False,
            "evidence": "",
        }
    try:
        result = executor(case, base)
        ok, errs = score_case(case, result)
        snippet = (result.get("text") or "")[:240].replace("\n", " ")
        return {
            "id": case["id"],
            "category": case.get("category"),
            "name": case.get("name"),
            "pass": ok,
            "skipped": False,
            "errors": errs,
            "latency_ms": round(result.get("latency_ms") or 0, 1),
            "flake": bool(result.get("flake")),
            "http_status": result.get("status"),
            "evidence": snippet,
            "label": case.get("label"),
            "expected": case.get("expect"),
        }
    except Exception as exc:
        return {
            "id": case["id"],
            "category": case.get("category"),
            "name": case.get("name"),
            "pass": False,
            "skipped": False,
            "errors": [f"{type(exc).__name__}: {exc}"],
            "latency_ms": 0,
            "flake": True,
            "http_status": 0,
            "evidence": "",
            "label": case.get("label"),
            "expected": case.get("expect"),
        }


def guardrail_prf(results: list[dict]) -> dict[str, Any]:
    """Precision/recall for injection block vs benign allow when labels present."""
    tp = fp = tn = fn = 0
    for r in results:
        lab = r.get("label") or {}
        if lab.get("class") not in ("injection", "benign"):
            continue
        decision_block = False
        # infer from pass+expected: for injection expected block — if pass, blocked
        if lab.get("class") == "injection":
            # pass means correctly blocked
            if r["pass"]:
                tp += 1
            else:
                fn += 1
        elif lab.get("class") == "benign":
            if r["pass"]:
                tn += 1
            else:
                fp += 1
    prec = tp / (tp + fp) if (tp + fp) else None
    rec = tp / (tp + fn) if (tp + fn) else None
    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": None if prec is None else round(prec, 3),
        "recall": None if rec is None else round(rec, 3),
    }


def write_reports(report: dict, out_dir: Path) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    jp = out_dir / "kfold_report.json"
    mp = out_dir / "kfold_report.md"
    jp.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines: list[str] = []
    lines.append("# CSI Nora k-fold full-stack evaluation")
    lines.append("")
    lines.append(f"- Generated: `{report['generated_at']}`")
    lines.append(f"- Base URL: `{report['base_url']}`")
    lines.append(f"- K={report['k']}, N={report['n_cases']}")
    lines.append(f"- Overall mean pass rate: **{report['aggregate']['mean_pass_rate']:.1%}** ± {report['aggregate']['std_pass_rate']:.1%}")
    lines.append(f"- Suite score (all case attempts): **{report['aggregate']['suite_pass_rate']:.1%}** ({report['aggregate']['suite_passed']}/{report['aggregate']['suite_total']})")
    lines.append(f"- Fixes applied: {report.get('fixes_applied') or 'none'}")
    lines.append("")
    lines.append("## Stratification")
    lines.append("")
    lines.append("| Category | Count |")
    lines.append("|---|---:|")
    for cat, n in sorted(report["stratification"].items()):
        lines.append(f"| {cat} | {n} |")
    lines.append("")
    lines.append("## Per-fold results")
    lines.append("")
    lines.append("| Fold | N | Pass | Fail | Pass rate | p50 ms | p95 ms | Flakes |")
    lines.append("|---:|---:|---:|---:|---:|---:|---:|---:|")
    for f in report["folds"]:
        lines.append(
            f"| {f['fold']} | {f['n']} | {f['passed']} | {f['failed']} | {f['pass_rate']:.1%} | "
            f"{f['latency']['p50_ms']:.0f} | {f['latency']['p95_ms']:.0f} | {f['flakes']} |"
        )
    lines.append("")
    lines.append("## Per-category pass rates")
    lines.append("")
    lines.append("| Category | Pass | Total | Rate |")
    lines.append("|---|---:|---:|---:|")
    for cat, s in sorted(report["per_category"].items()):
        lines.append(f"| {cat} | {s['passed']} | {s['total']} | {s['pass_rate']:.1%} |")
    lines.append("")
    if report.get("guardrail_metrics"):
        g = report["guardrail_metrics"]
        lines.append("## Guardrail metrics (labeled injection/benign)")
        lines.append("")
        lines.append(f"- Precision: {g.get('precision')}  Recall: {g.get('recall')}  (tp={g['tp']} fp={g['fp']} tn={g['tn']} fn={g['fn']})")
        lines.append("")
    lines.append("## Failures")
    lines.append("")
    fails = report.get("failures") or []
    if not fails:
        lines.append("_None — all cases passed._")
    else:
        for f in fails:
            lines.append(f"### `{f['id']}` ({f.get('category')}) — fold {f.get('fold')}")
            lines.append(f"- Expected: `{json.dumps(f.get('expected'), ensure_ascii=True)[:300]}`")
            lines.append(f"- Actual: status={f.get('http_status')} errors={f.get('errors')}")
            lines.append(f"- Evidence: `{f.get('evidence', '')[:300]}`")
            lines.append("")
    lines.append("## Re-run")
    lines.append("")
    lines.append("```powershell")
    lines.append(report["rerun_command"])
    lines.append("```")
    lines.append("")
    mp.write_text("\n".join(lines), encoding="utf-8")
    return jp, mp


def main() -> int:
    ap = argparse.ArgumentParser(description="CSI Nora k-fold full-stack eval")
    ap.add_argument("--base", default=os.getenv("BASE_URL", DEFAULT_BASE))
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--cases", type=Path, default=CASES_PATH)
    ap.add_argument("--out", type=Path, default=RESULTS_DIR)
    args = ap.parse_args()
    base = args.base.rstrip("/")

    suite = json.loads(args.cases.read_text(encoding="utf-8"))
    cases: list[dict] = suite["cases"]
    k = max(2, min(args.k, len(cases)))

    stratification: dict[str, int] = defaultdict(int)
    for c in cases:
        stratification[c.get("category", "other")] += 1

    print(f"=== K-fold eval K={k} N={len(cases)} base={base} ===")
    # quick connectivity
    try:
        st, txt, _, _ = _http_request("GET", f"{base}/healthz", timeout=8)
        print(f"proxy healthz: {st} {txt[:80]}")
    except Exception as exc:
        print(f"FATAL: cannot reach {base}/healthz: {exc}")
        return 2

    ensure_shared_kb(base)
    folds = stratified_folds(cases, k, seed=args.seed)

    fold_reports: list[dict] = []
    all_results: list[dict] = []
    failures: list[dict] = []

    for i, fold_cases in enumerate(folds, start=1):
        print(f"\n--- Fold {i}/{k} ({len(fold_cases)} cases) ---")
        # optional calibration on train folds: p95 latency threshold (informational)
        train = [c for j, f in enumerate(folds, start=1) if j != i for c in f]
        _ = train  # reserved for future threshold calibration
        results = []
        for case in fold_cases:
            r = run_case(case, base)
            results.append(r)
            all_results.append({**r, "fold": i})
            mark = "PASS" if r["pass"] else "FAIL"
            flake = " FLAKE" if r.get("flake") else ""
            print(f"  {mark}{flake}  {r['id']}  ({r['latency_ms']:.0f} ms)  {';'.join(r.get('errors') or [])}")
            if not r["pass"]:
                failures.append({**r, "fold": i})

        passed = sum(1 for r in results if r["pass"])
        failed = len(results) - passed
        lats = sorted(r["latency_ms"] for r in results)
        def pct(p: float) -> float:
            if not lats:
                return 0.0
            idx = min(len(lats) - 1, max(0, int(math.ceil(p / 100 * len(lats)) - 1)))
            return lats[idx]

        fold_reports.append(
            {
                "fold": i,
                "n": len(results),
                "case_ids": [c["id"] for c in fold_cases],
                "passed": passed,
                "failed": failed,
                "pass_rate": passed / len(results) if results else 0.0,
                "flakes": sum(1 for r in results if r.get("flake")),
                "latency": {
                    "p50_ms": pct(50),
                    "p95_ms": pct(95),
                    "mean_ms": statistics.mean(lats) if lats else 0.0,
                },
                "results": results,
            }
        )

    cleanup_shared_kb(base)

    rates = [f["pass_rate"] for f in fold_reports]
    mean_r = statistics.mean(rates) if rates else 0.0
    std_r = statistics.pstdev(rates) if len(rates) > 1 else 0.0
    suite_passed = sum(1 for r in all_results if r["pass"])
    suite_total = len(all_results)

    per_category: dict[str, dict] = {}
    by_cat: dict[str, list] = defaultdict(list)
    for r in all_results:
        by_cat[r.get("category") or "other"].append(r)
    for cat, items in by_cat.items():
        p = sum(1 for x in items if x["pass"])
        per_category[cat] = {
            "passed": p,
            "total": len(items),
            "pass_rate": p / len(items) if items else 0.0,
        }

    rerun = (
        f'cd "{HERE.parents[1]}"; '
        f'.\\.venv\\Scripts\\python.exe tests\\kfold\\run_kfold.py --base {base} --k {k}'
    )

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": base,
        "k": k,
        "n_cases": len(cases),
        "seed": args.seed,
        "stratification": dict(sorted(stratification.items())),
        "folds": [
            {kk: vv for kk, vv in f.items() if kk != "results"} | {"results": f["results"]}
            for f in fold_reports
        ],
        "aggregate": {
            "mean_pass_rate": mean_r,
            "std_pass_rate": std_r,
            "suite_passed": suite_passed,
            "suite_total": suite_total,
            "suite_pass_rate": suite_passed / suite_total if suite_total else 0.0,
            "fold_pass_rates": rates,
        },
        "per_category": per_category,
        "guardrail_metrics": guardrail_prf(all_results),
        "failures": [
            {
                "id": f["id"],
                "category": f.get("category"),
                "fold": f.get("fold"),
                "expected": f.get("expected"),
                "errors": f.get("errors"),
                "http_status": f.get("http_status"),
                "evidence": f.get("evidence"),
            }
            for f in failures
        ],
        "fixes_applied": [
            "nginx /chroma/ location: set proxy_http_version 1.1 (Chroma rejected HTTP/1.0 → 400)"
        ],
        "rerun_command": rerun,
    }

    jp, mp = write_reports(report, args.out)
    print("\n=== AGGREGATE ===")
    print(f"mean±std pass rate: {mean_r:.1%} ± {std_r:.1%}")
    print(f"suite: {suite_passed}/{suite_total} = {suite_passed/suite_total:.1%}")
    print(f"failures: {len(failures)}")
    print(f"wrote {jp}")
    print(f"wrote {mp}")
    return 0 if suite_passed == suite_total else 1


if __name__ == "__main__":
    raise SystemExit(main())
