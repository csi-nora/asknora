"""Compute device scaling: CPU / GPU / NPU detection and routing."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Literal

DeviceKind = Literal["cpu", "gpu", "npu", "auto"]
BackendName = Literal[
    "cpu",
    "cuda",
    "rocm",
    "mps",
    "openvino_npu",
    "openvino_gpu",
    "directml",
    "unknown",
]


@dataclass
class DeviceInfo:
    kind: DeviceKind
    backend: BackendName
    name: str
    available: bool
    details: dict[str, Any] = field(default_factory=dict)


def _has_nvidia() -> DeviceInfo:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        ).strip()
        if out:
            first = out.splitlines()[0]
            return DeviceInfo("gpu", "cuda", first, True, {"nvidia_smi": out})
    except Exception:
        pass
    return DeviceInfo("gpu", "cuda", "NVIDIA GPU", False)


def _has_rocm() -> DeviceInfo:
    try:
        out = subprocess.check_output(["rocminfo"], stderr=subprocess.DEVNULL, text=True, timeout=5)
        if "Agent" in out or "gfx" in out.lower():
            return DeviceInfo("gpu", "rocm", "AMD ROCm GPU", True)
    except Exception:
        pass
    return DeviceInfo("gpu", "rocm", "AMD ROCm GPU", False)


def _has_mps() -> DeviceInfo:
    if platform.system() != "Darwin":
        return DeviceInfo("gpu", "mps", "Apple Metal", False)
    try:
        import torch

        ok = bool(getattr(torch.backends, "mps", None) and torch.backends.mps.is_available())
        return DeviceInfo("gpu", "mps", "Apple Metal (MPS)", ok)
    except Exception:
        return DeviceInfo("gpu", "mps", "Apple Metal (MPS)", False)


def _has_openvino_npu() -> DeviceInfo:
    try:
        from openvino import Core  # type: ignore

        core = Core()
        devices = list(core.available_devices)
        if "NPU" in devices:
            return DeviceInfo(
                "npu",
                "openvino_npu",
                "Intel OpenVINO NPU",
                True,
                {"devices": devices},
            )
        if "GPU" in devices:
            return DeviceInfo(
                "gpu",
                "openvino_gpu",
                "Intel OpenVINO GPU",
                True,
                {"devices": devices},
            )
        return DeviceInfo("npu", "openvino_npu", "Intel OpenVINO NPU", False, {"devices": devices})
    except Exception as exc:
        return DeviceInfo("npu", "openvino_npu", "Intel OpenVINO NPU", False, {"error": str(exc)})


def _has_directml() -> DeviceInfo:
    """Windows DirectML — covers some NPUs/GPUs via ONNX Runtime."""
    if platform.system() != "Windows":
        return DeviceInfo("gpu", "directml", "DirectML", False)
    try:
        import onnxruntime as ort  # type: ignore

        providers = ort.get_available_providers()
        ok = "DmlExecutionProvider" in providers
        return DeviceInfo("gpu", "directml", "Windows DirectML", ok, {"providers": providers})
    except Exception as exc:
        return DeviceInfo("gpu", "directml", "Windows DirectML", False, {"error": str(exc)})


def probe_devices() -> list[DeviceInfo]:
    cpu = DeviceInfo(
        "cpu",
        "cpu",
        f"CPU ({platform.processor() or platform.machine()})",
        True,
        {"cores": os.cpu_count() or 1},
    )
    return [
        cpu,
        _has_nvidia(),
        _has_rocm(),
        _has_mps(),
        _has_openvino_npu(),
        _has_directml(),
    ]


def resolve_device(preference: DeviceKind = "auto") -> DeviceInfo:
    """Pick best available device for preference (auto = GPU > NPU > CPU)."""
    devices = probe_devices()
    available = [d for d in devices if d.available]

    if preference == "cpu":
        return next(d for d in devices if d.kind == "cpu")

    if preference == "gpu":
        for backend in ("cuda", "rocm", "mps", "openvino_gpu", "directml"):
            for d in available:
                if d.backend == backend:
                    return d
        return DeviceInfo("gpu", "unknown", "GPU requested but none found", False)

    if preference == "npu":
        for d in available:
            if d.kind == "npu" or d.backend == "openvino_npu":
                return d
        # DirectML sometimes maps NPU on Copilot+ PCs
        for d in available:
            if d.backend == "directml":
                return DeviceInfo("npu", "directml", "NPU via DirectML", True, d.details)
        return DeviceInfo("npu", "unknown", "NPU requested but none found", False)

    # auto
    for backend in ("cuda", "rocm", "mps", "openvino_npu", "openvino_gpu", "directml"):
        for d in available:
            if d.backend == backend:
                return d
    return next(d for d in devices if d.kind == "cpu")


def torch_device_string(info: DeviceInfo | None = None) -> str:
    info = info or resolve_device(os.getenv("ACCEL_DEVICE", "auto").lower())  # type: ignore[arg-type]
    if not info.available:
        return "cpu"
    if info.backend == "cuda":
        return "cuda"
    if info.backend == "mps":
        return "mps"
    if info.backend == "rocm":
        return "cuda"  # ROCm uses cuda device string in PyTorch
    return "cpu"


def openvino_device_string(info: DeviceInfo | None = None) -> str:
    info = info or resolve_device(os.getenv("ACCEL_DEVICE", "auto").lower())  # type: ignore[arg-type]
    if info.backend == "openvino_npu" and info.available:
        return "NPU"
    if info.backend == "openvino_gpu" and info.available:
        return "GPU"
    return "CPU"


def ollama_num_gpu(info: DeviceInfo | None = None) -> int:
    """Ollama: -1 = all layers on GPU, 0 = CPU-only."""
    info = info or resolve_device(os.getenv("ACCEL_DEVICE", "auto").lower())  # type: ignore[arg-type]
    if info.kind == "gpu" and info.available and info.backend in {"cuda", "rocm", "mps"}:
        return -1
    return 0


def apply_accel_env(preference: DeviceKind) -> DeviceInfo:
    """Set process env vars used by Ollama / OpenVINO / ONNX / PyTorch."""
    info = resolve_device(preference)
    os.environ["ACCEL_DEVICE"] = preference if preference != "auto" else info.kind
    os.environ["ACCEL_BACKEND"] = info.backend
    os.environ["TORCH_DEVICE"] = torch_device_string(info)
    os.environ["OPENVINO_DEVICE"] = openvino_device_string(info)
    os.environ["OLLAMA_NUM_GPU"] = str(ollama_num_gpu(info))

    # Prefer CPU threads when forced to CPU
    if info.kind == "cpu" or not info.available:
        os.environ.setdefault("OMP_NUM_THREADS", str(max(1, (os.cpu_count() or 4) // 2)))
        os.environ["CUDA_VISIBLE_DEVICES"] = ""
    elif info.backend == "cuda":
        os.environ.pop("CUDA_VISIBLE_DEVICES", None)

    return info


def compose_profile_for(preference: DeviceKind) -> str:
    """Map preference to docker compose profile name."""
    if preference == "gpu":
        return "gpu"
    if preference == "npu":
        return "npu"
    return "cpu"


def docker_compose_files(preference: DeviceKind) -> list[str]:
    files = ["docker-compose.yml"]
    if preference == "gpu":
        files.append("docker-compose.gpu.yml")
    elif preference == "npu":
        files.append("docker-compose.npu.yml")
    else:
        files.append("docker-compose.cpu.yml")
    return files


def status_report(preference: DeviceKind | None = None) -> dict[str, Any]:
    pref = preference or os.getenv("ACCEL_DEVICE", "auto").lower()  # type: ignore[assignment]
    if pref not in {"cpu", "gpu", "npu", "auto"}:
        pref = "auto"
    resolved = resolve_device(pref)  # type: ignore[arg-type]
    return {
        "preference": pref,
        "resolved": {
            "kind": resolved.kind,
            "backend": resolved.backend,
            "name": resolved.name,
            "available": resolved.available,
            "details": resolved.details,
        },
        "torch_device": torch_device_string(resolved),
        "openvino_device": openvino_device_string(resolved),
        "ollama_num_gpu": ollama_num_gpu(resolved),
        "compose_files": docker_compose_files(pref if pref != "auto" else resolved.kind),  # type: ignore[arg-type]
        "probed": [
            {"kind": d.kind, "backend": d.backend, "name": d.name, "available": d.available}
            for d in probe_devices()
        ],
        "docker": shutil.which("docker") is not None,
    }
