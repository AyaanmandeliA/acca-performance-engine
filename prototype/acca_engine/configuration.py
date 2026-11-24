"""Part of ../../PROJECT.md — local configuration and fixture loading only."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


PROTOTYPE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = PROTOTYPE_ROOT.parent
DEFAULT_CONFIG_PATH = PROTOTYPE_ROOT / "engine_config.json"
DEFAULT_FIXTURE_PATH = PROJECT_ROOT / "SYNTHETIC_TEST_CASES.json"


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    """Load the versioned deterministic-engine configuration."""

    config_path = Path(path) if path is not None else DEFAULT_CONFIG_PATH
    config = _read_json(config_path)
    required = {
        "config_version",
        "confidence_weights",
        "severity_weights",
        "state_thresholds",
        "priority",
        "recommendation",
        "tag_dimensions",
    }
    missing = sorted(required - config.keys())
    if missing:
        raise ValueError(f"Configuration is missing required keys: {missing}")
    return config


def load_fixture_bundle(path: str | Path | None = None) -> dict[str, Any]:
    """Load the compact synthetic fixture bundle from the project root."""

    fixture_path = Path(path) if path is not None else DEFAULT_FIXTURE_PATH
    bundle = _read_json(fixture_path)
    if not isinstance(bundle.get("profiles"), list):
        raise ValueError("Synthetic fixture bundle must contain a profiles list")
    if not isinstance(bundle.get("synthetic_question_catalogue"), list):
        raise ValueError(
            "Synthetic fixture bundle must contain a synthetic_question_catalogue list"
        )
    return bundle


def profiles_by_id(bundle: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Index fixture profiles by their stable profile ID."""

    return {profile["profile_id"]: profile for profile in bundle["profiles"]}

