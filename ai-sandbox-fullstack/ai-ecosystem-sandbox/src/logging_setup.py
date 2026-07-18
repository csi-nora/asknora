"""Structured logging for demos and services."""

from __future__ import annotations

import logging
import sys

from src.config import get_settings


def setup_logging(name: str = "sandbox") -> logging.Logger:
    settings = get_settings()
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )
    return logging.getLogger(name)
