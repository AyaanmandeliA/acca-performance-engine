// Part of ../../PROJECT.md — field-for-field Worker equivalence against Python.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures deliberately exercise dynamic diagnostic JSON. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Paper, ReviewAttempt } from "../lib/domain";
import { exportWorkerDiagnosticPacket, processWorkerManualDiagnostic } from "../lib/worker-manual-pipeline";

type JsonRecord = Record<string, any>;
const fixture = JSON.parse(readFileSync(new URL("../../prototype/fixtures/vnext_synthetic_cases.json", import.meta.url), "utf8")).valid_diagnostic as JsonRecord;

function pythonOracle(request: JsonRecord) {
  const result = spawnSync("python3", ["../prototype/manual_pipeline_oracle.py"], {
    cwd: new URL("..", import.meta.url),
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function source(paper: Paper) {
  return {
    attempt_reference: `equivalence-${paper.toLowerCase()}-attempt-1`,
    paper,
    question_label: `${paper} synthetic equivalence case`,
    marks_available: 10,
    scenario_text: "A fictional company evaluates a résumé of uncertain cash flows and a fully synthetic reporting scenario.",
    requirement_text: "Evaluate the synthetic issue and recommend a justified response.",
    permitted_marking_context: "Synthetic context only; use only the supplied observable evidence.",
    student_answer: "The result is positive. Management should test the downside and explain how the result affects its decision.",
  };
}

function attemptFromSource(input: ReturnType<typeof source>): ReviewAttempt {
  return {
    id: input.attempt_reference,
    paper: input.paper,
    questionLabel: input.question_label,
    createdAt: "2026-10-08T00:00:00Z",
    reviewStatus: "PENDING",
    releaseStatus: "HELD",
    analysisStatus: "AWAITING_DIAGNOSTIC",
    provider: "MANUAL_CODEX",
    fixture: true,
    diagnosticConfidence: "LOW",
    submission: {
      scenarioText: input.scenario_text,
      requirementText: input.requirement_text,
      permittedMarkingContext: input.permitted_marking_context,
      marksAvailable: input.marks_available,
      answerText: input.student_answer,
    },
    studentPayload: null,
    rawDiagnostic: null,
    normalisedEvidence: null,
    pipelineResult: null,
    imported: false,
  };
}

type Variant = "aligned" | "low" | "blocking" | "normalised" | "parent_backfill" | "strength_normalised" | "deduplicated" | "no_weakness" | "dimension_low" | "marking_missing" | "general" | "unicode";

function diagnosticFor(packet: Awaited<ReturnType<typeof exportWorkerDiagnosticPacket>>["packet"], variant: Variant) {
  const diagnostic = structuredClone(fixture);
  diagnostic.analysis_id = packet.analysis_context.analysis_id;
  diagnostic.benchmark_case_id = packet.analysis_context.case_id;
  diagnostic.paper = packet.analysis_context.paper;
  diagnostic.marks_available = packet.analysis_context.marks_available;
  diagnostic.question_requirement.mark_breakdown[0].marks_available = packet.analysis_context.marks_available;
  Object.assign(diagnostic.diagnostic_model, {
    provider: "OpenAI Codex (manual session)",
    model: "synthetic-equivalence-model",
    reasoning: "test",
    prompt_version: packet.analysis_context.prompt_version,
    taxonomy_version: packet.analysis_context.taxonomy_version,
    paper_rules_version: packet.analysis_context.paper_rules_version,
  });
  if (variant === "low") {
    diagnostic.major_weaknesses[0].confidence = "LOW";
    diagnostic.uncertainty.flags = ["AMBIGUOUS_EVIDENCE"];
    diagnostic.uncertainty.details = ["Synthetic evidence is deliberately ambiguous."];
  }
  if (variant === "blocking") {
    diagnostic.uncertainty.flags = ["SOURCE_UNREADABLE"];
    diagnostic.uncertainty.details = ["Synthetic source is deliberately marked unreadable."];
  }
  if (variant === "normalised") {
    const tag = diagnostic.major_weaknesses[0].tag;
    diagnostic.major_weaknesses[0].dimension = "ANALYSIS_DEVELOPMENT";
    diagnostic.major_weaknesses[0].confidence = "HIGH";
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").weakness_tags = [];
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "ANALYSIS_DEVELOPMENT").weakness_tags = [tag];
  }
  if (variant === "parent_backfill") {
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").weakness_tags = [];
  }
  if (variant === "strength_normalised") {
    const tag = diagnostic.major_strengths[0].tag;
    diagnostic.major_strengths[0].dimension = "PROFESSIONAL_SKILLS";
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_ACCURACY").strength_tags = [];
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "PROFESSIONAL_SKILLS").strength_tags = [tag];
  }
  if (variant === "deduplicated") {
    diagnostic.major_weaknesses.push({
      ...structuredClone(diagnostic.major_weaknesses[0]),
      weakness_id: "wk_syn_materiality",
      tag: "MATERIALITY_NOT_ASSESSED",
      severity: "MAJOR",
      confidence: "MEDIUM",
      explanation: "The response does not assess the synthetic result's materiality.",
    });
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").weakness_tags.push("MATERIALITY_NOT_ASSESSED");
    diagnostic.priority_weaknesses.push({ weakness_id: "wk_syn_materiality", priority_rank: 2, reason: "Materiality supports interpretation." });
    diagnostic.exam_technique_gaps.push({ weakness_id: "wk_syn_materiality", description: "Assess synthetic materiality." });
    diagnostic.recommended_improvement_actions.push({
      action_id: "act_syn_materiality", priority: 2, related_weakness_ids: ["wk_syn_materiality"],
      action: "Add a synthetic materiality comparison.", success_check: "The response states why the result is material.",
    });
  }
  if (variant === "no_weakness") {
    diagnostic.major_weaknesses = [];
    diagnostic.priority_weaknesses = [];
    diagnostic.exam_technique_gaps = [];
    diagnostic.recommended_improvement_actions = [];
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").weakness_tags = [];
  }
  if (variant === "dimension_low") {
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").confidence = "LOW";
  }
  if (variant === "marking_missing") {
    diagnostic.uncertainty.flags = ["MARKING_CONTEXT_MISSING"];
    diagnostic.uncertainty.details = ["Synthetic marking context is deliberately unavailable."];
  }
  if (variant === "general") {
    diagnostic.major_weaknesses[0].tag = "REQUIREMENT_MISREAD";
    diagnostic.major_weaknesses[0].dimension = "REQUIREMENT_INTERPRETATION";
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").weakness_tags = [];
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "REQUIREMENT_INTERPRETATION").weakness_tags = ["REQUIREMENT_MISREAD"];
  }
  if (variant === "unicode") {
    diagnostic.major_weaknesses[0].evidence[0].excerpt = "Synthetic résumé evidence – £100.";
    diagnostic.dimension_assessments.find((item: JsonRecord) => item.dimension === "QUANTITATIVE_INTERPRETATION").evidence[0].excerpt = "Synthetic résumé evidence – £100.";
  }
  return diagnostic;
}

