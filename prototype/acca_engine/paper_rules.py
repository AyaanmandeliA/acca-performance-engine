"""Part of ../../PROJECT.md — configurable AFM/SBR paper-rule registry."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


PROTOTYPE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RULE_DIR = PROTOTYPE_ROOT / "paper_rules"
ALLOWED_RULE_STATUSES = {
    "SUPPORTED_BY_EXISTING_PROJECT_EVIDENCE",
    "UNVALIDATED",
    "INSUFFICIENT_EVIDENCE",
}


class PaperRuleError(ValueError):
    """Raised when a paper-rule file or requested rule is invalid."""


class PaperRuleRegistry:
    """Load versioned paper rules without embedding mark logic in Python."""

    def __init__(self, rule_dir: str | Path | None = None):
        self.rule_dir = Path(rule_dir) if rule_dir is not None else DEFAULT_RULE_DIR
        self._papers: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self.rule_dir.is_dir():
            raise PaperRuleError(f"Paper-rule directory does not exist: {self.rule_dir}")
        for path in sorted(self.rule_dir.glob("*.json")):
            document = json.loads(path.read_text(encoding="utf-8"))
            self._validate(document, path)
            paper = document["paper"]
            if paper in self._papers:
                raise PaperRuleError(f"Duplicate paper-rule module for {paper}")
            document["_source_path"] = str(path)
            document["_rules_by_id"] = {
                item["rule_id"]: item for item in document["rules"]
            }
            self._papers[paper] = document

    @staticmethod
    def _validate(document: Any, path: Path) -> None:
        if not isinstance(document, dict):
            raise PaperRuleError(f"Expected object in {path}")
        required = {
            "paper",
            "version",
            "overall_status",
            "evidence_basis",
            "context_defaults",
            "credit_types",
            "professional_skill_components",
            "accepted_presentations",
            "rules",
        }
        missing = sorted(required - document.keys())
        if missing:
            raise PaperRuleError(f"{path} missing keys: {missing}")
        if document["overall_status"] not in ALLOWED_RULE_STATUSES:
            raise PaperRuleError(f"{path} has invalid overall_status")
        if not isinstance(document["credit_types"], list) or not document["credit_types"]:
            raise PaperRuleError(f"{path} needs at least one credit type")
        if len(document["credit_types"]) != len(set(document["credit_types"])):
            raise PaperRuleError(f"{path} has duplicate credit types")
        seen: set[str] = set()
        for rule in document["rules"]:
            rule_required = {"rule_id", "category", "status", "description", "effect"}
            if not isinstance(rule, dict) or not rule_required <= rule.keys():
                raise PaperRuleError(f"{path} contains a malformed rule")
            if rule["rule_id"] in seen:
                raise PaperRuleError(f"{path} duplicates rule {rule['rule_id']}")
            seen.add(rule["rule_id"])
            if rule["status"] not in ALLOWED_RULE_STATUSES:
                raise PaperRuleError(
                    f"{path} rule {rule['rule_id']} has invalid status"
                )
        for collection in (
            document["professional_skill_components"],
            document["accepted_presentations"],
        ):
            for item in collection:
                if item.get("status") not in ALLOWED_RULE_STATUSES:
                    raise PaperRuleError(f"{path} contains an invalid evidence status")

    def papers(self) -> list[str]:
        return sorted(self._papers)

    def get(self, paper: str) -> dict[str, Any]:
        if paper not in self._papers:
            raise PaperRuleError(f"No paper-rule module for {paper}")
        return deepcopy(self._papers[paper])

    def get_rule(self, paper: str, rule_id: str) -> dict[str, Any]:
        module = self._papers.get(paper)
        if module is None:
            raise PaperRuleError(f"No paper-rule module for {paper}")
        rule = module["_rules_by_id"].get(rule_id)
        if rule is None:
            raise PaperRuleError(f"Unknown {paper} rule {rule_id}")
        return deepcopy(rule)

    def supports_credit_type(self, paper: str, credit_type: str) -> bool:
        return credit_type in set(self.get(paper)["credit_types"])

    def context_defaults(self, paper: str) -> dict[str, str]:
        return deepcopy(self.get(paper)["context_defaults"])

