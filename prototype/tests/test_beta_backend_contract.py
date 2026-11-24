"""Part of ../../PROJECT.md — final private-beta backend contract regressions."""

from __future__ import annotations

import json
import unittest
from copy import deepcopy

from acca_engine.configuration import PROTOTYPE_ROOT, load_config, load_fixture_bundle
from acca_engine.credit_ledger import FalseCriticismController
from acca_engine.diagnostic_adapter import (
    DeterministicDownstreamPipeline,
    DiagnosticAdapterError,
    DiagnosticToAttemptAdapter,
)
from acca_engine.paper_rules import PaperRuleRegistry


class BetaBackendContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_config()
        cls.bundle = load_fixture_bundle()
        fixture = json.loads(
            (PROTOTYPE_ROOT / "fixtures/vnext_synthetic_cases.json").read_text(
                encoding="utf-8"
            )
        )
        cls.valid = fixture["valid_diagnostic"]
        cls.registry = PaperRuleRegistry()
        cls.adapter = DiagnosticToAttemptAdapter(cls.config, cls.registry)
        cls.pipeline = DeterministicDownstreamPipeline(cls.config, cls.registry)

    def cross_dimension_document(self) -> dict:
        document = deepcopy(self.valid)
        document["major_weaknesses"][0]["dimension"] = "ANALYSIS_DEVELOPMENT"
        return document

    def fr_document(self) -> dict:
        document = deepcopy(self.valid)
        document["paper"] = "FR"
        document["diagnostic_model"]["paper_rules_version"] = None
        document["uncertainty"]["flags"] = ["PAPER_RULES_UNAVAILABLE"]
        return document

    def pipeline_run(self, document: dict, catalogue: list | None = None) -> dict:
        return self.pipeline.run(
            document,
            self.bundle["synthetic_question_catalogue"]
            if catalogue is None
            else catalogue,
            profile_id="beta-contract-test",
            as_of="2026-10-05T00:00:00Z",
        )

    def test_01_cross_dimension_finding_moves_to_canonical_dimension(self) -> None:
        attempt = self.adapter.adapt(self.cross_dimension_document())
        weakness = attempt["weaknesses"][0]
        self.assertEqual(weakness["canonical_dimension"], "QUANTITATIVE_INTERPRETATION")
        self.assertEqual(weakness["normalisation_status"], "NORMALISED_CROSS_FIELD")
        self.assertIn(
            "CANONICAL_DIMENSION_REASSIGNMENT",
            attempt["normalisation_audit"]["actions"][0]["operations"],
        )

    def test_02_provenance_preserves_source_path_and_original_dimension(self) -> None:
        source = self.cross_dimension_document()
        attempt = self.adapter.adapt(source)
        provenance = attempt["weaknesses"][0]["provenance"]
        self.assertEqual(provenance["source_path"], "$.major_weaknesses[0]")
        self.assertEqual(provenance["original_dimension"], "ANALYSIS_DEVELOPMENT")
        self.assertEqual(source["major_weaknesses"][0]["dimension"], "ANALYSIS_DEVELOPMENT")

    def test_03_normalisation_never_increases_severity(self) -> None:
        attempt = self.adapter.adapt(self.cross_dimension_document())
        action = attempt["normalisation_audit"]["actions"][0]
        self.assertEqual(action["severity_before"], action["severity_after"])
        self.assertEqual(attempt["normalisation_audit"]["severity_increase_count"], 0)

    def test_04_cross_dimension_normalisation_never_increases_confidence(self) -> None:
        attempt = self.adapter.adapt(self.cross_dimension_document())
        action = attempt["normalisation_audit"]["actions"][0]
        ranks = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
        self.assertLessEqual(
            ranks[action["confidence_after"]], ranks[action["confidence_before"]]
        )
        self.assertEqual(action["confidence_after"], "MEDIUM")
        self.assertEqual(attempt["normalisation_audit"]["confidence_increase_count"], 0)

    def test_05_source_uncertainty_is_preserved(self) -> None:
        document = self.cross_dimension_document()
        document["uncertainty"]["flags"] = ["AMBIGUOUS_EVIDENCE"]
        attempt = self.adapter.adapt(document)
        self.assertEqual(attempt["source_uncertainty_flags"], ["AMBIGUOUS_EVIDENCE"])
        self.assertEqual(
            attempt["weaknesses"][0]["uncertainty"]["source_flags"],
            ["AMBIGUOUS_EVIDENCE"],
        )

    def test_06_style_note_cannot_become_mark_material(self) -> None:
        controller = FalseCriticismController(self.registry)
        classified = controller.classify(
            "SBR",
            {
                "finding_id": "style-only",
                "proposed_classification": "MARK_MATERIAL_WEAKNESS",
                "rule_id": "SBR-LABELLED-SPREADSHEET",
                "finding_type": "FORMAT",
                "safeguards": {"accepted_format": True},
            },
        )
        self.assertEqual(classified["classification"], "STYLE_NOTE")
        self.assertFalse(classified["direct_credit_reduction_allowed"])

    def test_07_genuine_semantic_contradiction_is_rejected(self) -> None:
        document = deepcopy(self.valid)
        dimension = document["dimension_assessments"][6]
        dimension.update(
            applicability="NOT_APPLICABLE",
            score=None,
            categorical_assessment="NOT_ASSESSED",
            confidence="NOT_ASSESSED",
        )
        with self.assertRaisesRegex(DiagnosticAdapterError, "non-applicable dimension"):
            self.adapter.adapt(document)

    def test_08_fr_universal_evidence_enters_weakness_engine(self) -> None:
        result = self.pipeline_run(self.fr_document())
        attempt = result["normalised_attempt"]
        self.assertFalse(attempt["paper_rules"]["available_to_source_diagnosis"])
        self.assertEqual(len(result["weakness_result"]["weakness_profiles"]), 1)
        self.assertEqual(result["weakness_result"]["weakness_profiles"][0]["state"], "OBSERVED")

    def test_09_fr_paper_specific_recommendation_and_student_view_are_blocked(self) -> None:
        result = self.pipeline_run(self.fr_document())
        recommendation = result["recommendation_result"]
        self.assertEqual(
            recommendation["specific_question_recommendation_status"],
            "BLOCKED_PAPER_RULES_UNAVAILABLE",
        )
        self.assertEqual(recommendation["specific_question_recommendations"], [])
        self.assertEqual(
            result["beta_backend_payload"]["release_status"],
            "WITHHELD_UNSUPPORTED_PAPER",
        )
        self.assertIsNone(result["beta_backend_payload"]["student_view"])

    def test_10_single_attempt_remains_observed(self) -> None:
        result = self.pipeline_run(deepcopy(self.valid))
        states = {item["state"] for item in result["weakness_result"]["weakness_profiles"]}
        self.assertEqual(states, {"OBSERVED"})

    def test_11_skill_recommendation_does_not_need_question_catalogue(self) -> None:
        result = self.pipeline_run(deepcopy(self.valid), catalogue=[])
        recommendation = result["recommendation_result"]
        self.assertEqual(recommendation["outcome"], "NO_ELIGIBLE_QUESTION")
        self.assertEqual(
            recommendation["skill_recommendation_outcome"],
            "SKILL_RECOMMENDATIONS_AVAILABLE",
        )
        self.assertEqual(
            recommendation["skill_recommendations"][0]["recommendation_type"],
            "SKILL_RECOMMENDATION",
        )

    def test_12_synthetic_specific_questions_remain_development_only(self) -> None:
        result = self.pipeline_run(deepcopy(self.valid))
        recommendation = result["recommendation_result"]
        self.assertEqual(
            recommendation["specific_question_recommendation_status"],
            "DEVELOPMENT_ONLY",
        )
        self.assertTrue(recommendation["specific_question_recommendations"])
        self.assertTrue(
            all(
                item["recommendation_type"] == "SPECIFIC_QUESTION_RECOMMENDATION"
                and item["safety_status"] == "DEVELOPMENT_ONLY"
                for item in recommendation["specific_question_recommendations"]
            )
        )

    def test_13_beta_payload_uses_an_explicit_safe_field_allowlist(self) -> None:
        payload = self.pipeline_run(deepcopy(self.valid))["beta_backend_payload"]
        forbidden = {
            "indicative_mark",
            "range",
            "score",
            "tag",
            "state",
            "question_key",
            "specific_question_recommendations",
            "normalisation_audit",
            "provenance",
        }

        def keys(value):
            if isinstance(value, dict):
                for key, nested in value.items():
                    yield key
                    yield from keys(nested)
            elif isinstance(value, list):
                for nested in value:
                    yield from keys(nested)

        self.assertFalse(forbidden & set(keys(payload)))
        self.assertEqual(payload["release_status"], "HUMAN_REVIEW_REQUIRED")
        self.assertEqual(payload["contract_version"], "beta-backend-v0.2.0")
        summary = payload["student_view"]["diagnostic_summary"]
        self.assertEqual(summary, self.valid["diagnosis_summary"])
        self.assertNotIn("mark", summary.lower())


if __name__ == "__main__":
    unittest.main()
