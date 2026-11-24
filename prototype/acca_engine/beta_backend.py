"""Part of ../../PROJECT.md — allow-listed private-beta response presenter."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def build_beta_backend_payload(
    document: dict[str, Any], pipeline_result: dict[str, Any]
) -> dict[str, Any]:
    """Return only fields approved for the human-reviewed AFM/SBR beta UI."""

    attempt = pipeline_result["normalised_attempt"]
    recommendation = pipeline_result["recommendation_result"]
    base = {
        "contract_version": "beta-backend-v0.2.0",
        "analysis_reference": document["analysis_id"],
        "paper": document["paper"],
        "human_review_required": True,
    }
    if not attempt["paper_rules"]["available_to_source_diagnosis"]:
        return {
            **base,
            "release_status": "WITHHELD_UNSUPPORTED_PAPER",
            "withholding_reasons": [
                "This paper has no validated production paper-rule module.",
                "Universal evidence may be retained internally, but no student view is released.",
            ],
            "student_view": None,
        }

    normalised_weaknesses = {
        finding["finding_id"]: finding
        for group in attempt["weakness_evidence_groups"]
        for finding in group["findings"]
    }
    strengths = [
        {
            "strength_reference": item["strength_id"],
            "dimension": item["canonical_dimension"],
            "confidence": item["confidence"],
            "evidence": deepcopy(item["evidence"]),
            "explanation": item["explanation"],
        }
        for item in attempt["strength_evidence"]
    ]
    weaknesses = []
    for source in document["major_weaknesses"]:
        normalised = normalised_weaknesses[source["weakness_id"]]
        weaknesses.append(
            {
                "weakness_reference": source["weakness_id"],
                "dimension": normalised["canonical_dimension"],
                "category": source["gap_class"],
                "severity": source["severity"],
                "confidence": normalised["confidence"],
                "evidence": deepcopy(source["evidence"]),
                "explanation": source["explanation"],
            }
        )

    assessments = []
    for item in document["dimension_assessments"]:
        dimension = item["dimension"]
        if dimension not in attempt["dimension_scores"]:
            continue
        assessments.append(
            {
                "dimension": dimension,
                "applicability": item["applicability"],
                "assessment": item["categorical_assessment"],
                "confidence": attempt["dimension_confidence"][dimension],
                "evidence": deepcopy(item["evidence"]),
                "rationale": item["rationale"],
            }
        )

    priorities = []
    actions = document["recommended_improvement_actions"]
    for priority in sorted(
        document["priority_weaknesses"], key=lambda item: item["priority_rank"]
    ):
        weakness = normalised_weaknesses.get(priority["weakness_id"])
        if weakness is None:
            continue
        matching_actions = [
            action
            for action in actions
            if priority["weakness_id"] in action.get("related_weakness_ids", [])
        ]
        matching_actions.sort(key=lambda action: (action["priority"], action["action_id"]))
        action = matching_actions[0] if matching_actions else {}
        priorities.append(
            {
                "priority": priority["priority_rank"],
                "weakness_reference": priority["weakness_id"],
                "dimension": weakness["canonical_dimension"],
                "reason": priority["reason"],
                "practice_action": action.get("action"),
                "success_check": action.get("success_check"),
            }
        )

    skill_recommendations = [
        {
            "recommendation_type": "SKILL_RECOMMENDATION",
            "rank": item["rank"],
            "skill": item["skill_label"],
            "dimension": item["dimension"],
            "confidence": item["confidence"],
            "practice_action": item["practice_action"],
            "success_check": item["success_check"],
        }
        for item in recommendation["skill_recommendations"]
    ]
    low_confidence_dimensions = sorted(
        dimension
        for dimension, confidence in attempt["dimension_confidence"].items()
        if confidence == "LOW"
    )
    notices = deepcopy(document["uncertainty"]["details"])
    if low_confidence_dimensions:
        notices.append(
            "Low-confidence evidence affects: "
            + ", ".join(dimension.replace("_", " ").title() for dimension in low_confidence_dimensions)
            + "."
        )

    return {
        **base,
        "release_status": "HUMAN_REVIEW_REQUIRED",
        "withholding_reasons": [],
        "student_view": {
            "diagnostic_summary": document["diagnosis_summary"],
            "major_strengths": strengths,
            "major_weaknesses": weaknesses,
            "dimension_assessments": assessments,
            "priority_improvement_areas": priorities,
            "skill_recommendations": skill_recommendations,
            "uncertainty_notices": notices,
            "disclaimer": "Diagnostic feedback only; this is not an official ACCA mark.",
        },
    }
