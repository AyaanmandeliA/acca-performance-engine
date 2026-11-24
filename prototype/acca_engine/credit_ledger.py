"""Part of ../../PROJECT.md — auditable requirement-level credit ledger."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any

from .paper_rules import PaperRuleRegistry
from .uncertainty import UncertaintyPolicy


PROTOTYPE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEDGER_CONFIG = PROTOTYPE_ROOT / "credit_ledger_config.json"
CLASSIFICATION_RANK = {
    "STYLE_NOTE": 0,
    "DIAGNOSTIC_WEAKNESS": 1,
    "MARK_MATERIAL_WEAKNESS": 2,
}
SEVERITY_RANK = {"MINOR": 0, "MODERATE": 1, "MAJOR": 2}
CONFIDENCE_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


class CreditLedgerError(ValueError):
    """Raised when a ledger cannot be built without inventing credit."""


def load_credit_ledger_config(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path is not None else DEFAULT_LEDGER_CONFIG
    document = json.loads(config_path.read_text(encoding="utf-8"))
    required = {
        "config_version",
        "finding_classifications",
        "credit_statuses",
        "rule_statuses",
        "deduplication_groups",
        "uncertainty_policy",
    }
    missing = sorted(required - document.keys())
    if missing:
        raise CreditLedgerError(f"Credit-ledger config missing keys: {missing}")
    return document


class FalseCriticismController:
    """Downgrade unsupported presentation criticism before it can affect credit."""

    def __init__(self, registry: PaperRuleRegistry):
        self.registry = registry

    def classify(self, paper: str, finding: dict[str, Any]) -> dict[str, Any]:
        item = deepcopy(finding)
        proposed = item.get("proposed_classification", "DIAGNOSTIC_WEAKNESS")
        if proposed not in CLASSIFICATION_RANK:
            raise CreditLedgerError(f"Invalid finding classification {proposed}")
        safeguards = item.get("safeguards", {})
        reasons: list[str] = []
        classification = proposed

        if safeguards.get("accepted_format"):
            classification = "STYLE_NOTE"
            reasons.append("ACCEPTED_FORMAT")
        if safeguards.get("alternative_working_valid"):
            classification = "STYLE_NOTE"
            reasons.append("ALTERNATIVE_VALID_WORKING")
        if safeguards.get("concise_but_complete"):
            classification = "STYLE_NOTE"
            reasons.append("CONCISE_BUT_COMPLETE")
        if safeguards.get("own_figure_follow_through_valid"):
            classification = "DIAGNOSTIC_WEAKNESS"
            reasons.append("CONSEQUENTIAL_CREDIT_PRESERVED")

        rule = None
        if item.get("rule_id"):
            rule = self.registry.get_rule(paper, item["rule_id"])
            if rule["effect"] == "ACCEPT_FORMAT" and item.get("finding_type") == "FORMAT":
                classification = "STYLE_NOTE"
                reasons.append("PAPER_RULE_ACCEPTS_FORMAT")
            if (
                rule["status"] == "INSUFFICIENT_EVIDENCE"
                and classification == "MARK_MATERIAL_WEAKNESS"
            ):
                classification = "DIAGNOSTIC_WEAKNESS"
                reasons.append("RULE_HAS_INSUFFICIENT_EVIDENCE")
        elif proposed == "MARK_MATERIAL_WEAKNESS":
            classification = "DIAGNOSTIC_WEAKNESS"
            reasons.append("NO_PAPER_RULE_SUPPORT")

        direct_credit_reduction_allowed = bool(
            classification == "MARK_MATERIAL_WEAKNESS"
            and rule is not None
            and rule["status"] == "SUPPORTED_BY_EXISTING_PROJECT_EVIDENCE"
        )
        item.update(
            classification=classification,
            direct_credit_reduction_allowed=direct_credit_reduction_allowed,
            safeguard_reasons=list(dict.fromkeys(reasons)),
            rule_status=rule["status"] if rule else None,
        )
        return item


class WeaknessDeduplicator:
    """Group related findings while retaining every evidence trail."""

    def __init__(self, config: dict[str, Any]):
        self.groups = deepcopy(config["deduplication_groups"])
        self.tag_to_group: dict[str, str] = {}
        for group in self.groups:
            for tag in group["tags"]:
                if tag in self.tag_to_group:
                    raise CreditLedgerError(f"Tag appears in two dedup groups: {tag}")
                self.tag_to_group[tag] = group["group_id"]

    def group(self, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        seen_finding_ids: set[str] = set()
        for finding in findings:
            finding_id = finding.get("finding_id")
            if not finding_id:
                raise CreditLedgerError("Every finding requires finding_id")
            if finding_id in seen_finding_ids:
                raise CreditLedgerError(f"Duplicate finding_id {finding_id}")
            seen_finding_ids.add(finding_id)
            root = finding.get("root_issue_id")
            if not root:
                related_group = self.tag_to_group.get(finding.get("tag"))
                if related_group:
                    root = "|".join(
                        [
                            "AUTO",
                            related_group,
                            finding.get("requirement_id", "UNKNOWN_REQUIREMENT"),
                            finding.get("credit_unit_id", "GENERAL"),
                        ]
                    )
                else:
                    root = finding["finding_id"]
            grouped.setdefault(root, []).append(finding)

        output: list[dict[str, Any]] = []
        for root, members in sorted(grouped.items()):
            ordered = sorted(
                members,
                key=lambda item: (
                    -CLASSIFICATION_RANK[item["classification"]],
                    -SEVERITY_RANK.get(item.get("severity", "MINOR"), 0),
                    -CONFIDENCE_RANK.get(item.get("confidence", "LOW"), 0),
                    item["finding_id"],
                ),
            )
            primary = ordered[0]
            details = []
            for item in ordered:
                detail = deepcopy(item)
                detail["is_root_primary"] = item["finding_id"] == primary["finding_id"]
                detail["effective_mark_penalty"] = bool(
                    detail["is_root_primary"]
                    and item.get("direct_credit_reduction_allowed")
                )
                details.append(detail)
            output.append(
                {
                    "root_issue_id": root,
                    "primary_finding_id": primary["finding_id"],
                    "finding_ids": [item["finding_id"] for item in ordered],
                    "effective_mark_penalty_count": sum(
                        item["effective_mark_penalty"] for item in details
                    ),
                    "findings": details,
                }
            )
        return output


class CreditLedgerEngine:
    """Build credit from explicit units; never infer a whole-answer mark."""

    def __init__(
        self,
        registry: PaperRuleRegistry | None = None,
        config: dict[str, Any] | None = None,
    ):
        self.registry = registry or PaperRuleRegistry()
        self.config = deepcopy(config or load_credit_ledger_config())
        self.false_criticism = FalseCriticismController(self.registry)
        self.deduplicator = WeaknessDeduplicator(self.config)
        self.uncertainty = UncertaintyPolicy(self.config)

    def build(self, assessment: dict[str, Any]) -> dict[str, Any]:
        required = {"ledger_id", "paper", "requirements", "uncertainty_flags"}
        missing = sorted(required - assessment.keys())
        if missing:
            raise CreditLedgerError(f"Assessment missing keys: {missing}")
        paper = assessment["paper"]
        paper_module = self.registry.get(paper)
        requirements = assessment["requirements"]
        if not isinstance(requirements, list) or not requirements:
            raise CreditLedgerError("Assessment needs at least one requirement")

        ledger_requirements: list[dict[str, Any]] = []
        all_rule_statuses: list[str] = []
        all_groups: list[dict[str, Any]] = []
        overall_low = 0.0
        overall_high = 0.0
        overall_available = 0.0
        has_insufficient = False

        for requirement in requirements:
            built = self._build_requirement(paper, requirement)
            ledger_requirements.append(built["requirement"])
            all_groups.extend(built["deduplication_groups"])
            all_rule_statuses.extend(built["rule_statuses"])
            has_insufficient = has_insufficient or built["has_insufficient_evidence"]
            overall_low += built["requirement"]["credit_range"]["low"]
            overall_high += built["requirement"]["credit_range"]["high"]
            overall_available += built["requirement"]["marks_available"]

        decision = self.uncertainty.decide_mark(
            marks_available=overall_available,
            low=round(overall_low, 6),
            high=round(overall_high, 6),
            flags=assessment["uncertainty_flags"],
            rule_statuses=all_rule_statuses,
            has_insufficient_evidence=has_insufficient,
        )
        point_value = (
            round(overall_low, 6)
            if decision["decision"] == "SCORE_NORMALLY" and overall_low == overall_high
            else None
        )
        return {
            "ledger_version": self.config["config_version"],
            "ledger_id": assessment["ledger_id"],
            "paper": paper,
            "paper_rules_version": paper_module["version"],
            "paper_rules_status": paper_module["overall_status"],
            "marks_available": overall_available,
            "requirements": ledger_requirements,
            "derived_mark": {
                "value": point_value,
                "range": decision["range"],
                "decision": decision["decision"],
                "official_mark": False,
                "student_facing_language": decision["student_facing_language"],
                "reasons": decision["reasons"],
            },
            "deduplication_audit": all_groups,
            "uncertainty_flags": list(dict.fromkeys(assessment["uncertainty_flags"])),
        }

    def _build_requirement(
        self, paper: str, requirement: dict[str, Any]
    ) -> dict[str, Any]:
        required = {"requirement_id", "marks_available", "credit_units", "findings"}
        missing = sorted(required - requirement.keys())
        if missing:
            raise CreditLedgerError(f"Requirement missing keys: {missing}")
        marks_available = float(requirement["marks_available"])
        raw_findings = [
            self.false_criticism.classify(paper, item)
            for item in requirement["findings"]
        ]
        groups = self.deduplicator.group(raw_findings)
        finding_lookup = {
            item["finding_id"]: item
            for group in groups
            for item in group["findings"]
        }

        units: list[dict[str, Any]] = []
        allocated = 0.0
        low = 0.0
        high = 0.0
        rule_statuses: list[str] = []
        has_insufficient = False
        seen_units: set[str] = set()
        for raw in requirement["credit_units"]:
            unit = self._build_unit(paper, raw, finding_lookup)
            if unit["unit_id"] in seen_units:
                raise CreditLedgerError(f"Duplicate credit unit {unit['unit_id']}")
            seen_units.add(unit["unit_id"])
            units.append(unit)
            allocated += unit["marks_available"]
            low += unit["credit_range"]["low"]
            high += unit["credit_range"]["high"]
            rule_statuses.append(unit["rule_status"])
            has_insufficient = has_insufficient or unit["credit_status"] in {
                "INSUFFICIENT_EVIDENCE",
                "UNAVAILABLE",
            }
        if allocated > marks_available + 1e-9:
            raise CreditLedgerError(
                f"Credit units exceed marks for {requirement['requirement_id']}"
            )
        unallocated = round(marks_available - allocated, 6)
        if unallocated:
            units.append(
                {
                    "unit_id": f"{requirement['requirement_id']}:UNALLOCATED",
                    "label": "Credit not represented by supplied marking context",
                    "credit_type": "UNSUPPORTED_OR_UNAVAILABLE",
                    "marks_available": unallocated,
                    "credit_status": "UNAVAILABLE",
                    "credit_range": {"low": 0.0, "high": unallocated},
                    "confidence": "LOW",
                    "evidence": [],
                    "reason": "No assessable unit was supplied for this credit.",
                    "credit_basis": "UNAVAILABLE",
                    "rule_id": None,
                    "rule_status": "INSUFFICIENT_EVIDENCE",
                    "finding_ids": [],
                }
            )
            high += unallocated
            rule_statuses.append("INSUFFICIENT_EVIDENCE")
            has_insufficient = True
        return {
            "requirement": {
                "requirement_id": requirement["requirement_id"],
                "marks_available": marks_available,
                "allocated_marks": round(allocated, 6),
                "unallocated_marks": unallocated,
                "credit_range": {"low": round(low, 6), "high": round(high, 6)},
                "credit_units": units,
                "findings": raw_findings,
            },
            "deduplication_groups": groups,
            "rule_statuses": rule_statuses,
            "has_insufficient_evidence": has_insufficient,
        }

    def _build_unit(
        self,
        paper: str,
        raw: dict[str, Any],
        finding_lookup: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        required = {
            "unit_id",
            "label",
            "credit_type",
            "marks_available",
            "credit_status",
            "credit_min",
            "credit_max",
            "confidence",
            "evidence",
            "reason",
            "credit_basis",
            "rule_id",
            "finding_ids",
        }
        missing = sorted(required - raw.keys())
        if missing:
            raise CreditLedgerError(f"Credit unit missing keys: {missing}")
        if raw["credit_status"] not in set(self.config["credit_statuses"]):
            raise CreditLedgerError(f"Invalid credit status {raw['credit_status']}")
        if raw["confidence"] not in CONFIDENCE_RANK:
            raise CreditLedgerError(f"Invalid confidence {raw['confidence']}")
        if raw["credit_basis"] not in {
            "EXPLICIT_MARKING_CONTEXT",
            "DIAGNOSTIC_INFERENCE",
            "UNAVAILABLE",
        }:
            raise CreditLedgerError(f"Invalid credit basis {raw['credit_basis']}")
        if not isinstance(raw["finding_ids"], list):
            raise CreditLedgerError(f"finding_ids must be a list in {raw['unit_id']}")
        if not self.registry.supports_credit_type(paper, raw["credit_type"]):
            raise CreditLedgerError(
                f"{paper} does not support credit type {raw['credit_type']}"
            )
        rule = self.registry.get_rule(paper, raw["rule_id"])
        marks = float(raw["marks_available"])
        low = float(raw["credit_min"])
        high = float(raw["credit_max"])
        if marks <= 0 or not 0 <= low <= high <= marks:
            raise CreditLedgerError(f"Invalid credit range in {raw['unit_id']}")
        unknown = sorted(set(raw["finding_ids"]) - set(finding_lookup))
        if unknown:
            raise CreditLedgerError(
                f"{raw['unit_id']} references unknown findings: {unknown}"
            )
        linked = [finding_lookup[item] for item in raw["finding_ids"]]
        if raw["credit_basis"] == "DIAGNOSTIC_INFERENCE" and high < marks:
            if not any(item["effective_mark_penalty"] for item in linked):
                raise CreditLedgerError(
                    f"{raw['unit_id']} reduces credit without a supported, deduplicated mark-material weakness"
                )
        if any(item["classification"] == "STYLE_NOTE" for item in linked) and high < marks:
            material = any(item["effective_mark_penalty"] for item in linked)
            if not material and raw["credit_basis"] != "EXPLICIT_MARKING_CONTEXT":
                raise CreditLedgerError(
                    f"Style note cannot reduce credit in {raw['unit_id']}"
                )
        return {
            "unit_id": raw["unit_id"],
            "label": raw["label"],
            "credit_type": raw["credit_type"],
            "marks_available": marks,
            "credit_status": raw["credit_status"],
            "credit_range": {"low": low, "high": high},
            "confidence": raw["confidence"],
            "evidence": deepcopy(raw["evidence"]),
            "reason": raw["reason"],
            "credit_basis": raw["credit_basis"],
            "rule_id": raw["rule_id"],
            "rule_status": rule["status"],
            "finding_ids": list(raw["finding_ids"]),
        }