test("Worker packet generation is byte-equivalent to the Python reference", async () => {
  for (const paper of ["AFM", "SBR"] as const) {
    const input = source(paper);
    const worker = await exportWorkerDiagnosticPacket(attemptFromSource(input));
    const python = pythonOracle({ action: "packet", source: input });
    assert.deepEqual(worker, python);
  }
});

test("Worker manual pipeline is field-equivalent to Python across AFM/SBR and safety variants", async () => {
  const cases = [
    ["AFM", "aligned"],
    ["SBR", "low"],
    ["AFM", "blocking"],
    ["AFM", "normalised"],
    ["SBR", "parent_backfill"],
    ["AFM", "strength_normalised"],
    ["SBR", "deduplicated"],
    ["AFM", "no_weakness"],
    ["SBR", "dimension_low"],
    ["AFM", "marking_missing"],
    ["SBR", "general"],
    ["AFM", "unicode"],
  ] as const;
  for (const [paper, variant] of cases) {
    const input = source(paper);
    const packet = (await exportWorkerDiagnosticPacket(attemptFromSource(input))).packet;
    const diagnostic = diagnosticFor(packet, variant);
    const worker = await processWorkerManualDiagnostic(packet, diagnostic);
    const python = pythonOracle({ action: "process", packet, diagnostic });
    delete worker.processed_at;
    delete python.processed_at;
    assert.deepEqual(worker, python, `${paper}/${variant}`);
  }
});

test("Worker strict schema and packet binding fail closed", async () => {
  const packet = (await exportWorkerDiagnosticPacket(attemptFromSource(source("AFM")))).packet;
  const diagnostic = diagnosticFor(packet, "aligned");
  await assert.rejects(() => processWorkerManualDiagnostic(packet, { ...diagnostic, leaked_internal_field: true }), /Strict diagnostic schema validation failed/);
  await assert.rejects(() => processWorkerManualDiagnostic(packet, { ...diagnostic, analysis_id: "different-analysis" }), /does not match the exported packet/);
});
