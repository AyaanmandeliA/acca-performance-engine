import { z } from "zod";
import type { BetaBackendPayload } from "./domain";

const confidence = z.enum(["LOW", "MEDIUM", "HIGH"]);
const evidence = z.object({ answer_location: z.string().min(1), excerpt: z.string().min(1) }).strict();
const diagnosticSummary = z.string().trim().min(20).max(600)
  .refine((value) => value.split(/[.!?]+/).filter((part) => part.trim()).length <= 3, "Diagnostic summary must be 1–3 sentences")
  .refine((value) => !/\b(?:mark|marks|score|scores|percentage|percent)\b|\b\d+\s*%/i.test(value), "Diagnostic summary must not include marks or scores");
const studentView = z.object({
  diagnostic_summary: diagnosticSummary,
  major_strengths: z.array(z.object({ strength_reference: z.string(), dimension: z.string(), confidence, evidence: z.array(evidence), explanation: z.string() }).strict()).max(6),
  major_weaknesses: z.array(z.object({ weakness_reference: z.string(), dimension: z.string(), category: z.enum(["TECHNICAL_KNOWLEDGE", "EXAM_TECHNIQUE"]), severity: z.enum(["MINOR", "MODERATE", "MAJOR"]), confidence, evidence: z.array(evidence), explanation: z.string() }).strict()).max(6),
  dimension_assessments: z.array(z.object({ dimension: z.string(), applicability: z.literal("APPLICABLE"), assessment: z.enum(["WEAK", "MIXED", "GOOD", "STRONG"]), confidence, evidence: z.array(evidence), rationale: z.string() }).strict()).max(10),
  priority_improvement_areas: z.array(z.object({ priority: z.number().int().positive(), weakness_reference: z.string(), dimension: z.string(), reason: z.string(), practice_action: z.string().nullable(), success_check: z.string().nullable() }).strict()).max(4),
  skill_recommendations: z.array(z.object({ recommendation_type: z.literal("SKILL_RECOMMENDATION"), rank: z.number().int().positive(), skill: z.string(), dimension: z.string(), confidence, practice_action: z.string().nullable(), success_check: z.string().nullable() }).strict()).max(3),
  uncertainty_notices: z.array(z.string()),
  disclaimer: z.string().min(1),
}).strict();

export const betaBackendPayloadSchema = z.object({
  contract_version: z.literal("beta-backend-v0.2.0"), analysis_reference: z.string().min(1),
  paper: z.enum(["AFM", "SBR"]), human_review_required: z.literal(true),
  release_status: z.enum(["HUMAN_REVIEW_REQUIRED", "WITHHELD_UNSUPPORTED_PAPER"]),
  withholding_reasons: z.array(z.string()), student_view: studentView.nullable(),
}).strict();

const prohibitedStudentKeys = new Set(["indicative_mark", "mark", "mark_range", "range", "score", "tag", "state", "question_key", "specific_question_recommendations", "normalisation_audit", "provenance", "raw_diagnostic", "normalised_evidence", "engine_version", "config_version"]);

export function findProhibitedStudentKeys(value: unknown): string[] {
  const found = new Set<string>();
  function walk(item: unknown) {
    if (Array.isArray(item)) return item.forEach(walk);
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) { if (prohibitedStudentKeys.has(key)) found.add(key); walk(nested); }
  }
  walk(value);
  return [...found].sort();
}

export function parseBetaBackendPayload(value: unknown): BetaBackendPayload {
  const parsed = betaBackendPayloadSchema.parse(value);
  const prohibited = findProhibitedStudentKeys(parsed.student_view);
  if (prohibited.length) throw new Error(`Prohibited student fields: ${prohibited.join(", ")}`);
  if (parsed.release_status === "WITHHELD_UNSUPPORTED_PAPER" && parsed.student_view !== null) throw new Error("Withheld payloads must not contain a student view");
  return parsed as BetaBackendPayload;
}
