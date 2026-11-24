"""Part of ../../PROJECT.md — diagnostic-to-engine normalisation and pipeline."""

from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime
from typing import Any

from .credit_ledger import WeaknessDeduplicator, load_credit_ledger_config
from .paper_rules import PaperRuleRegistry
from .recommendation_engine import RecommendationEngine
from .uncertainty import UncertaintyPolicy
from .weakness_engine import WeaknessEngine


REQUIRED_ROOT_KEYS = {
    "schema_version",
    "analysis_id",
    "benchmark_case_id",
    "generated_at",
    "paper",
    "question_requirement",
    "marks_available",
    "diagnostic_model",
    "indicative_mark",
    "diagnosis_summary",
    "dimension_assessments",
    "major_strengths",
    "major_weaknesses",
    "priority_weaknesses",
    "technical_knowledge_gaps",
    "exam_technique_gaps",
    "recommended_improvement_actions",
    "uncertainty",
}
CONFIDENCES = {"LOW", "MEDIUM", "HIGH"}
SEVERITIES = {"MINOR", "MODERATE", "MAJOR"}
KNOWN_ACCA_PAPERS = {
    "PM", "TX", "FR", "FM", "AA", "SBL", "SBR", "AFM", "APM", "AAA", "ATX"
}
STRENGTH_TAG_DIMENSIONS = {
    "TECHNICAL_KNOWLEDGE_ACCURATE": "TECHNICAL_KNOWLEDGE",
    "REQUIREMENT_INTERPRETED_ACCURATELY": "REQUIREMENT_INTERPRETATION",
    "SCENARIO_APPLICATION_EFFECTIVE": "SCENARIO_APPLICATION",
    "ANALYSIS_WELL_DEVELOPED": "ANALYSIS_DEVELOPMENT",
    "TRADE_OFFS_WEIGHED": "EVALUATION_JUDGEMENT",
    "JUDGEMENT_PROPORTIONATE": "EVALUATION_JUDGEMENT",
    "CALCULATION_ACCURATE": "QUANTITATIVE_ACCURACY",
    "QUANTITATIVE_INSIGHT_EFFECTIVE": "QUANTITATIVE_INTERPRETATION",
    "PROFESSIONAL_COMMUNICATION_EFFECTIVE": "PROFESSIONAL_SKILLS",
    "PROFESSIONAL_SCEPTICISM_EFFECTIVE": "PROFESSIONAL_SKILLS",
    "EFFICIENT_EXAM_EXECUTION": "EXAM_EXECUTION",
    "CONCLUSION_WELL_SUPPORTED": "CONCLUSION_RECOMMENDATION",
    "RECOMMENDATION_ACTIONABLE": "CONCLUSION_RECOMMENDATION",
}


class DiagnosticAdapterError(ValueError):
    """Raised when a diagnostic cannot safely enter downstream engines."""


