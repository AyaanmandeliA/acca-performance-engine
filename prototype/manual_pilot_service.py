"""Part of ../PROJECT.md — loopback-only manual diagnostic pipeline bridge."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from acca_engine.configuration import load_config
from acca_engine.diagnostic_adapter import DeterministicDownstreamPipeline
from acca_engine.paper_rules import PaperRuleRegistry


PROTOTYPE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PROTOTYPE_ROOT.parent
BETA_APP_ROOT = PROJECT_ROOT / "beta-app"
PROMPT_PATH = PROJECT_ROOT / "MANUAL_CODEX_DIAGNOSTIC_PROMPT.md"
SCHEMA_PATH = PROJECT_ROOT / "DIAGNOSTIC_OUTPUT_SCHEMA.json"
TAXONOMY_PATH = PROJECT_ROOT / "DIAGNOSTIC_TAXONOMY.md"
CREDIT_LEDGER_PATH = PROJECT_ROOT / "CREDIT_LEDGER.md"
SAFEGUARDS_PATH = PROJECT_ROOT / "DIAGNOSTIC_SAFEGUARDS.md"
UNCERTAINTY_PATH = PROJECT_ROOT / "UNCERTAINTY_POLICY.md"
PAPER_RULES_PATH = PROJECT_ROOT / "PAPER_RULES.md"
MAX_BODY_BYTES = 1_500_000


class ManualPilotError(ValueError):
    """Raised when a packet or imported diagnostic cannot enter the pipeline."""


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _case_number(attempt_reference: str) -> int:
    return int(hashlib.sha256(attempt_reference.encode("utf-8")).hexdigest()[:12], 16)


def build_packet(source: dict[str, Any]) -> dict[str, Any]:
    required = {
        "attempt_reference", "paper", "question_label", "marks_available",
        "scenario_text", "requirement_text", "permitted_marking_context", "student_answer",
    }
    missing = sorted(required - source.keys())
    extra = sorted(source.keys() - required)
    if missing or extra:
        raise ManualPilotError(f"Invalid packet source; missing={missing}, unexpected={extra}")
    paper = source["paper"]
    if paper not in {"AFM", "SBR"}:
        raise ManualPilotError("Only AFM and SBR are supported.")
    marks = source["marks_available"]
    if not isinstance(marks, int) or isinstance(marks, bool) or not 1 <= marks <= 100:
        raise ManualPilotError("Manual diagnostics require marks_available from 1 to 100.")
    for key, minimum, maximum in (
        ("attempt_reference", 1, 200), ("question_label", 2, 120),
        ("scenario_text", 20, 50000), ("requirement_text", 8, 10000),
        ("student_answer", 20, 80000),
    ):
        value = source[key]
        if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
            raise ManualPilotError(f"{key} is outside the permitted length.")
    marking_context = source["permitted_marking_context"]
    if marking_context is not None and (not isinstance(marking_context, str) or len(marking_context) > 30000):
        raise ManualPilotError("permitted_marking_context is invalid.")

    attempt_hash = hashlib.sha256(source["attempt_reference"].encode("utf-8")).hexdigest()
    case_id = f"ACCA-{paper}-MANUAL-C{_case_number(source['attempt_reference'])}"
    analysis_id = f"manual-{paper.lower()}-{attempt_hash[:20]}"
    rule_version = "afm-rules-v0.2.0" if paper == "AFM" else "sbr-rules-v0.2.0"
    packet = {
        "packet_version": "manual-diagnostic-packet-v0.1.0",
        "analysis_context": {
            "analysis_id": analysis_id,
            "case_id": case_id,
            "paper": paper,
            "question_label": source["question_label"],
            "marks_available": marks,
            "prompt_version": "manual-codex-v0.1.0",
            "taxonomy_version": "diagnostic-taxonomy-v0.2",
            "paper_rules_version": rule_version,
        },
        "submission": {
            "scenario_text": source["scenario_text"],
            "requirement_text": source["requirement_text"],
            "permitted_marking_context": marking_context,
            "student_answer": source["student_answer"],
        },
        "permitted_context": {
            "diagnostic_schema": json.loads(_read_text(SCHEMA_PATH)),
            "taxonomy": _read_text(TAXONOMY_PATH),
            "paper_rules": _read_text(PAPER_RULES_PATH),
            "paper_rule_module": json.loads(_read_text(PROTOTYPE_ROOT / "paper_rules" / f"{paper.lower()}_v0.2.json")),
            "credit_ledger_architecture": _read_text(CREDIT_LEDGER_PATH),
            "diagnostic_safeguards": _read_text(SAFEGUARDS_PATH),
            "uncertainty_policy": _read_text(UNCERTAINTY_PATH),
        },
        "diagnostic_instructions": _read_text(PROMPT_PATH),
    }
    prompt_text = _read_text(PROMPT_PATH).replace(
        "`{{DIAGNOSTIC_PACKET_JSON}}`", json.dumps(packet, indent=2, ensure_ascii=False)
    )
    return {"packet": packet, "packetHash": _sha256(packet), "promptText": prompt_text}


def _validate_with_schema(document: dict[str, Any]) -> None:
    validator = BETA_APP_ROOT / "scripts" / "validate-diagnostic.mjs"
    completed = subprocess.run(
        ["node", str(validator)],
        input=json.dumps(document),
        text=True,
        capture_output=True,
        cwd=BETA_APP_ROOT,
        timeout=15,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Strict diagnostic schema validation failed."
        raise ManualPilotError(message)


def process_diagnostic(packet: dict[str, Any], diagnostic: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(packet, dict) or packet.get("packet_version") != "manual-diagnostic-packet-v0.1.0":
        raise ManualPilotError("Unsupported or missing packet version.")
    if not isinstance(diagnostic, dict):
        raise ManualPilotError("Diagnostic must be a JSON object.")
    _validate_with_schema(diagnostic)
    context = packet.get("analysis_context", {})
    expected = {
        "analysis_id": context.get("analysis_id"),
        "benchmark_case_id": context.get("case_id"),
        "paper": context.get("paper"),
        "marks_available": context.get("marks_available"),
    }
    mismatches = [key for key, value in expected.items() if diagnostic.get(key) != value]
    model = diagnostic.get("diagnostic_model", {})
    if model.get("prompt_version") != context.get("prompt_version"):
        mismatches.append("diagnostic_model.prompt_version")
    if model.get("taxonomy_version") != context.get("taxonomy_version"):
        mismatches.append("diagnostic_model.taxonomy_version")
    if model.get("paper_rules_version") != context.get("paper_rules_version"):
        mismatches.append("diagnostic_model.paper_rules_version")
    if mismatches:
        raise ManualPilotError("Diagnostic does not match the exported packet: " + ", ".join(mismatches))

    pipeline = DeterministicDownstreamPipeline(load_config(), PaperRuleRegistry())
    result = pipeline.run(
        diagnostic,
        [],
        profile_id="manual-single-attempt",
        as_of=diagnostic["generated_at"],
    )
    return {
        "pipeline_version": "manual-pipeline-v0.1.0",
        "diagnostic_sha256": _sha256(diagnostic),
        "processed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "beta_backend_payload": result["beta_backend_payload"],
        "normalised_attempt": result["normalised_attempt"],
        "weakness_result": result["weakness_result"],
        "recommendation_result": result["recommendation_result"],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ACCAPilotBridge/0.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Never log request bodies or submission content.
        super().log_message(format, *args)

    def _json(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "service": "manual-pipeline-v0.1.0"})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        try:
            configured_secret = os.environ.get("BETA_PIPELINE_SHARED_SECRET")
            synthetic = os.environ.get("BETA_SYNTHETIC_MODE") == "true"
            if not configured_secret and not synthetic:
                raise PermissionError("Pipeline secret is not configured.")
            if configured_secret and self.headers.get("Authorization") != f"Bearer {configured_secret}":
                raise PermissionError("Pipeline authorization failed.")
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ManualPilotError("Request body size is invalid.")
            payload = json.loads(self.rfile.read(length))
            if self.path == "/packet":
                result = build_packet(payload)
            elif self.path == "/process":
                if set(payload) != {"packet", "diagnostic"}:
                    raise ManualPilotError("Process request must contain only packet and diagnostic.")
                result = process_diagnostic(payload["packet"], payload["diagnostic"])
            else:
                self._json(404, {"error": "Not found"})
                return
            self._json(200, result)
        except PermissionError as exc:
            self._json(401, {"error": str(exc)})
        except (ManualPilotError, json.JSONDecodeError, ValueError, KeyError) as exc:
            self._json(422, {"error": str(exc)})
        except Exception:
            self._json(500, {"error": "Validated pipeline processing failed safely."})


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the loopback-only manual diagnostic pipeline bridge.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        parser.error("The bridge must bind to loopback only.")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Manual diagnostic bridge listening on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

