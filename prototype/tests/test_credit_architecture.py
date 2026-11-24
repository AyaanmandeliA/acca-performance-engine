"""Part of ../../PROJECT.md — synthetic v0.2 credit architecture tests."""

from __future__ import annotations

import json
import unittest
from copy import deepcopy
from pathlib import Path

from acca_engine.configuration import PROTOTYPE_ROOT, load_config, load_fixture_bundle
from acca_engine.credit_ledger import CreditLedgerEngine, CreditLedgerError
from acca_engine.diagnostic_adapter import (
    DeterministicDownstreamPipeline,
    DiagnosticAdapterError,
    DiagnosticToAttemptAdapter,
)
from acca_engine.paper_rules import PaperRuleRegistry


FIXTURE_PATH = PROTOTYPE_ROOT / "fixtures/vnext_synthetic_cases.json"


class CreditArchitectureTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_config()
        cls.bundle = load_fixture_bundle()
        cls.catalogue = cls.bundle["synthetic_question_catalogue"]
        cls.fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        cls.valid_diagnostic = cls.fixture["valid_diagnostic"]
        cls.registry = PaperRuleRegistry()
        cls.ledger = CreditLedgerEngine(cls.registry)
        cls.adapter = DiagnosticToAttemptAdapter(cls.config, cls.registry)
        cls.pipeline = DeterministicDownstreamPipeline(cls.config, cls.registry)

    @staticmethod
    def finding(
        finding_id: str,
        tag: str,
        rule_id: str | None,
        *,
        paper: str = "AFM",
        credit_unit_id: str = "u1",
        classification: str = "MARK_MATERIAL_WEAKNESS",
        severity: str = "MODERATE",
        confidence: str = "HIGH",
        safeguards: dict | None = None,
        finding_type: str = "SUBSTANCE",
        root_issue_id: str | None = None,
    ) -> dict:
        item = {
            "finding_id": finding_id,
            "tag": tag,
            "requirement_id": "r1",
            "credit_unit_id": credit_unit_id,
            "proposed_classification": classification,
            "severity": severity,
            "confidence": confidence,
            "evidence": [{"answer_location": "Synthetic response", "excerpt": finding_id}],
            "explanation": f"Synthetic {paper} finding {finding_id}.",
            "rule_id": rule_id,
            "finding_type": finding_type,
            "safeguards": safeguards or {},
        }
        if root_issue_id:
            item["root_issue_id"] = root_issue_id
        return item

    @staticmethod
    def unit(
        unit_id: str,
        credit_type: str,
        rule_id: str,
        *,
        marks: float = 1,
        low: float = 1,
        high: float = 1,
        status: str = "AWARDED",
        basis: str = "EXPLICIT_MARKING_CONTEXT",
        finding_ids: list[str] | None = None,
        confidence: str = "HIGH",
    ) -> dict:
        return {
            "unit_id": unit_id,
            "label": unit_id.replace("_", " ").title(),
            "credit_type": credit_type,
            "marks_available": marks,
            "credit_status": status,
            "credit_min": low,
            "credit_max": high,
            "confidence": confidence,
            "evidence": [{"answer_location": "Synthetic response", "excerpt": unit_id}],
            "reason": "Synthetic deterministic test unit.",
            "credit_basis": basis,
            "rule_id": rule_id,
            "finding_ids": finding_ids or [],
        }

    @classmethod
    def assessment(
        cls,
        paper: str,
        units: list[dict],
        findings: list[dict] | None = None,
        *,
        marks: float | None = None,
        flags: list[str] | None = None,
        ledger_id: str = "synthetic-ledger",
    ) -> dict:
        available = marks if marks is not None else sum(item["marks_available"] for item in units)
        return {
            "ledger_id": ledger_id,
            "paper": paper,
            "requirements": [
                {
                    "requirement_id": "r1",
                    "marks_available": available,
                    "credit_units": units,
                    "findings": findings or [],
                }
            ],
            "uncertainty_flags": flags or [],
        }

    def build(self, paper: str, units: list[dict], findings: list[dict] | None = None, **kwargs):
        return self.ledger.build(self.assessment(paper, units, findings, **kwargs))

    def test_01_fixture_covers_all_required_synthetic_scenarios(self):
        scenarios = {item["scenario"] for item in self.fixture["credit_case_specs"]}
        self.assertEqual(len(scenarios), 13)
        self.assertEqual(
            scenarios,
            {
                "CORRECT_CALCULATION_WEAK_INTERPRETATION",
                "INCORRECT_METHOD",
                "CORRECT_METHOD_ARITHMETIC_ERROR",
                "STRONG_PROFESSIONAL_SKILLS",
                "WEAK_PROFESSIONAL_SKILLS",
                "CORRECT_TREATMENT",
                "OWN_FIGURE_CONSEQUENTIAL_CREDIT",
                "VALID_SPREADSHEET",
                "GENUINE_EXECUTION_PROBLEM",
                "OVERLAPPING_WEAKNESSES",
                "STYLE_NOTE_NO_MARK_EFFECT",
                "LOW_CONFIDENCE_BROAD_RANGE",
                "INSUFFICIENT_EVIDENCE",
            },
        )

    def test_02_paper_rules_are_versioned_and_evidence_statused(self):
        self.assertEqual(self.registry.papers(), ["AFM", "SBR"])
        self.assertEqual(self.registry.get("AFM")["version"], "afm-rules-v0.2.0")
        self.assertEqual(self.registry.get("SBR")["version"], "sbr-rules-v0.2.0")
        statuses = {
            rule["status"]
            for paper in self.registry.papers()
            for rule in self.registry.get(paper)["rules"]
        }
        self.assertEqual(
            statuses,
            {
                "SUPPORTED_BY_EXISTING_PROJECT_EVIDENCE",
                "UNVALIDATED",
                "INSUFFICIENT_EVIDENCE",
            },
        )

    def test_03_correct_calculation_and_weak_interpretation_are_separate_units(self):
        finding = self.finding(
            "weak_interpretation",
            "CALCULATION_NOT_INTERPRETED",
            "AFM-CALCULATION-INTERPRETATION-SPLIT",
            credit_unit_id="interpretation",
        )
        units = [
            self.unit(
                "calculation",
                "QUANTITATIVE_ACCURACY",
                "AFM-CALCULATION-INTERPRETATION-SPLIT",
            ),
            self.unit(
                "interpretation",
                "QUANTITATIVE_INTERPRETATION",
                "AFM-CALCULATION-INTERPRETATION-SPLIT",
                low=0,
                high=0,
                status="NOT_AWARDED",
                basis="DIAGNOSTIC_INFERENCE",
                finding_ids=["weak_interpretation"],
            ),
        ]
        result = self.build("AFM", units, [finding])
        self.assertEqual(result["derived_mark"]["value"], 1)
        self.assertEqual(result["derived_mark"]["range"], {"low": 1.0, "high": 1.0})

    def test_04_incorrect_afm_method_reduces_only_supported_unit(self):
        finding = self.finding(
            "wrong_method", "TECHNICAL_CONCEPT_INCORRECT", "AFM-TECHNICAL-POINTS"
        )
        unit = self.unit(
            "u1",
            "METHOD",
            "AFM-TECHNICAL-POINTS",
            low=0,
            high=0,
            status="NOT_AWARDED",
            basis="DIAGNOSTIC_INFERENCE",
            finding_ids=["wrong_method"],
        )
        result = self.build("AFM", [unit], [finding])
        self.assertEqual(result["derived_mark"]["value"], 0)

    def test_05_correct_method_arithmetic_error_preserves_other_credit(self):
        finding = self.finding(
            "arithmetic_error", "CALCULATION_ERROR", "AFM-TECHNICAL-POINTS", credit_unit_id="accuracy"
        )
        units = [
            self.unit("method", "METHOD", "AFM-TECHNICAL-POINTS"),
            self.unit(
                "accuracy",
                "QUANTITATIVE_ACCURACY",
                "AFM-TECHNICAL-POINTS",
                low=0,
                high=0,
                status="NOT_AWARDED",
                basis="DIAGNOSTIC_INFERENCE",
                finding_ids=["arithmetic_error"],
            ),
            self.unit(
                "follow_through",
                "OWN_FIGURE_FOLLOW_THROUGH",
                "AFM-TECHNICAL-POINTS",
            ),
        ]
        result = self.build("AFM", units, [finding])
        self.assertEqual(result["derived_mark"]["value"], 2)

    def test_06_strong_afm_professional_components_earn_separate_credit(self):
        units = [
            self.unit("analysis", "ANALYSIS_EVALUATION", "AFM-PROF-ANALYSIS-EVALUATION"),
            self.unit("scepticism", "SCEPTICISM", "AFM-PROF-SCEPTICISM"),
            self.unit("commercial", "COMMERCIAL_ACUMEN", "AFM-PROF-COMMERCIAL-ACUMEN"),
        ]
        result = self.build("AFM", units)
        self.assertEqual(result["derived_mark"]["value"], 3)

    def test_07_weak_afm_professional_components_are_independently_audited(self):
        specs = [
            ("analysis", "ANALYSIS_UNDERDEVELOPED", "ANALYSIS_EVALUATION", "AFM-PROF-ANALYSIS-EVALUATION"),
            ("scepticism", "CHALLENGE_INSUFFICIENT", "SCEPTICISM", "AFM-PROF-SCEPTICISM"),
            ("commercial", "COMMERCIAL_IMPLICATIONS_MISSED", "COMMERCIAL_ACUMEN", "AFM-PROF-COMMERCIAL-ACUMEN"),
        ]
        findings = [
            self.finding(name, tag, rule, credit_unit_id=name)
            for name, tag, _, rule in specs
        ]
        units = [
            self.unit(
                name,
                credit_type,
                rule,
                low=0,
                high=0,
                status="NOT_AWARDED",
                basis="DIAGNOSTIC_INFERENCE",
                finding_ids=[name],
            )
            for name, _, credit_type, rule in specs
        ]
        result = self.build("AFM", units, findings)
        self.assertEqual(result["derived_mark"]["value"], 0)
        self.assertEqual(len(result["requirements"][0]["credit_units"]), 3)

    def test_08_correct_sbr_treatment_receives_explicit_technical_credit(self):
        unit = self.unit(
            "treatment", "TECHNICAL_REPORTING", "SBR-TECHNICAL-REPORTING-POINTS", marks=2, low=2, high=2
        )
        result = self.build("SBR", [unit])
        self.assertEqual(result["derived_mark"]["value"], 2)

    def test_09_sbr_own_figure_credit_survives_an_arithmetic_error(self):
        finding = self.finding(
            "sbr_arithmetic",
            "CALCULATION_ERROR",
            "SBR-TECHNICAL-REPORTING-POINTS",
            paper="SBR",
            credit_unit_id="accuracy",
        )
        units = [
            self.unit("method", "METHOD", "SBR-TECHNICAL-REPORTING-POINTS"),
            self.unit(
                "accuracy",
                "WORKING_CALCULATION",
                "SBR-TECHNICAL-REPORTING-POINTS",
                low=0,
                high=0,
                status="NOT_AWARDED",
                basis="DIAGNOSTIC_INFERENCE",
                finding_ids=["sbr_arithmetic"],
            ),
            self.unit(
                "follow_through",
                "OWN_FIGURE_FOLLOW_THROUGH",
                "SBR-OWN-FIGURE-FOLLOW-THROUGH",
            ),
        ]
        result = self.build("SBR", units, [finding])
        self.assertEqual(result["derived_mark"]["value"], 2)

    def test_10_valid_sbr_spreadsheet_is_a_style_note_not_a_penalty(self):
        finding = self.finding(
            "spreadsheet_format",
            "POOR_FORMATTING",
            "SBR-LABELLED-SPREADSHEET",
            paper="SBR",
            classification="MARK_MATERIAL_WEAKNESS",
            safeguards={"accepted_format": True},
            finding_type="FORMAT",
        )
        unit = self.unit(
            "u1", "WORKING_CALCULATION", "SBR-LABELLED-SPREADSHEET", finding_ids=["spreadsheet_format"]
        )
        result = self.build("SBR", [unit], [finding])
        self.assertEqual(result["requirements"][0]["findings"][0]["classification"], "STYLE_NOTE")
        self.assertEqual(result["derived_mark"]["value"], 1)

    def test_11_genuine_sbr_execution_problem_can_be_mark_material(self):
        finding = self.finding(
            "missing_requirement",
            "REQUIREMENT_PART_OMITTED",
            "SBR-TECHNICAL-REPORTING-POINTS",
            paper="SBR",
        )
        unit = self.unit(
            "u1",
            "TECHNICAL_REPORTING",
            "SBR-TECHNICAL-REPORTING-POINTS",
            low=0,
            high=0,
            status="NOT_AWARDED",
            basis="DIAGNOSTIC_INFERENCE",
            finding_ids=["missing_requirement"],
        )
        result = self.build("SBR", [unit], [finding])
        self.assertEqual(result["derived_mark"]["value"], 0)

    def test_12_overlapping_findings_create_one_effective_penalty(self):
        findings = [
            self.finding(
                "overlap_a",
                "CALCULATION_NOT_INTERPRETED",
                "AFM-CALCULATION-INTERPRETATION-SPLIT",
                root_issue_id="root-decision-use",
            ),
            self.finding(
                "overlap_b",
                "CONCLUSION_NOT_SUPPORTED",
                "AFM-CALCULATION-INTERPRETATION-SPLIT",
                root_issue_id="root-decision-use",
            ),
        ]
        unit = self.unit(
            "u1",
            "QUANTITATIVE_INTERPRETATION",
            "AFM-CALCULATION-INTERPRETATION-SPLIT",
            low=0,
            high=0,
            status="NOT_AWARDED",
            basis="DIAGNOSTIC_INFERENCE",
            finding_ids=["overlap_a", "overlap_b"],
        )
        result = self.build("AFM", [unit], findings)
        audit = result["deduplication_audit"][0]
        self.assertEqual(audit["effective_mark_penalty_count"], 1)
        self.assertEqual(set(audit["finding_ids"]), {"overlap_a", "overlap_b"})

    def test_13_style_note_cannot_reduce_credit_without_material_support(self):
        finding = self.finding(
            "style_only",
            "POOR_FORMATTING",
            "SBR-LABELLED-SPREADSHEET",
            paper="SBR",
            safeguards={"accepted_format": True},
            finding_type="FORMAT",
        )
        unit = self.unit(
            "u1",
            "WORKING_CALCULATION",
            "SBR-LABELLED-SPREADSHEET",
            low=0,
            high=0,
            status="NOT_AWARDED",
            basis="DIAGNOSTIC_INFERENCE",
            finding_ids=["style_only"],
        )
        with self.assertRaisesRegex(CreditLedgerError, "reduces credit without"):
            self.build("SBR", [unit], [finding])

    def test_14_low_confidence_credit_produces_a_broad_range(self):
        unit = self.unit(
            "u1",
            "TECHNICAL",
            "AFM-TECHNICAL-POINTS",
            low=0,
            high=0.5,
            status="INSUFFICIENT_EVIDENCE",
            basis="UNAVAILABLE",
            confidence="LOW",
        )
        result = self.build("AFM", [unit])
        self.assertEqual(result["derived_mark"]["decision"], "BROAD_RANGE")
        self.assertIsNone(result["derived_mark"]["value"])

    def test_15_insufficient_evidence_abstains_from_point_mark(self):
        unit = self.unit(
            "u1",
            "TECHNICAL",
            "AFM-TECHNICAL-POINTS",
            low=0.4,
            high=0.6,
            status="INSUFFICIENT_EVIDENCE",
            basis="UNAVAILABLE",
            confidence="LOW",
        )
        result = self.build("AFM", [unit])
        self.assertEqual(result["derived_mark"]["decision"], "BROAD_RANGE")
        self.assertIn("INSUFFICIENT_EVIDENCE", result["derived_mark"]["reasons"])

    def test_16_unsafe_or_too_wide_evidence_refuses_a_mark_estimate(self):
        unit = self.unit(
            "u1",
            "TECHNICAL",
            "AFM-TECHNICAL-POINTS",
            low=0,
            high=1,
            status="INSUFFICIENT_EVIDENCE",
            basis="UNAVAILABLE",
            confidence="LOW",
        )
        too_wide = self.build("AFM", [unit])
        self.assertEqual(too_wide["derived_mark"]["decision"], "REFUSE_ESTIMATE")
        unsafe = self.build("AFM", [unit], flags=["SOURCE_UNREADABLE"])
        self.assertEqual(unsafe["derived_mark"]["decision"], "REFUSE_ESTIMATE")

    def test_17_not_applicable_dimension_does_not_enter_weakness_engine_input(self):
        document = deepcopy(self.valid_diagnostic)
        dimension = next(
            item for item in document["dimension_assessments"] if item["dimension"] == "EXAM_EXECUTION"
        )
        dimension.update(
            applicability="NOT_APPLICABLE",
            score=None,
            categorical_assessment="NOT_ASSESSED",
            confidence="NOT_ASSESSED",
        )
        attempt = self.adapter.adapt(document)
        self.assertNotIn("EXAM_EXECUTION", attempt["dimension_scores"])
        self.assertEqual(attempt["dimension_applicability"]["EXAM_EXECUTION"], "NOT_APPLICABLE")

    def test_18_low_confidence_dimension_is_retained_but_has_no_engine_exposure(self):
        document = deepcopy(self.valid_diagnostic)
        dimension = next(
            item
            for item in document["dimension_assessments"]
            if item["dimension"] == "QUANTITATIVE_INTERPRETATION"
        )
        dimension["confidence"] = "LOW"
        document["major_weaknesses"][0]["confidence"] = "LOW"
        result = self.pipeline.run(
            document,
            self.catalogue,
            profile_id="low-confidence-adapter",
            as_of="2026-10-04T00:00:00Z",
        )
        self.assertEqual(
            result["normalised_attempt"]["dimension_confidence"]["QUANTITATIVE_INTERPRETATION"],
            "LOW",
        )
        self.assertEqual(result["weakness_result"]["weakness_profiles"], [])

    def test_19_valid_diagnostic_enters_weakness_engine_through_adapter(self):
        result = self.pipeline.run(
            deepcopy(self.valid_diagnostic),
            self.catalogue,
            profile_id="adapter-entry",
            as_of="2026-10-04T00:00:00Z",
        )
        attempt = result["normalised_attempt"]
        self.assertEqual(attempt["adapter_audit"]["mark_effects_inferred"], 0)
        self.assertEqual(attempt["weaknesses"][0]["tag"], "CALCULATION_NOT_INTERPRETED")
        self.assertEqual(result["weakness_result"]["student_id"], "adapter-entry")

    def test_20_one_diagnosis_is_observed_not_recurring(self):
        result = self.pipeline.run(
            deepcopy(self.valid_diagnostic),
            self.catalogue,
            profile_id="single-attempt",
            as_of="2026-10-04T00:00:00Z",
        )
        weakness = result["weakness_result"]["weakness_profiles"][0]
        self.assertEqual(weakness["state"], "OBSERVED")
        self.assertNotEqual(weakness["state"], "RECURRING")
        self.assertEqual(weakness["counts"]["hits"], 1)

    def test_21_recommendation_engine_receives_resulting_profile(self):
        result = self.pipeline.run(
            deepcopy(self.valid_diagnostic),
            self.catalogue,
            profile_id="adapter-recommendation",
            as_of="2026-10-04T00:00:00Z",
        )
        recommendation = result["recommendation_result"]
        self.assertEqual(recommendation["student_id"], result["weakness_result"]["student_id"])
        self.assertEqual(recommendation["paper"], "AFM")
        self.assertEqual(recommendation["outcome"], "RECOMMENDATIONS_AVAILABLE")

    def test_22_unavailable_source_paper_rules_are_downgraded_not_silently_discarded(self):
        document = deepcopy(self.valid_diagnostic)
        document["diagnostic_model"]["paper_rules_version"] = "paper-rules-unavailable"
        document["uncertainty"]["flags"] = ["PAPER_RULES_UNAVAILABLE"]
        attempt = self.adapter.adapt(document)
        self.assertIn("PAPER_RULES_UNAVAILABLE", attempt["source_uncertainty_flags"])
        self.assertNotIn("PAPER_RULES_UNAVAILABLE", attempt["uncertainty_flags"])
        self.assertEqual(attempt["weaknesses"][0]["confidence"], "MEDIUM")
        self.assertFalse(attempt["mark_estimation_eligible"])

    def test_23_blocking_uncertainty_stays_blocking(self):
        document = deepcopy(self.valid_diagnostic)
        document["uncertainty"]["flags"] = ["SOURCE_UNREADABLE"]
        result = self.pipeline.run(
            document,
            self.catalogue,
            profile_id="blocked-source",
            as_of="2026-10-04T00:00:00Z",
        )
        self.assertIn("SOURCE_UNREADABLE", result["normalised_attempt"]["uncertainty_flags"])
        self.assertEqual(result["weakness_result"]["weakness_profiles"], [])

    def test_24_same_dimension_parent_omission_is_audited_and_normalised(self):
        document = deepcopy(self.valid_diagnostic)
        document["dimension_assessments"][6]["weakness_tags"] = []
        attempt = self.adapter.adapt(document)
        self.assertEqual(
            attempt["normalisation_audit"]["status"],
            "NORMALISED_CROSS_FIELD",
        )
        self.assertEqual(
            attempt["normalisation_audit"]["actions"][0]["operations"],
            ["CANONICAL_PARENT_TAG_BACKFILL"],
        )

    def test_25_pipeline_is_deterministic(self):
        kwargs = {
            "profile_id": "deterministic-adapter",
            "as_of": "2026-10-04T00:00:00Z",
        }
        first = self.pipeline.run(deepcopy(self.valid_diagnostic), self.catalogue, **kwargs)
        second = self.pipeline.run(deepcopy(self.valid_diagnostic), self.catalogue, **kwargs)
        self.assertEqual(first, second)

    def test_26_valid_own_figure_finding_cannot_directly_reduce_credit(self):
        finding = self.finding(
            "own_figure_valid",
            "CALCULATION_ERROR",
            "SBR-OWN-FIGURE-FOLLOW-THROUGH",
            paper="SBR",
            safeguards={"own_figure_follow_through_valid": True},
        )
        unit = self.unit(
            "u1",
            "OWN_FIGURE_FOLLOW_THROUGH",
            "SBR-OWN-FIGURE-FOLLOW-THROUGH",
            finding_ids=["own_figure_valid"],
        )
        result = self.build("SBR", [unit], [finding])
        classified = result["requirements"][0]["findings"][0]
        self.assertEqual(classified["classification"], "DIAGNOSTIC_WEAKNESS")
        self.assertFalse(classified["direct_credit_reduction_allowed"])
        self.assertEqual(result["derived_mark"]["value"], 1)

    def test_27_alternative_valid_working_is_style_only(self):
        finding = self.finding(
            "alternative_valid",
            "POOR_FORMATTING",
            "SBR-ALTERNATIVE-WORKINGS",
            paper="SBR",
            safeguards={"alternative_working_valid": True},
            finding_type="FORMAT",
        )
        unit = self.unit(
            "u1",
            "WORKING_CALCULATION",
            "SBR-ALTERNATIVE-WORKINGS",
            finding_ids=["alternative_valid"],
        )
        result = self.build("SBR", [unit], [finding])
        self.assertEqual(result["requirements"][0]["findings"][0]["classification"], "STYLE_NOTE")
        self.assertEqual(result["derived_mark"]["range"], {"low": 1.0, "high": 1.0})

    def test_28_concise_but_complete_answer_is_style_only(self):
        finding = self.finding(
            "concise_complete",
            "POINT_IDENTIFIED_NOT_DEVELOPED",
            "SBR-CONCISE-BUT-COMPLETE",
            paper="SBR",
            safeguards={"concise_but_complete": True},
        )
        unit = self.unit(
            "u1",
            "NARRATIVE_EXPLANATION",
            "SBR-CONCISE-BUT-COMPLETE",
            finding_ids=["concise_complete"],
        )
        result = self.build("SBR", [unit], [finding])
        self.assertEqual(result["requirements"][0]["findings"][0]["classification"], "STYLE_NOTE")
        self.assertEqual(result["derived_mark"]["range"], {"low": 1.0, "high": 1.0})

    def test_29_finding_in_insufficient_evidence_dimension_is_rejected(self):
        document = deepcopy(self.valid_diagnostic)
        dimension = next(
            item
            for item in document["dimension_assessments"]
            if item["dimension"] == "QUANTITATIVE_INTERPRETATION"
        )
        dimension.update(
            applicability="INSUFFICIENT_EVIDENCE",
            score=None,
            categorical_assessment="NOT_ASSESSED",
            confidence="LOW",
        )
        with self.assertRaisesRegex(
            DiagnosticAdapterError,
            "conflicts with non-applicable dimension",
        ):
            self.adapter.adapt(document)

    def test_30_malformed_nested_diagnostic_is_rejected_without_crashing(self):
        document = deepcopy(self.valid_diagnostic)
        document["diagnostic_model"] = []
        document["major_weaknesses"] = "not-a-list"
        with self.assertRaisesRegex(
            DiagnosticAdapterError,
            "diagnostic_model must be an object",
        ):
            self.adapter.adapt(document)

    def test_31_unregistered_fr_paper_enters_adapter_only_fail_closed(self):
        document = deepcopy(self.valid_diagnostic)
        document["paper"] = "FR"
        document["diagnostic_model"]["paper_rules_version"] = None
        document["uncertainty"]["flags"] = ["PAPER_RULES_UNAVAILABLE"]
        attempt = self.adapter.adapt(document)
        self.assertEqual(attempt["question_type"], "UNCLASSIFIED")
        self.assertIsNone(attempt["paper_rules"]["adapter_version"])
        self.assertFalse(attempt["paper_rules"]["available_to_source_diagnosis"])
        self.assertIn("PAPER_RULES_UNAVAILABLE", attempt["source_uncertainty_flags"])
        self.assertFalse(attempt["mark_estimation_eligible"])


if __name__ == "__main__":
    unittest.main()
