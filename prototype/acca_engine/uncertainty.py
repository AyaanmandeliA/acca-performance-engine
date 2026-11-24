"""Part of ../../PROJECT.md — deterministic scoring and downstream uncertainty policy."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


CONFIDENCE_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


class UncertaintyPolicy:
    """Convert explicit uncertainty into mark and downstream decisions."""

    def __init__(self, config: dict[str, Any]):
        self.config = deepcopy(config["uncertainty_policy"])
        self.blocking_flags = set(self.config["blocking_flags"])
        self.mark_only_flags = set(self.config["mark_only_flags"])

    def cap_confidence(self, confidence: str, cap: str | None) -> str:
        if cap is None:
            return confidence
        if confidence not in CONFIDENCE_RANK or cap not in CONFIDENCE_RANK:
            raise ValueError("Unknown confidence value")
        return min((confidence, cap), key=lambda value: CONFIDENCE_RANK[value])

    def normalise_for_downstream(
        self,
        flags: list[str],
        *,
        paper_rules_available: bool,
        evidence_present: bool,
    ) -> dict[str, Any]:
        source_flags = list(dict.fromkeys(flags))
        blocking = sorted(set(source_flags) & self.blocking_flags)
        handled: list[dict[str, str]] = []
        engine_flags = list(source_flags)
        confidence_cap: str | None = None

        if "PAPER_RULES_UNAVAILABLE" in engine_flags and evidence_present:
            engine_flags.remove("PAPER_RULES_UNAVAILABLE")
            confidence_cap = self.config[
                "confidence_cap_when_paper_rules_unavailable"
            ]
            handled.append(
                {
                    "flag": "PAPER_RULES_UNAVAILABLE",
                    "treatment": "MARK_ESTIMATION_BLOCKED_DIAGNOSTIC_EVIDENCE_ALLOWED_WITH_CONFIDENCE_CAP",
                }
            )
        if not paper_rules_available and "PAPER_RULES_UNAVAILABLE" not in source_flags:
            source_flags.append("PAPER_RULES_UNAVAILABLE")
            confidence_cap = self.config[
                "confidence_cap_when_paper_rules_unavailable"
            ]
            handled.append(
                {
                    "flag": "PAPER_RULES_UNAVAILABLE",
                    "treatment": "ADDED_BY_ADAPTER_AND_CONFIDENCE_CAPPED",
                }
            )
        return {
            "source_flags": source_flags,
            "engine_flags": engine_flags,
            "blocking_flags": blocking,
            "handled_flags": handled,
            "confidence_cap": confidence_cap,
            "mark_estimation_eligible": not blocking
            and not bool(set(source_flags) & self.mark_only_flags),
        }

    def dimension_decision(
        self,
        applicability: str,
        confidence: str,
        flags: list[str],
    ) -> dict[str, Any]:
        if applicability == "NOT_APPLICABLE":
            return {"decision": "NOT_APPLICABLE", "downstream_weight": 0.0}
        if applicability == "INSUFFICIENT_EVIDENCE":
            return {"decision": "ABSTAIN", "downstream_weight": 0.0}
        if set(flags) & self.blocking_flags:
            return {"decision": "ABSTAIN", "downstream_weight": 0.0}
        weights = {"LOW": 0.4, "MEDIUM": 0.7, "HIGH": 1.0}
        return {"decision": "USE", "downstream_weight": weights[confidence]}

    def decide_mark(
        self,
        *,
        marks_available: float,
        low: float,
        high: float,
        flags: list[str],
        rule_statuses: list[str],
        has_insufficient_evidence: bool,
    ) -> dict[str, Any]:
        blocking = sorted(set(flags) & self.blocking_flags)
        if blocking or "INDICATIVE_MARK_UNSAFE" in flags:
            return self._mark_decision("REFUSE_ESTIMATE", low, high, blocking)
        width_ratio = (high - low) / marks_available if marks_available else 1.0
        if width_ratio >= float(self.config["refuse_range_width_ratio"]):
            return self._mark_decision(
                "REFUSE_ESTIMATE", low, high, ["RANGE_TOO_WIDE"]
            )
        supported = set(self.config["normal_scoring_rule_statuses"])
        unsupported_rules = sorted(set(rule_statuses) - supported)
        mark_only = sorted(set(flags) & self.mark_only_flags)
        if (
            has_insufficient_evidence
            or unsupported_rules
            or mark_only
            or width_ratio >= float(self.config["broad_range_width_ratio"])
            or high != low
        ):
            reasons = []
            if has_insufficient_evidence:
                reasons.append("INSUFFICIENT_EVIDENCE")
            reasons.extend(unsupported_rules)
            reasons.extend(mark_only)
            return self._mark_decision("BROAD_RANGE", low, high, reasons)
        return self._mark_decision("SCORE_NORMALLY", low, high, [])

    @staticmethod
    def _mark_decision(
        decision: str, low: float, high: float, reasons: list[str]
    ) -> dict[str, Any]:
        language = {
            "SCORE_NORMALLY": "Ledger-derived indicative credit; not an official mark.",
            "BROAD_RANGE": "Broad indicative range because marking evidence or rules are incomplete.",
            "REFUSE_ESTIMATE": "No mark estimate: the available evidence is not safe for numerical scoring.",
        }[decision]
        return {
            "decision": decision,
            "range": {"low": low, "high": high},
            "student_facing_language": language,
            "reasons": list(dict.fromkeys(reasons)),
        }