class DiagnosticToAttemptAdapter:
    """Validate and map a diagnostic without reinterpreting the answer."""

    def __init__(
        self,
        engine_config: dict[str, Any],
        registry: PaperRuleRegistry | None = None,
        ledger_config: dict[str, Any] | None = None,
    ):
        self.engine_config = deepcopy(engine_config)
        self.registry = registry or PaperRuleRegistry()
        self.ledger_config = deepcopy(ledger_config or load_credit_ledger_config())
        self.uncertainty = UncertaintyPolicy(self.ledger_config)
        self.deduplicator = WeaknessDeduplicator(self.ledger_config)
        self.tag_dimensions = self.engine_config["tag_dimensions"]
        self.strength_tag_dimensions = STRENGTH_TAG_DIMENSIONS

    def adapt(
        self,
        document: dict[str, Any],
        *,
        context_override: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        document, normalisation_audit, finding_provenance = (
            self._normalise_cross_fields(document)
        )
        self._validate(document)
        paper = document["paper"]
        paper_module = (
            self.registry.get(paper) if paper in self.registry.papers() else None
        )
        model_rule_version = document["diagnostic_model"].get("paper_rules_version")
        paper_rules_available = (
            paper_module is not None
            and model_rule_version == paper_module["version"]
        )
        evidence_present = all(
            finding.get("evidence") for finding in document["major_weaknesses"]
        )
        uncertainty = self.uncertainty.normalise_for_downstream(
            document["uncertainty"]["flags"],
            paper_rules_available=paper_rules_available,
            evidence_present=evidence_present,
        )
        if uncertainty["blocking_flags"]:
            # Preserve the record for audit. The existing Weakness Engine will
            # exclude these flags rather than silently using unsafe evidence.
            pass

        defaults = (
            self.registry.context_defaults(paper)
            if paper_module is not None
            else {"topic": f"{paper} / unclassified", "question_type": "UNCLASSIFIED"}
        )
        context = {**defaults, **(context_override or {})}
        cap = uncertainty["confidence_cap"]
        dimensions = {
            item["dimension"]: item for item in document["dimension_assessments"]
        }
        dimension_scores: dict[str, int] = {}
        dimension_confidence: dict[str, str] = {}
        dimension_applicability: dict[str, str] = {}
        for dimension, item in dimensions.items():
            dimension_applicability[dimension] = item["applicability"]
            decision = self.uncertainty.dimension_decision(
                item["applicability"],
                item["confidence"]
                if item["confidence"] in CONFIDENCES
                else "LOW",
                uncertainty["engine_flags"],
            )
            if decision["decision"] != "USE":
                continue
            dimension_scores[dimension] = item["score"]
            dimension_confidence[dimension] = self.uncertainty.cap_confidence(
                item["confidence"], cap
            )

        actions_by_weakness: dict[str, list[dict[str, Any]]] = {}
        for action in document["recommended_improvement_actions"]:
            for weakness_id in action.get("related_weakness_ids", []):
                actions_by_weakness.setdefault(weakness_id, []).append(
                    {
                        "action_id": action.get("action_id"),
                        "priority": action.get("priority"),
                        "action": action.get("action"),
                        "success_check": action.get("success_check"),
                    }
                )

        normalised_findings = []
        for index, item in enumerate(document["major_weaknesses"]):
            provenance = finding_provenance.get(
                ("WEAKNESS", item["weakness_id"]),
                {
                    "source_path": f"$.major_weaknesses[{index}]",
                    "original_dimension": item["dimension"],
                    "canonical_dimension": item["dimension"],
                    "normalisation_action_ids": [],
                },
            )
            adapted_confidence = self.uncertainty.cap_confidence(
                item["confidence"], cap
            )
            normalised_findings.append(
                {
                    "finding_id": item["weakness_id"],
                    "requirement_id": "WHOLE_SCRIPT",
                    "credit_unit_id": "GENERAL",
                    "tag": item["tag"],
                    "dimension": item["dimension"],
                    "canonical_dimension": item["dimension"],
                    "original_dimension": provenance["original_dimension"],
                    "applicability": dimensions[item["dimension"]]["applicability"],
                    "severity": item["severity"],
                    "confidence": adapted_confidence,
                    "classification": "DIAGNOSTIC_WEAKNESS",
                    "direct_credit_reduction_allowed": False,
                    "safeguard_reasons": ["MARK_EFFECT_NOT_INFERRED_BY_ADAPTER"],
                    "rule_status": None,
                    "evidence": deepcopy(item["evidence"]),
                    "evidence_reference": f"{provenance['source_path']}.evidence",
                    "explanation": item["explanation"],
                    "source_gap_class": item["gap_class"],
                    "weakness_class": item["gap_class"],
                    "uncertainty": {
                        "source_flags": deepcopy(uncertainty["source_flags"]),
                        "downstream_flags": deepcopy(uncertainty["engine_flags"]),
                        "confidence_cap": cap,
                    },
                    "severity_change": {
                        "source": item["severity"],
                        "adapted": item["severity"],
                    },
                    "confidence_change": {
                        "source": item["confidence"],
                        "adapted": adapted_confidence,
                    },
                    "normalisation_status": (
                        "NORMALISED_CROSS_FIELD"
                        if provenance["normalisation_action_ids"]
                        else "SOURCE_ALIGNED"
                    ),
                    "provenance": deepcopy(provenance),
                    "recommended_actions": sorted(
                        actions_by_weakness.get(item["weakness_id"], []),
                        key=lambda action: (
                            action.get("priority") is None,
                            action.get("priority") or 0,
                            action.get("action_id") or "",
                        ),
                    ),
                }
            )
        groups = self.deduplicator.group(normalised_findings)
        engine_weaknesses = []
        for group in groups:
            primary = next(
                item
                for item in group["findings"]
                if item["is_root_primary"]
            )
            engine_weaknesses.append(
                {
                    "finding_id": primary["finding_id"],
                    "tag": primary["tag"],
                    "canonical_dimension": primary["canonical_dimension"],
                    "original_dimension": primary["original_dimension"],
                    "applicability": primary["applicability"],
                    "severity": primary["severity"],
                    "confidence": primary["confidence"],
                    "evidence_reference": primary["evidence_reference"],
                    "evidence": deepcopy(primary["evidence"]),
                    "explanation": primary["explanation"],
                    "weakness_class": primary["weakness_class"],
                    "uncertainty": deepcopy(primary["uncertainty"]),
                    "normalisation_status": primary["normalisation_status"],
                    "provenance": deepcopy(primary["provenance"]),
                    "recommended_actions": deepcopy(
                        primary["recommended_actions"]
                    ),
                    "source_finding_ids": deepcopy(group["finding_ids"]),
                }
            )

        strength_evidence = []
        for index, item in enumerate(document["major_strengths"]):
            provenance = finding_provenance.get(
                ("STRENGTH", item["strength_id"]),
                {
                    "source_path": f"$.major_strengths[{index}]",
                    "original_dimension": item["dimension"],
                    "canonical_dimension": item["dimension"],
                    "normalisation_action_ids": [],
                },
            )
            strength_evidence.append(
                {
                    "strength_id": item["strength_id"],
                    "tag": item["tag"],
                    "canonical_dimension": item["dimension"],
                    "original_dimension": provenance["original_dimension"],
                    "applicability": dimensions[item["dimension"]]["applicability"],
                    "confidence": self.uncertainty.cap_confidence(
                        item["confidence"], cap
                    ),
                    "evidence": deepcopy(item["evidence"]),
                    "evidence_reference": f"{provenance['source_path']}.evidence",
                    "explanation": item["explanation"],
                    "normalisation_status": (
                        "NORMALISED_CROSS_FIELD"
                        if provenance["normalisation_action_ids"]
                        else "SOURCE_ALIGNED"
                    ),
                    "provenance": deepcopy(provenance),
                }
            )
        strength_tags = list(dict.fromkeys(item["tag"] for item in strength_evidence))
        generated_at = document["generated_at"]
        return {
            "normalised_evidence_version": "attempt-evidence-v0.2.1",
            "analysis_id": document["analysis_id"],
            "attempt_group_id": document["analysis_id"],
            "attempted_at": generated_at,
            "attempted_at_basis": "DIAGNOSTIC_GENERATED_AT_PROXY",
            "question_key": document["benchmark_case_id"],
            "topic": context["topic"],
            "question_type": context["question_type"],
            "dimension_scores": dimension_scores,
            "dimension_confidence": dimension_confidence,
            "dimension_applicability": dimension_applicability,
            "strength_tags": strength_tags,
            "strength_evidence": strength_evidence,
            "weaknesses": sorted(engine_weaknesses, key=lambda item: item["tag"]),
            "weakness_evidence_groups": groups,
            "uncertainty_flags": uncertainty["engine_flags"],
            "source_uncertainty_flags": uncertainty["source_flags"],
            "uncertainty_treatment": uncertainty,
            "paper_rules": {
                "source_version": model_rule_version,
                "adapter_version": (
                    paper_module["version"] if paper_module is not None else None
                ),
                "available_to_source_diagnosis": paper_rules_available,
            },
            "mark_estimation_eligible": uncertainty["mark_estimation_eligible"],
            "normalisation_audit": normalisation_audit,
            "adapter_audit": {
                "source_case_id": document["benchmark_case_id"],
                "source_weakness_count": len(document["major_weaknesses"]),
                "engine_weakness_count": len(engine_weaknesses),
                "deduplicated_count": len(document["major_weaknesses"])
                - len(engine_weaknesses),
                "mark_effects_inferred": 0,
                "normalisation_action_count": len(normalisation_audit["actions"]),
            },
        }

    def _normalise_cross_fields(
        self, document: dict[str, Any]
    ) -> tuple[
        dict[str, Any],
        dict[str, Any],
        dict[tuple[str, str], dict[str, Any]],
    ]:
        """Repair only auditable placement inconsistencies on a deep copy."""

        if not isinstance(document, dict):
            return document, {
                "version": "cross-field-normaliser-v0.1.0",
                "status": "NOT_RUN_INVALID_ENVELOPE",
                "source_document_modified": False,
                "actions": [],
            }, {}

        normalised = deepcopy(document)
        assessments = normalised.get("dimension_assessments")
        if not isinstance(assessments, list):
            return normalised, {
                "version": "cross-field-normaliser-v0.1.0",
                "status": "NOT_RUN_INVALID_ENVELOPE",
                "source_document_modified": False,
                "actions": [],
            }, {}
        by_dimension = {
            item.get("dimension"): item
            for item in assessments
            if isinstance(item, dict) and isinstance(item.get("dimension"), str)
        }
        actions: list[dict[str, Any]] = []
        provenance: dict[tuple[str, str], dict[str, Any]] = {}
        collection_specs = (
            (
                "WEAKNESS",
                "major_weaknesses",
                "weakness_id",
                "weakness_tags",
                self.tag_dimensions,
            ),
            (
                "STRENGTH",
                "major_strengths",
                "strength_id",
                "strength_tags",
                self.strength_tag_dimensions,
            ),
        )
        for finding_type, collection_key, id_key, tag_list_key, mapping in collection_specs:
            findings = normalised.get(collection_key)
            if not isinstance(findings, list):
                continue
            for index, finding in enumerate(findings):
                if not isinstance(finding, dict):
                    continue
                finding_id = finding.get(id_key)
                tag = finding.get("tag")
                original_dimension = finding.get("dimension")
                canonical_dimension = mapping.get(tag)
                source_path = f"$.{collection_key}[{index}]"
                if not isinstance(finding_id, str) or canonical_dimension is None:
                    continue
                target = by_dimension.get(canonical_dimension)
                target_tags = (
                    target.get(tag_list_key, []) if isinstance(target, dict) else []
                )
                needs_dimension_move = original_dimension != canonical_dimension
                needs_parent_backfill = tag not in target_tags
                if not needs_dimension_move and not needs_parent_backfill:
                    continue
                if (
                    not isinstance(target, dict)
                    or target.get("applicability") != "APPLICABLE"
                ):
                    raise DiagnosticAdapterError(
                        "unsafe semantic contradiction: "
                        f"{finding_type.lower()} {finding_id} uses {tag}, but its "
                        f"canonical dimension {canonical_dimension} is not APPLICABLE"
                    )

                confidence_before = finding.get("confidence")
                confidence_after = confidence_before
                operations = []
                if needs_dimension_move:
                    finding["dimension"] = canonical_dimension
                    operations.append("CANONICAL_DIMENSION_REASSIGNMENT")
                    if confidence_before in CONFIDENCES:
                        confidence_after = self.uncertainty.cap_confidence(
                            confidence_before, "MEDIUM"
                        )
                        finding["confidence"] = confidence_after
                    source_assessment = by_dimension.get(original_dimension)
                    if isinstance(source_assessment, dict):
                        source_tags = source_assessment.get(tag_list_key, [])
                        if isinstance(source_tags, list) and tag in source_tags:
                            source_assessment[tag_list_key] = [
                                value for value in source_tags if value != tag
                            ]
                            operations.append("MISPLACED_PARENT_TAG_REMOVED")
                if needs_parent_backfill:
                    target.setdefault(tag_list_key, []).append(tag)
                    operations.append("CANONICAL_PARENT_TAG_BACKFILL")

                action_id = f"NORM-{len(actions) + 1:03d}"
                actions.append(
                    {
                        "action_id": action_id,
                        "finding_type": finding_type,
                        "finding_id": finding_id,
                        "tag": tag,
                        "source_path": source_path,
                        "original_dimension": original_dimension,
                        "canonical_dimension": canonical_dimension,
                        "operations": operations,
                        "severity_before": finding.get("severity"),
                        "severity_after": finding.get("severity"),
                        "confidence_before": confidence_before,
                        "confidence_after": confidence_after,
                        "flag": "NORMALISED_CROSS_FIELD",
                    }
                )
                provenance[(finding_type, finding_id)] = {
                    "source_path": source_path,
                    "original_dimension": original_dimension,
                    "canonical_dimension": canonical_dimension,
                    "normalisation_action_ids": [action_id],
                }

        return normalised, {
            "version": "cross-field-normaliser-v0.1.0",
            "status": "NORMALISED_CROSS_FIELD" if actions else "SOURCE_ALIGNED",
            "source_document_modified": False,
            "actions": actions,
            "severity_increase_count": 0,
            "confidence_increase_count": 0,
        }, provenance

    def build_profile(
        self,
        document: dict[str, Any],
        *,
        profile_id: str,
        available_question_keys: list[str],
        available_minutes: int = 60,
        context_override: dict[str, str] | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        attempt = self.adapt(document, context_override=context_override)
        profile = {
            "profile_id": profile_id,
            "paper": document["paper"],
            "description": "Single-attempt normalised diagnostic evidence",
            "current_study_context": {
                "topic": attempt["topic"],
                "available_minutes": available_minutes,
            },
            "available_question_keys": list(available_question_keys),
            "attempts": [attempt],
        }
        return profile, attempt

    def _validate(self, document: dict[str, Any]) -> None:
        errors: list[str] = []
        if not isinstance(document, dict):
            raise DiagnosticAdapterError("Diagnostic must be an object")
        missing = sorted(REQUIRED_ROOT_KEYS - document.keys())
        extra = sorted(document.keys() - REQUIRED_ROOT_KEYS)
        if missing:
            errors.append(f"missing root keys {missing}")
        if extra:
            errors.append(f"unexpected root keys {extra}")
        if errors:
            raise DiagnosticAdapterError("; ".join(errors))
        if document["schema_version"] != "1.0.0":
            errors.append("unsupported schema version")
        if not isinstance(document["analysis_id"], str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{2,127}", document["analysis_id"]
        ):
            errors.append("invalid analysis_id")
        if not isinstance(document["benchmark_case_id"], str) or not re.fullmatch(
            r"(?:CASE-[0-9]{3}|ACCA-[A-Z0-9-]+-C[0-9]+)",
            document["benchmark_case_id"],
        ):
            errors.append("invalid benchmark_case_id")
        try:
            if not isinstance(document["generated_at"], str):
                raise TypeError
            datetime.fromisoformat(document["generated_at"].replace("Z", "+00:00"))
        except (TypeError, ValueError):
            errors.append("invalid generated_at")
        paper = document["paper"]
        if paper not in KNOWN_ACCA_PAPERS:
            errors.append(f"unsupported paper {paper}")
        if not isinstance(document["diagnostic_model"], dict):
            errors.append("diagnostic_model must be an object")
        if not isinstance(document["uncertainty"], dict) or not isinstance(
            document["uncertainty"].get("flags")
            if isinstance(document["uncertainty"], dict)
            else None,
            list,
        ):
            errors.append("uncertainty.flags must be a list")
        if (
            paper in KNOWN_ACCA_PAPERS
            and paper not in self.registry.papers()
            and isinstance(document["diagnostic_model"], dict)
        ):
            flags = (
                document["uncertainty"].get("flags", [])
                if isinstance(document["uncertainty"], dict)
                else []
            )
            if document["diagnostic_model"].get("paper_rules_version") is not None:
                errors.append(
                    f"paper {paper} without a registered module requires null paper_rules_version"
                )
            if "PAPER_RULES_UNAVAILABLE" not in flags:
                errors.append(
                    f"paper {paper} without a registered module requires PAPER_RULES_UNAVAILABLE"
                )

        assessments = document["dimension_assessments"]
        if not isinstance(assessments, list) or len(assessments) != 10:
            errors.append("exactly ten dimension assessments required")
            assessments = []
        by_dimension: dict[str, dict[str, Any]] = {}
        for index, item in enumerate(assessments):
            if not isinstance(item, dict):
                errors.append(f"dimension assessment {index} must be an object")
                continue
            dimension = item.get("dimension")
            if dimension in by_dimension:
                errors.append(f"duplicate dimension {dimension}")
            by_dimension[dimension] = item
            applicability = item.get("applicability")
            if applicability not in {
                "APPLICABLE",
                "NOT_APPLICABLE",
                "INSUFFICIENT_EVIDENCE",
            }:
                errors.append(f"invalid applicability for {dimension}")
            if applicability == "APPLICABLE":
                if item.get("score") not in {0, 1, 2, 3, 4}:
                    errors.append(f"invalid score for {dimension}")
                if item.get("confidence") not in CONFIDENCES:
                    errors.append(f"invalid confidence for {dimension}")
            elif item.get("score") is not None:
                errors.append(f"non-applicable dimension {dimension} has a score")
            for tag in item.get("weakness_tags", []):
                if self.tag_dimensions.get(tag) != dimension:
                    errors.append(f"tag {tag} does not belong to {dimension}")
            for tag in item.get("strength_tags", []):
                if self.strength_tag_dimensions.get(tag) != dimension:
                    errors.append(f"strength tag {tag} does not belong to {dimension}")

        weaknesses = document["major_weaknesses"]
        if not isinstance(weaknesses, list):
            errors.append("major_weaknesses must be a list")
            weaknesses = []
        weakness_ids: set[str] = set()
        for index, finding in enumerate(weaknesses):
            if not isinstance(finding, dict):
                errors.append(f"major weakness {index} must be an object")
                continue
            finding_id = finding.get("weakness_id")
            if finding_id in weakness_ids:
                errors.append(f"duplicate weakness_id {finding_id}")
            weakness_ids.add(finding_id)
            dimension = finding.get("dimension")
            tag = finding.get("tag")
            if self.tag_dimensions.get(tag) != dimension:
                errors.append(f"weakness tag {tag} does not belong to {dimension}")
            assessment = by_dimension.get(dimension)
            if not assessment or tag not in assessment.get("weakness_tags", []):
                errors.append(
                    f"weakness {finding_id} tag {tag} is absent from its dimension assessment"
                )
            elif assessment.get("applicability") != "APPLICABLE":
                errors.append(
                    f"weakness {finding_id} conflicts with non-applicable dimension {dimension}"
                )
            if finding.get("severity") not in SEVERITIES:
                errors.append(f"invalid severity for {finding_id}")
            if finding.get("confidence") not in CONFIDENCES:
                errors.append(f"invalid confidence for {finding_id}")
            if not finding.get("evidence"):
                errors.append(f"missing evidence for {finding_id}")

        strengths = document["major_strengths"]
        if not isinstance(strengths, list):
            errors.append("major_strengths must be a list")
            strengths = []
        for index, strength in enumerate(strengths):
            if not isinstance(strength, dict):
                errors.append(f"major strength {index} must be an object")
                continue
            dimension = strength.get("dimension")
            tag = strength.get("tag")
            if self.strength_tag_dimensions.get(tag) != dimension:
                errors.append(f"strength tag {tag} does not belong to {dimension}")
            assessment = by_dimension.get(dimension)
            if not assessment or strength.get("tag") not in assessment.get(
                "strength_tags", []
            ):
                errors.append(
                    f"strength {strength.get('strength_id')} is absent from its dimension assessment"
                )
            elif assessment.get("applicability") != "APPLICABLE":
                errors.append(
                    f"strength {strength.get('strength_id')} conflicts with non-applicable dimension {dimension}"
                )
            if strength.get("confidence") not in CONFIDENCES:
                errors.append(f"invalid strength confidence")
            if not strength.get("evidence"):
                errors.append(f"missing strength evidence")

        if errors:
            raise DiagnosticAdapterError("; ".join(errors))


class DeterministicDownstreamPipeline:
    """Run adapter → Weakness Engine → Recommendation Engine."""

    def __init__(
        self,
        engine_config: dict[str, Any],
        registry: PaperRuleRegistry | None = None,
        ledger_config: dict[str, Any] | None = None,
    ):
        self.adapter = DiagnosticToAttemptAdapter(
            engine_config, registry=registry, ledger_config=ledger_config
        )
        self.weakness_engine = WeaknessEngine(engine_config)
        self.recommendation_engine = RecommendationEngine(engine_config)

    def run(
        self,
        document: dict[str, Any],
        catalogue: list[dict[str, Any]],
        *,
        profile_id: str,
        available_minutes: int = 60,
        as_of: str,
        limit: int = 2,
    ) -> dict[str, Any]:
        keys = [
            item["question_key"]
            for item in catalogue
            if item.get("paper") == document.get("paper")
        ]
        profile, attempt = self.adapter.build_profile(
            document,
            profile_id=profile_id,
            available_question_keys=keys,
            available_minutes=available_minutes,
        )
        weakness = self.weakness_engine.analyze_profile(profile)
        recommendation = self.recommendation_engine.rank_questions(
            profile,
            weakness,
            catalogue,
            limit=limit,
            as_of=as_of,
            allow_specific_questions=attempt["paper_rules"][
                "available_to_source_diagnosis"
            ],
        )
        result = {
            "normalised_attempt": attempt,
            "profile": profile,
            "weakness_result": weakness,
            "recommendation_result": recommendation,
        }
        from .beta_backend import build_beta_backend_payload

        result["beta_backend_payload"] = build_beta_backend_payload(document, result)
        return result
