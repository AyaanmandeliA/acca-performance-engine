"""Part of ../../PROJECT.md — manual Codex export/import workflow tests."""

from __future__ import annotations

import json
import unittest
from copy import deepcopy

from acca_engine.configuration import PROTOTYPE_ROOT
from manual_pilot_service import ManualPilotError, build_packet, process_diagnostic


class ManualPilotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        fixture = json.loads(
            (PROTOTYPE_ROOT / "fixtures/vnext_synthetic_cases.json").read_text(encoding="utf-8")
        )
        cls.fixture = fixture["valid_diagnostic"]
        cls.source = {
            "attempt_reference": "synthetic-attempt-001",
            "paper": "AFM",
            "question_label": "Synthetic AFM supervised pilot",
            "marks_available": 20,
            "scenario_text": "A fictional company is considering an investment with uncertain cash flows and a positive base-case value.",
            "requirement_text": "Evaluate the investment and recommend whether the company should proceed.",
            "permitted_marking_context": "Synthetic context only. Assess the visible conclusion, interpretation, uncertainty and recommendation support.",
            "student_answer": "The base-case result is positive, so the company should proceed. Management should test the downside cash flows and financing headroom before committing.",
        }

    def packet_and_diagnostic(self):
        exported = build_packet(deepcopy(self.source))
        packet = exported["packet"]
        context = packet["analysis_context"]
        diagnostic = deepcopy(self.fixture)
        diagnostic.update(
            analysis_id=context["analysis_id"],
            benchmark_case_id=context["case_id"],
            paper=context["paper"],
            marks_available=context["marks_available"],
        )
        diagnostic["diagnostic_model"].update(
            provider="OpenAI Codex (manual session)",
            model="synthetic-test-model",
            reasoning="test",
            prompt_version=context["prompt_version"],
            taxonomy_version=context["taxonomy_version"],
            paper_rules_version=context["paper_rules_version"],
        )
        return exported, diagnostic

    def test_export_is_anonymous_and_contains_only_permitted_context(self):
        exported, _ = self.packet_and_diagnostic()
        packet_text = json.dumps(exported["packet"])
        self.assertNotIn("student-a", packet_text)
        self.assertNotIn("reviewer", packet_text.lower())
        self.assertNotIn("email", packet_text.lower())
        self.assertIn("diagnostic_schema", exported["packet"]["permitted_context"])
        self.assertIn("credit_ledger_architecture", exported["packet"]["permitted_context"])
        self.assertIn("Return only one JSON object", exported["promptText"])

    def test_valid_import_runs_schema_normalisation_weakness_and_beta_pipeline(self):
        exported, diagnostic = self.packet_and_diagnostic()
        result = process_diagnostic(exported["packet"], diagnostic)
        self.assertEqual(result["pipeline_version"], "manual-pipeline-v0.1.0")
        self.assertEqual(result["normalised_attempt"]["normalised_evidence_version"], "attempt-evidence-v0.2.1")
        self.assertIn("weakness_profiles", result["weakness_result"])
        self.assertEqual(result["beta_backend_payload"]["contract_version"], "beta-backend-v0.2.0")
        self.assertEqual(result["beta_backend_payload"]["release_status"], "HUMAN_REVIEW_REQUIRED")

    def test_schema_extra_field_is_rejected(self):
        exported, diagnostic = self.packet_and_diagnostic()
        diagnostic["unexpected_private_field"] = "reject me"
        with self.assertRaisesRegex(ManualPilotError, "Strict diagnostic schema validation failed"):
            process_diagnostic(exported["packet"], diagnostic)

    def test_packet_mismatch_is_rejected(self):
        exported, diagnostic = self.packet_and_diagnostic()
        diagnostic["analysis_id"] = "manual-afm-wrong-reference"
        with self.assertRaisesRegex(ManualPilotError, "does not match the exported packet"):
            process_diagnostic(exported["packet"], diagnostic)

    def test_uncertainty_is_preserved_and_student_payload_does_not_leak_internal_fields(self):
        exported, diagnostic = self.packet_and_diagnostic()
        diagnostic["uncertainty"]["flags"] = ["AMBIGUOUS_EVIDENCE"]
        diagnostic["uncertainty"]["details"] = ["Synthetic evidence is deliberately ambiguous."]
        result = process_diagnostic(exported["packet"], diagnostic)
        self.assertEqual(result["normalised_attempt"]["source_uncertainty_flags"], ["AMBIGUOUS_EVIDENCE"])
        student_json = json.dumps(result["beta_backend_payload"]["student_view"])
        for prohibited in ("indicative_mark", '"tag"', '"state"', "normalisation_audit", "provenance", "raw_diagnostic"):
            self.assertNotIn(prohibited, student_json)


if __name__ == "__main__":
    unittest.main()

