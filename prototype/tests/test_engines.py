"""Part of ../../PROJECT.md — deterministic Weakness and Recommendation tests."""

from __future__ import annotations

import ast
import json
import re
import unittest
from copy import deepcopy
from pathlib import Path

from acca_engine.configuration import (
    PROJECT_ROOT,
    PROTOTYPE_ROOT,
    load_config,
    load_fixture_bundle,
    profiles_by_id,
)
from acca_engine.recommendation_engine import RecommendationEngine
from acca_engine.weakness_engine import WeaknessEngine


class EngineTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_config()
        cls.bundle = load_fixture_bundle()
        cls.profiles = profiles_by_id(cls.bundle)
        cls.catalogue = cls.bundle["synthetic_question_catalogue"]
        cls.weakness_engine = WeaknessEngine(cls.config)
        cls.recommendation_engine = RecommendationEngine(cls.config)

    def run_profile(self, profile_id: str, **ranking_kwargs):
        profile = self.profiles[profile_id]
        weakness = self.weakness_engine.analyze_profile(profile)
        recommendation = self.recommendation_engine.rank_questions(
            profile,
            weakness,
            self.catalogue,
            as_of="2026-10-02T00:00:00Z",
            **ranking_kwargs,
        )
        return profile, weakness, recommendation

    @staticmethod
    def weakness_by_tag(result, tag: str):
        return next(item for item in result["weakness_profiles"] if item["tag"] == tag)

    def test_taxonomy_config_maps_every_weakness_tag(self):
        taxonomy = (PROJECT_ROOT / "DIAGNOSTIC_TAXONOMY.md").read_text(
            encoding="utf-8"
        )
        weakness_tags = set(
            re.findall(
                r"^\| `([A-Z][A-Z0-9_]+)` \| Weakness \|", taxonomy, re.MULTILINE
            )
        )
        self.assertEqual(weakness_tags, set(self.config["tag_dimensions"]))

    def test_strong_knowledge_weak_application_gets_application_practice(self):
        _, weakness, recommendation = self.run_profile(
            "P01_STRONG_KNOWLEDGE_WEAK_APPLICATION"
        )
        application = self.weakness_by_tag(
            weakness, "GENERIC_NOT_SCENARIO_SPECIFIC"
        )
        self.assertEqual(application["state"], "RECURRING")
        self.assertIn(
            "TECHNICAL_KNOWLEDGE_ACCURATE",
            {item["tag"] for item in weakness["strengths"]},
        )
        top = recommendation["recommendations"][0]
        self.assertEqual(top["question_key"], "synthetic|SBL|SCENARIO|01")
        self.assertIn(
            "GENERIC_NOT_SCENARIO_SPECIFIC",
            {item["tag"] for item in top["targets"]},
        )

    def test_strong_calculations_weak_interpretation_gets_interpretation_practice(self):
        _, weakness, recommendation = self.run_profile(
            "P03_STRONG_CALCULATIONS_WEAK_INTERPRETATION"
        )
        interpretation = self.weakness_by_tag(
            weakness, "CALCULATION_NOT_INTERPRETED"
        )
        self.assertEqual(interpretation["state"], "RECURRING")
        self.assertIn(
            "CALCULATION_ACCURATE",
            {item["tag"] for item in weakness["strengths"]},
        )
        self.assertEqual(
            recommendation["recommendations"][0]["question_key"],
            "synthetic|AFM|INTERPRETATION|01",
        )
        self.assertNotEqual(
            recommendation["recommendations"][0]["question_key"],
            "synthetic|AFM|CALCULATION|02",
        )

    def test_repeated_weak_evaluation_becomes_recurring(self):
        _, weakness, _ = self.run_profile("P04_WEAK_EVALUATION")
        evaluation = self.weakness_by_tag(weakness, "EVALUATION_ONE_SIDED")
        self.assertEqual(evaluation["state"], "RECURRING")
        self.assertEqual(evaluation["counts"]["hits"], 3)
        self.assertIn(
            "STANDARD_RECURRING_CRITERIA_MET", evaluation["current_reason_codes"]
        )

    def test_improving_student_transitions_from_recurring_to_improving(self):
        _, weakness, recommendation = self.run_profile("P08_IMPROVING_STUDENT")
        application = self.weakness_by_tag(
            weakness, "GENERIC_NOT_SCENARIO_SPECIFIC"
        )
        states = [transition["to_state"] for transition in application["transitions"]]
        self.assertIn("RECURRING", states)
        self.assertEqual(application["state"], "IMPROVING")
        self.assertNotEqual(application["state"], "POTENTIALLY_RESOLVED")
        self.assertEqual(recommendation["mode"], "CONFIRM_IMPROVEMENT")
        self.assertEqual(
            recommendation["recommendations"][0]["question_key"],
            "synthetic|SBL|TRANSFER|03",
        )

    def test_regression_reactivates_a_potentially_resolved_weakness(self):
        _, weakness, _ = self.run_profile("P09_REGRESSING_STUDENT")
        interpretation = self.weakness_by_tag(
            weakness, "CALCULATION_NOT_INTERPRETED"
        )
        states = [
            transition["to_state"] for transition in interpretation["transitions"]
        ]
        self.assertIn("POTENTIALLY_RESOLVED", states)
        self.assertEqual(interpretation["state"], "REGRESSING")
        self.assertTrue(interpretation["reactivated"])

    def test_anomalous_bad_attempt_is_observed_inactive_and_not_recurring(self):
        _, weakness, recommendation = self.run_profile(
            "P10_ONE_ANOMALOUS_BAD_ATTEMPT"
        )
        calculation = self.weakness_by_tag(weakness, "CALCULATION_ERROR")
        self.assertEqual(calculation["state"], "OBSERVED")
        self.assertTrue(calculation["inactive_observation"])
        self.assertEqual(calculation["priority_score"], 0)
        self.assertNotIn(
            "RECURRING",
            [transition["to_state"] for transition in calculation["transitions"]],
        )
        self.assertEqual(recommendation["mode"], "BASELINE")

    def test_previously_attempted_question_is_penalised_and_cooldown_excluded(self):
        profile = deepcopy(self.profiles["P01_STRONG_KNOWLEDGE_WEAK_APPLICATION"])
        template = next(
            item
            for item in self.catalogue
            if item["question_key"] == "synthetic|SBL|SCENARIO|01"
        )
        new_question = deepcopy(template)
        new_question["question_key"] = "synthetic|SBL|SCENARIO|NEW"
        old_question = deepcopy(template)
        old_question["question_key"] = "synthetic|SBL|SCENARIO|OLD"
        profile["available_question_keys"] = [
            new_question["question_key"],
            old_question["question_key"],
        ]
        weakness = self.weakness_engine.analyze_profile(profile)
        statuses = {
            old_question["question_key"]: {
                "has_lawful_access": True,
                "attempted": True,
                "attempt_count": 1,
                "last_attempted_at": "2026-09-01T00:00:00Z",
            }
        }
        result = self.recommendation_engine.rank_questions(
            profile,
            weakness,
            [new_question, old_question],
            statuses,
            as_of="2026-10-02T00:00:00Z",
        )
        scores = {item["question_key"]: item["base_score"] for item in result["recommendations"]}
        self.assertGreater(scores[new_question["question_key"]], scores[old_question["question_key"]])
        self.assertEqual(
            result["recommendations"][0]["question_key"], new_question["question_key"]
        )

        statuses[old_question["question_key"]]["cooldown_until"] = (
            "2026-10-04T00:00:00Z"
        )
        cooldown_result = self.recommendation_engine.rank_questions(
            profile,
            weakness,
            [new_question, old_question],
            statuses,
            as_of="2026-10-02T00:00:00Z",
        )
        self.assertNotIn(
            old_question["question_key"],
            {item["question_key"] for item in cooldown_result["recommendations"]},
        )
        self.assertIn(
            {"question_key": old_question["question_key"], "reason": "IN_COOLDOWN"},
            cooldown_result["exclusions"],
        )

    def test_low_confidence_diagnostic_has_less_influence_than_high_confidence(self):
        base_attempt = {
            "analysis_id": "LOW_HIGH_A1",
            "attempted_at": "2026-09-01T00:00:00Z",
            "question_key": "hist|SBL|confidence|01",
            "topic": "Strategy",
            "question_type": "REPORT",
            "dimension_scores": {"SCENARIO_APPLICATION": 1},
            "strength_tags": [],
            "weaknesses": [
                {
                    "tag": "GENERIC_NOT_SCENARIO_SPECIFIC",
                    "severity": "MODERATE",
                    "confidence": "LOW",
                }
            ],
        }
        low_profile = {
            "profile_id": "LOW_CONFIDENCE_ONLY",
            "paper": "SBL",
            "current_study_context": {"topic": "Strategy", "available_minutes": 30},
            "available_question_keys": ["synthetic|SBL|SCENARIO|01"],
            "attempts": [deepcopy(base_attempt)],
        }
        high_profile = deepcopy(low_profile)
        high_profile["profile_id"] = "HIGH_CONFIDENCE_ONLY"
        high_profile["attempts"][0]["analysis_id"] = "LOW_HIGH_A2"
        high_profile["attempts"][0]["weaknesses"][0]["confidence"] = "HIGH"

        low = self.weakness_by_tag(
            self.weakness_engine.analyze_profile(low_profile),
            "GENERIC_NOT_SCENARIO_SPECIFIC",
        )
        high = self.weakness_by_tag(
            self.weakness_engine.analyze_profile(high_profile),
            "GENERIC_NOT_SCENARIO_SPECIFIC",
        )
        self.assertIsNone(low["state"])
        self.assertTrue(low["insufficient_signal"])
        self.assertEqual(high["state"], "OBSERVED")
        self.assertLess(low["weighted_prevalence"], high["weighted_prevalence"])
        self.assertLess(low["priority_score"], high["priority_score"])

    def test_no_sufficient_active_history_uses_baseline_mode(self):
        _, _, recommendation = self.run_profile("P10_ONE_ANOMALOUS_BAD_ATTEMPT")
        self.assertEqual(recommendation["mode"], "BASELINE")
        top = recommendation["recommendations"][0]
        self.assertEqual(top["question_key"], "synthetic|AFM|CALCULATION|02")
        self.assertEqual(top["targets"], [])
        self.assertTrue(any("baseline" in reason.lower() for reason in top["why"]))

    def test_explainability_fields_are_present(self):
        _, weakness, recommendation = self.run_profile(
            "P01_STRONG_KNOWLEDGE_WEAK_APPLICATION"
        )
        item = self.weakness_by_tag(weakness, "GENERIC_NOT_SCENARIO_SPECIFIC")
        for key in (
            "weighted_prevalence",
            "prevalence_numerator",
            "prevalence_denominator",
            "counts",
            "priority_components",
            "supporting_analysis_ids",
            "current_reason_codes",
            "transitions",
        ):
            self.assertIn(key, item)
        top = recommendation["recommendations"][0]
        self.assertIn("score_components", top)
        self.assertIn("why", top)
        self.assertIn("targets", top)
        self.assertIn("metadata", top)
        self.assertAlmostEqual(
            top["base_score"], sum(top["score_components"].values()), places=3
        )

    def test_requirement_verbs_are_reported_when_metadata_is_available(self):
        profile = deepcopy(self.profiles["P06_REQUIREMENT_INTERPRETATION"])
        question = deepcopy(
            next(
                item
                for item in self.catalogue
                if item["question_key"] == "synthetic|SBL|REQUIREMENT|02"
            )
        )
        question["requirement_verbs"] = ["evaluate", "recommend"]
        profile["available_question_keys"] = [question["question_key"]]
        weakness = self.weakness_engine.analyze_profile(profile)
        result = self.recommendation_engine.rank_questions(
            profile,
            weakness,
            [question],
            as_of="2026-10-02T00:00:00Z",
        )
        self.assertEqual(
            result["recommendations"][0]["requirement_verb_matches"],
            ["evaluate", "recommend"],
        )

    def test_outputs_are_deterministic(self):
        profile = self.profiles["P07_BROAD_EXAM_TECHNIQUE"]
        first_weakness = self.weakness_engine.analyze_profile(profile)
        second_weakness = self.weakness_engine.analyze_profile(profile)
        self.assertEqual(first_weakness, second_weakness)
        first_recommendation = self.recommendation_engine.rank_questions(
            profile,
            first_weakness,
            self.catalogue,
            as_of="2026-10-02T00:00:00Z",
        )
        second_recommendation = self.recommendation_engine.rank_questions(
            profile,
            second_weakness,
            self.catalogue,
            as_of="2026-10-02T00:00:00Z",
        )
        self.assertEqual(first_recommendation, second_recommendation)

    def test_explicit_unmet_prerequisite_excludes_non_foundation_question(self):
        profile, weakness, _ = self.run_profile(
            "P03_STRONG_CALCULATIONS_WEAK_INTERPRETATION"
        )
        key = "synthetic|AFM|INTERPRETATION|01"
        result = self.recommendation_engine.rank_questions(
            profile,
            weakness,
            self.catalogue,
            {key: {"has_lawful_access": True, "unmet_prerequisites": ["NPV_FOUNDATIONS"]}},
            as_of="2026-10-02T00:00:00Z",
        )
        self.assertIn(
            {"question_key": key, "reason": "UNMET_PREREQUISITE"},
            result["exclusions"],
        )

    def test_fixture_contract_audit_has_only_documented_differences(self):
        mismatches = []
        for profile in self.bundle["profiles"]:
            weakness = self.weakness_engine.analyze_profile(profile)
            actual_states = {
                item["tag"]: item["state"] for item in weakness["weakness_profiles"]
            }
            recommendation = self.recommendation_engine.rank_questions(
                profile,
                weakness,
                self.catalogue,
                as_of="2026-10-02T00:00:00Z",
            )
            expected = profile["expected"]
            for tag, expected_state in expected["states"].items():
                actual_state = actual_states.get(tag)
                if actual_state != expected_state:
                    mismatches.append(
                        f"{profile['profile_id']}:state:{tag}:{expected_state}->{actual_state}"
                    )
            if recommendation["mode"] != expected["recommendation_mode"]:
                mismatches.append(
                    f"{profile['profile_id']}:mode:{expected['recommendation_mode']}->{recommendation['mode']}"
                )
            actual_top = (
                recommendation["recommendations"][0]["question_key"]
                if recommendation["recommendations"]
                else None
            )
            if actual_top != expected["preferred_question_key"]:
                mismatches.append(
                    f"{profile['profile_id']}:top:{expected['preferred_question_key']}->{actual_top}"
                )
        self.assertEqual(
            sorted(mismatches),
            sorted(
                [
                    "P04_WEAK_EVALUATION:mode:TARGETED->MIXED_CHALLENGE",
                    "P09_REGRESSING_STUDENT:top:synthetic|AFM|TRANSFER|03->synthetic|AFM|INTERPRETATION|01",
                ]
            ),
        )

    def test_no_external_network_or_model_imports(self):
        forbidden_roots = {
            "anthropic",
            "boto3",
            "google",
            "httpx",
            "openai",
            "requests",
            "socket",
            "urllib",
        }
        observed = set()
        for path in list((PROTOTYPE_ROOT / "acca_engine").glob("*.py")) + [
            PROTOTYPE_ROOT / "demo.py"
        ]:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    observed.update(alias.name.split(".")[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    observed.add(node.module.split(".")[0])
        self.assertFalse(forbidden_roots & observed, forbidden_roots & observed)

    def test_configuration_and_fixtures_are_valid_json(self):
        for path in (
            PROTOTYPE_ROOT / "engine_config.json",
            PROJECT_ROOT / "SYNTHETIC_TEST_CASES.json",
        ):
            with path.open("r", encoding="utf-8") as handle:
                self.assertIsInstance(json.load(handle), dict)


if __name__ == "__main__":
    unittest.main()
