// Part of ../../PROJECT.md — Worker-native manual diagnostic packet and v0.2 pipeline.
/* eslint-disable @typescript-eslint/no-explicit-any -- the frozen schema is validated before these dynamic JSON records enter the pipeline. */
import type { ManualDiagnosticPacket, ReviewAttempt } from "./domain";
import validateDiagnosticSchema from "./generated/diagnostic-validator.cjs";
import {
  afmPaperRules,
  creditLedgerText,
  diagnosticSchema,
  engineConfig,
  ledgerConfig,
  paperRulesText,
  promptText,
  safeguardsText,
  sbrPaperRules,
  taxonomyText,
  uncertaintyText,
} from "./generated/manual-engine-reference";

type JsonRecord = Record<string, any>;
type PacketResponse = { packet: ManualDiagnosticPacket; packetHash: string; promptText: string };

export type WorkerPipelineBundle = {
  pipeline_version: "manual-pipeline-v0.1.0";
  diagnostic_sha256: string;
  processed_at: string;
  beta_backend_payload: JsonRecord;
  normalised_attempt: JsonRecord;
  weakness_result: JsonRecord;
  recommendation_result: JsonRecord;
};

export class ManualPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualPipelineError";
  }
}

const config = engineConfig as JsonRecord;
const creditConfig = ledgerConfig as JsonRecord;
const paperModules = { AFM: afmPaperRules as JsonRecord, SBR: sbrPaperRules as JsonRecord } as const;
const confidences = new Set(["LOW", "MEDIUM", "HIGH"]);
const severities = new Set(["MINOR", "MODERATE", "MAJOR"]);
const confidenceRank: JsonRecord = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const severityRank: JsonRecord = { MINOR: 0, MODERATE: 1, MAJOR: 2 };
const classificationRank: JsonRecord = { STYLE_NOTE: 0, DIAGNOSTIC_WEAKNESS: 1, MARK_MATERIAL_WEAKNESS: 2 };
const strengthTagDimensions: JsonRecord = {
  TECHNICAL_KNOWLEDGE_ACCURATE: "TECHNICAL_KNOWLEDGE",
  REQUIREMENT_INTERPRETED_ACCURATELY: "REQUIREMENT_INTERPRETATION",
  SCENARIO_APPLICATION_EFFECTIVE: "SCENARIO_APPLICATION",
  ANALYSIS_WELL_DEVELOPED: "ANALYSIS_DEVELOPMENT",
  TRADE_OFFS_WEIGHED: "EVALUATION_JUDGEMENT",
  JUDGEMENT_PROPORTIONATE: "EVALUATION_JUDGEMENT",
  CALCULATION_ACCURATE: "QUANTITATIVE_ACCURACY",
  QUANTITATIVE_INSIGHT_EFFECTIVE: "QUANTITATIVE_INTERPRETATION",
  PROFESSIONAL_COMMUNICATION_EFFECTIVE: "PROFESSIONAL_SKILLS",
  PROFESSIONAL_SCEPTICISM_EFFECTIVE: "PROFESSIONAL_SKILLS",
  EFFICIENT_EXAM_EXECUTION: "EXAM_EXECUTION",
  CONCLUSION_WELL_SUPPORTED: "CONCLUSION_RECOMMENDATION",
  RECOMMENDATION_ACTIONABLE: "CONCLUSION_RECOMMENDATION",
};

const clone = <T>(value: T): T => structuredClone(value);
const unique = <T>(values: T[]): T[] => [...new Set(values)];
const sorted = (values: string[]): string[] => [...values].sort();
const pyRound = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * Math.abs(scaled) * 2) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function pythonJsonString(value: string): string {
  return JSON.stringify(value).replace(/[^\x00-\x7f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return pythonJsonString(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ManualPipelineError("Non-finite numbers are not valid diagnostic JSON.");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as JsonRecord).sort().map((key) =>
      `${pythonJsonString(key)}:${canonicalJson((value as JsonRecord)[key])}`
    ).join(",")}}`;
  }
  throw new ManualPipelineError("Unsupported value in diagnostic JSON.");
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Json(value: unknown): Promise<string> {
  return sha256Text(canonicalJson(value));
}

function capConfidence(confidence: string, cap: string | null): string {
  if (cap === null) return confidence;
  if (!(confidence in confidenceRank) || !(cap in confidenceRank)) throw new ManualPipelineError("Unknown confidence value");
  return confidenceRank[confidence] <= confidenceRank[cap] ? confidence : cap;
}

function normaliseUncertainty(flags: string[], paperRulesAvailable: boolean, evidencePresent: boolean) {
  const policy = creditConfig.uncertainty_policy;
  const sourceFlags = unique(flags);
  const blocking = sorted(sourceFlags.filter((flag) => policy.blocking_flags.includes(flag)));
  const handled: JsonRecord[] = [];
  const engineFlags = [...sourceFlags];
  let confidenceCap: string | null = null;
  const unavailableIndex = engineFlags.indexOf("PAPER_RULES_UNAVAILABLE");
  if (unavailableIndex >= 0 && evidencePresent) {
    engineFlags.splice(unavailableIndex, 1);
    confidenceCap = policy.confidence_cap_when_paper_rules_unavailable;
    handled.push({
      flag: "PAPER_RULES_UNAVAILABLE",
      treatment: "MARK_ESTIMATION_BLOCKED_DIAGNOSTIC_EVIDENCE_ALLOWED_WITH_CONFIDENCE_CAP",
    });
  }
  if (!paperRulesAvailable && !sourceFlags.includes("PAPER_RULES_UNAVAILABLE")) {
    sourceFlags.push("PAPER_RULES_UNAVAILABLE");
    confidenceCap = policy.confidence_cap_when_paper_rules_unavailable;
    handled.push({ flag: "PAPER_RULES_UNAVAILABLE", treatment: "ADDED_BY_ADAPTER_AND_CONFIDENCE_CAPPED" });
  }
  return {
    source_flags: sourceFlags,
    engine_flags: engineFlags,
    blocking_flags: blocking,
    handled_flags: handled,
    confidence_cap: confidenceCap,
    mark_estimation_eligible: blocking.length === 0 && !sourceFlags.some((flag) => policy.mark_only_flags.includes(flag)),
  };
}

function dimensionDecision(applicability: string, confidence: string, flags: string[]) {
  if (applicability === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (applicability === "INSUFFICIENT_EVIDENCE") return "ABSTAIN";
  if (flags.some((flag) => creditConfig.uncertainty_policy.blocking_flags.includes(flag))) return "ABSTAIN";
  if (!(confidence in confidenceRank)) throw new ManualPipelineError("Unknown confidence value");
  return "USE";
}

function normaliseCrossFields(input: JsonRecord) {
  const document = clone(input);
  const assessments = document.dimension_assessments;
  if (!Array.isArray(assessments)) {
    return {
      document,
      audit: { version: "cross-field-normaliser-v0.1.0", status: "NOT_RUN_INVALID_ENVELOPE", source_document_modified: false, actions: [] },
      provenance: new Map<string, JsonRecord>(),
    };
  }
  const byDimension = new Map(assessments.filter((item: unknown) => item && typeof item === "object" && typeof (item as JsonRecord).dimension === "string").map((item: JsonRecord) => [item.dimension, item]));
  const actions: JsonRecord[] = [];
  const provenance = new Map<string, JsonRecord>();
  const specifications = [
    ["WEAKNESS", "major_weaknesses", "weakness_id", "weakness_tags", config.tag_dimensions],
    ["STRENGTH", "major_strengths", "strength_id", "strength_tags", strengthTagDimensions],
  ] as const;
  for (const [findingType, collectionKey, idKey, tagListKey, mapping] of specifications) {
    const findings = document[collectionKey];
    if (!Array.isArray(findings)) continue;
    findings.forEach((finding: JsonRecord, index: number) => {
      if (!finding || typeof finding !== "object") return;
      const findingId = finding[idKey];
      const tag = finding.tag;
      const originalDimension = finding.dimension;
      const canonicalDimension = mapping[tag];
      const sourcePath = `$.${collectionKey}[${index}]`;
      if (typeof findingId !== "string" || canonicalDimension === undefined) return;
      const target = byDimension.get(canonicalDimension) as JsonRecord | undefined;
      const targetTags = Array.isArray(target?.[tagListKey]) ? target![tagListKey] : [];
      const needsDimensionMove = originalDimension !== canonicalDimension;
      const needsParentBackfill = !targetTags.includes(tag);
      if (!needsDimensionMove && !needsParentBackfill) return;
      if (!target || target.applicability !== "APPLICABLE") {
        throw new ManualPipelineError(`unsafe semantic contradiction: ${findingType.toLowerCase()} ${findingId} uses ${tag}, but its canonical dimension ${canonicalDimension} is not APPLICABLE`);
      }
      const confidenceBefore = finding.confidence;
      let confidenceAfter = confidenceBefore;
      const operations: string[] = [];
      if (needsDimensionMove) {
        finding.dimension = canonicalDimension;
        operations.push("CANONICAL_DIMENSION_REASSIGNMENT");
        if (confidences.has(confidenceBefore)) {
          confidenceAfter = capConfidence(confidenceBefore, "MEDIUM");
          finding.confidence = confidenceAfter;
        }
        const sourceAssessment = byDimension.get(originalDimension) as JsonRecord | undefined;
        const sourceTags = sourceAssessment?.[tagListKey];
        if (Array.isArray(sourceTags) && sourceTags.includes(tag)) {
          sourceAssessment![tagListKey] = sourceTags.filter((value: string) => value !== tag);
          operations.push("MISPLACED_PARENT_TAG_REMOVED");
        }
      }
      if (needsParentBackfill) {
        target[tagListKey] = [...targetTags, tag];
        operations.push("CANONICAL_PARENT_TAG_BACKFILL");
      }
      const actionId = `NORM-${String(actions.length + 1).padStart(3, "0")}`;
      actions.push({
        action_id: actionId, finding_type: findingType, finding_id: findingId, tag, source_path: sourcePath,
        original_dimension: originalDimension, canonical_dimension: canonicalDimension, operations,
        severity_before: finding.severity ?? null, severity_after: finding.severity ?? null,
        confidence_before: confidenceBefore ?? null, confidence_after: confidenceAfter ?? null,
        flag: "NORMALISED_CROSS_FIELD",
      });
      provenance.set(`${findingType}:${findingId}`, {
        source_path: sourcePath, original_dimension: originalDimension, canonical_dimension: canonicalDimension,
        normalisation_action_ids: [actionId],
      });
    });
  }
  return {
    document,
    audit: {
      version: "cross-field-normaliser-v0.1.0",
      status: actions.length ? "NORMALISED_CROSS_FIELD" : "SOURCE_ALIGNED",
      source_document_modified: false,
      actions,
      severity_increase_count: 0,
      confidence_increase_count: 0,
    },
    provenance,
  };
}

function validateAdapterDocument(document: JsonRecord) {
  const errors: string[] = [];
  const required = new Set([
    "schema_version", "analysis_id", "benchmark_case_id", "generated_at", "paper", "question_requirement",
    "marks_available", "diagnostic_model", "indicative_mark", "diagnosis_summary", "dimension_assessments",
    "major_strengths", "major_weaknesses", "priority_weaknesses", "technical_knowledge_gaps",
    "exam_technique_gaps", "recommended_improvement_actions", "uncertainty",
  ]);
  const keys = Object.keys(document);
  const missing = sorted([...required].filter((key) => !(key in document)));
  const extra = sorted(keys.filter((key) => !required.has(key)));
  if (missing.length) errors.push(`missing root keys ${JSON.stringify(missing)}`);
  if (extra.length) errors.push(`unexpected root keys ${JSON.stringify(extra)}`);
  if (errors.length) throw new ManualPipelineError(errors.join("; "));
  if (document.schema_version !== "1.0.0") errors.push("unsupported schema version");
  if (typeof document.analysis_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(document.analysis_id)) errors.push("invalid analysis_id");
  if (typeof document.benchmark_case_id !== "string" || !/^(?:CASE-[0-9]{3}|ACCA-[A-Z0-9-]+-C[0-9]+)$/.test(document.benchmark_case_id)) errors.push("invalid benchmark_case_id");
  if (typeof document.generated_at !== "string" || Number.isNaN(Date.parse(document.generated_at))) errors.push("invalid generated_at");
  if (!(document.paper in paperModules)) errors.push(`unsupported paper ${document.paper}`);
  if (!document.diagnostic_model || typeof document.diagnostic_model !== "object" || Array.isArray(document.diagnostic_model)) errors.push("diagnostic_model must be an object");
  if (!document.uncertainty || typeof document.uncertainty !== "object" || !Array.isArray(document.uncertainty.flags)) errors.push("uncertainty.flags must be a list");

  let assessments = document.dimension_assessments;
  if (!Array.isArray(assessments) || assessments.length !== 10) {
    errors.push("exactly ten dimension assessments required");
    assessments = [];
  }
  const byDimension = new Map<string, JsonRecord>();
  assessments.forEach((item: JsonRecord, index: number) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`dimension assessment ${index} must be an object`);
      return;
    }
    const dimension = item.dimension;
    if (byDimension.has(dimension)) errors.push(`duplicate dimension ${dimension}`);
    byDimension.set(dimension, item);
    if (!["APPLICABLE", "NOT_APPLICABLE", "INSUFFICIENT_EVIDENCE"].includes(item.applicability)) errors.push(`invalid applicability for ${dimension}`);
    if (item.applicability === "APPLICABLE") {
      if (![0, 1, 2, 3, 4].includes(item.score)) errors.push(`invalid score for ${dimension}`);
      if (!confidences.has(item.confidence)) errors.push(`invalid confidence for ${dimension}`);
    } else if (item.score !== null) errors.push(`non-applicable dimension ${dimension} has a score`);
    for (const tag of item.weakness_tags ?? []) if (config.tag_dimensions[tag] !== dimension) errors.push(`tag ${tag} does not belong to ${dimension}`);
    for (const tag of item.strength_tags ?? []) if (strengthTagDimensions[tag] !== dimension) errors.push(`strength tag ${tag} does not belong to ${dimension}`);
  });

  let weaknesses = document.major_weaknesses;
  if (!Array.isArray(weaknesses)) { errors.push("major_weaknesses must be a list"); weaknesses = []; }
  const weaknessIds = new Set<string>();
  weaknesses.forEach((finding: JsonRecord, index: number) => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) { errors.push(`major weakness ${index} must be an object`); return; }
    if (weaknessIds.has(finding.weakness_id)) errors.push(`duplicate weakness_id ${finding.weakness_id}`);
    weaknessIds.add(finding.weakness_id);
    if (config.tag_dimensions[finding.tag] !== finding.dimension) errors.push(`weakness tag ${finding.tag} does not belong to ${finding.dimension}`);
    const assessment = byDimension.get(finding.dimension);
    if (!assessment || !assessment.weakness_tags?.includes(finding.tag)) errors.push(`weakness ${finding.weakness_id} tag ${finding.tag} is absent from its dimension assessment`);
    else if (assessment.applicability !== "APPLICABLE") errors.push(`weakness ${finding.weakness_id} conflicts with non-applicable dimension ${finding.dimension}`);
    if (!severities.has(finding.severity)) errors.push(`invalid severity for ${finding.weakness_id}`);
    if (!confidences.has(finding.confidence)) errors.push(`invalid confidence for ${finding.weakness_id}`);
    if (!finding.evidence?.length) errors.push(`missing evidence for ${finding.weakness_id}`);
  });

  let strengths = document.major_strengths;
  if (!Array.isArray(strengths)) { errors.push("major_strengths must be a list"); strengths = []; }
  strengths.forEach((strength: JsonRecord, index: number) => {
    if (!strength || typeof strength !== "object" || Array.isArray(strength)) { errors.push(`major strength ${index} must be an object`); return; }
    if (strengthTagDimensions[strength.tag] !== strength.dimension) errors.push(`strength tag ${strength.tag} does not belong to ${strength.dimension}`);
    const assessment = byDimension.get(strength.dimension);
    if (!assessment || !assessment.strength_tags?.includes(strength.tag)) errors.push(`strength ${strength.strength_id} is absent from its dimension assessment`);
    else if (assessment.applicability !== "APPLICABLE") errors.push(`strength ${strength.strength_id} conflicts with non-applicable dimension ${strength.dimension}`);
    if (!confidences.has(strength.confidence)) errors.push("invalid strength confidence");
    if (!strength.evidence?.length) errors.push("missing strength evidence");
  });
  if (errors.length) throw new ManualPipelineError(errors.join("; "));
}

function groupFindings(findings: JsonRecord[]) {
  const tagToGroup = new Map<string, string>();
  for (const group of creditConfig.deduplication_groups) for (const tag of group.tags) tagToGroup.set(tag, group.group_id);
  const groups = new Map<string, JsonRecord[]>();
  const seen = new Set<string>();
  for (const finding of findings) {
    if (!finding.finding_id) throw new ManualPipelineError("Every finding requires finding_id");
    if (seen.has(finding.finding_id)) throw new ManualPipelineError(`Duplicate finding_id ${finding.finding_id}`);
    seen.add(finding.finding_id);
    const related = tagToGroup.get(finding.tag);
    const root = finding.root_issue_id ?? (related ? `AUTO|${related}|${finding.requirement_id ?? "UNKNOWN_REQUIREMENT"}|${finding.credit_unit_id ?? "GENERAL"}` : finding.finding_id);
    groups.set(root, [...(groups.get(root) ?? []), finding]);
  }
  return [...groups.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([root, members]) => {
    const ordered = [...members].sort((left, right) =>
      classificationRank[right.classification] - classificationRank[left.classification]
      || severityRank[right.severity ?? "MINOR"] - severityRank[left.severity ?? "MINOR"]
      || confidenceRank[right.confidence ?? "LOW"] - confidenceRank[left.confidence ?? "LOW"]
      || (left.finding_id < right.finding_id ? -1 : left.finding_id > right.finding_id ? 1 : 0)
    );
    const primary = ordered[0];
    const details = ordered.map((item) => ({
      ...clone(item),
      is_root_primary: item.finding_id === primary.finding_id,
      effective_mark_penalty: item.finding_id === primary.finding_id && Boolean(item.direct_credit_reduction_allowed),
    }));
    return {
      root_issue_id: root,
      primary_finding_id: primary.finding_id,
      finding_ids: ordered.map((item) => item.finding_id),
      effective_mark_penalty_count: details.filter((item) => item.effective_mark_penalty).length,
      findings: details,
    };
  });
}

function adaptDiagnostic(input: JsonRecord) {
  const { document, audit, provenance } = normaliseCrossFields(input);
  validateAdapterDocument(document);
  const paperModule = paperModules[document.paper as "AFM" | "SBR"];
  const modelRuleVersion = document.diagnostic_model.paper_rules_version;
  const paperRulesAvailable = modelRuleVersion === paperModule.version;
  const uncertainty = normaliseUncertainty(document.uncertainty.flags, paperRulesAvailable, document.major_weaknesses.every((finding: JsonRecord) => finding.evidence?.length));
  const cap = uncertainty.confidence_cap;
  const dimensions = new Map(document.dimension_assessments.map((item: JsonRecord) => [item.dimension, item]));
  const dimensionScores: JsonRecord = {};
  const dimensionConfidence: JsonRecord = {};
  const dimensionApplicability: JsonRecord = {};
  for (const [dimension, item] of dimensions as Map<string, JsonRecord>) {
    dimensionApplicability[dimension] = item.applicability;
    const confidence = confidences.has(item.confidence) ? item.confidence : "LOW";
    if (dimensionDecision(item.applicability, confidence, uncertainty.engine_flags) !== "USE") continue;
    dimensionScores[dimension] = item.score;
    dimensionConfidence[dimension] = capConfidence(item.confidence, cap);
  }

  const actionsByWeakness = new Map<string, JsonRecord[]>();
  for (const action of document.recommended_improvement_actions) {
    for (const weaknessId of action.related_weakness_ids ?? []) {
      actionsByWeakness.set(weaknessId, [...(actionsByWeakness.get(weaknessId) ?? []), {
        action_id: action.action_id ?? null,
        priority: action.priority ?? null,
        action: action.action ?? null,
        success_check: action.success_check ?? null,
      }]);
    }
  }
  const actionSort = (left: JsonRecord, right: JsonRecord) => {
    const leftNone = left.priority === null ? 1 : 0;
    const rightNone = right.priority === null ? 1 : 0;
    return leftNone - rightNone || (left.priority ?? 0) - (right.priority ?? 0)
      || String(left.action_id ?? "").localeCompare(String(right.action_id ?? ""));
  };
  const normalisedFindings = document.major_weaknesses.map((item: JsonRecord, index: number) => {
    const source = provenance.get(`WEAKNESS:${item.weakness_id}`) ?? {
      source_path: `$.major_weaknesses[${index}]`, original_dimension: item.dimension,
      canonical_dimension: item.dimension, normalisation_action_ids: [],
    };
    const adaptedConfidence = capConfidence(item.confidence, cap);
    return {
      finding_id: item.weakness_id, requirement_id: "WHOLE_SCRIPT", credit_unit_id: "GENERAL", tag: item.tag,
      dimension: item.dimension, canonical_dimension: item.dimension, original_dimension: source.original_dimension,
      applicability: (dimensions.get(item.dimension) as JsonRecord).applicability, severity: item.severity,
      confidence: adaptedConfidence, classification: "DIAGNOSTIC_WEAKNESS", direct_credit_reduction_allowed: false,
      safeguard_reasons: ["MARK_EFFECT_NOT_INFERRED_BY_ADAPTER"], rule_status: null, evidence: clone(item.evidence),
      evidence_reference: `${source.source_path}.evidence`, explanation: item.explanation,
      source_gap_class: item.gap_class, weakness_class: item.gap_class,
      uncertainty: { source_flags: clone(uncertainty.source_flags), downstream_flags: clone(uncertainty.engine_flags), confidence_cap: cap },
      severity_change: { source: item.severity, adapted: item.severity },
      confidence_change: { source: item.confidence, adapted: adaptedConfidence },
      normalisation_status: source.normalisation_action_ids.length ? "NORMALISED_CROSS_FIELD" : "SOURCE_ALIGNED",
      provenance: clone(source), recommended_actions: [...(actionsByWeakness.get(item.weakness_id) ?? [])].sort(actionSort),
    };
  });
  const groups = groupFindings(normalisedFindings);
  const engineWeaknesses = groups.map((group) => {
    const primary = group.findings.find((item: JsonRecord) => item.is_root_primary)!;
    return {
      finding_id: primary.finding_id, tag: primary.tag, canonical_dimension: primary.canonical_dimension,
      original_dimension: primary.original_dimension, applicability: primary.applicability, severity: primary.severity,
      confidence: primary.confidence, evidence_reference: primary.evidence_reference, evidence: clone(primary.evidence),
      explanation: primary.explanation, weakness_class: primary.weakness_class, uncertainty: clone(primary.uncertainty),
      normalisation_status: primary.normalisation_status, provenance: clone(primary.provenance),
      recommended_actions: clone(primary.recommended_actions), source_finding_ids: clone(group.finding_ids),
    };
  }).sort((left, right) => left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : 0);

  const strengthEvidence = document.major_strengths.map((item: JsonRecord, index: number) => {
    const source = provenance.get(`STRENGTH:${item.strength_id}`) ?? {
      source_path: `$.major_strengths[${index}]`, original_dimension: item.dimension,
      canonical_dimension: item.dimension, normalisation_action_ids: [],
    };
    return {
      strength_id: item.strength_id, tag: item.tag, canonical_dimension: item.dimension,
      original_dimension: source.original_dimension, applicability: (dimensions.get(item.dimension) as JsonRecord).applicability,
      confidence: capConfidence(item.confidence, cap), evidence: clone(item.evidence),
      evidence_reference: `${source.source_path}.evidence`, explanation: item.explanation,
      normalisation_status: source.normalisation_action_ids.length ? "NORMALISED_CROSS_FIELD" : "SOURCE_ALIGNED",
      provenance: clone(source),
    };
  });
  return {
    normalised_evidence_version: "attempt-evidence-v0.2.1",
    analysis_id: document.analysis_id,
    attempt_group_id: document.analysis_id,
    attempted_at: document.generated_at,
    attempted_at_basis: "DIAGNOSTIC_GENERATED_AT_PROXY",
    question_key: document.benchmark_case_id,
    topic: paperModule.context_defaults.topic,
    question_type: paperModule.context_defaults.question_type,
    dimension_scores: dimensionScores,
    dimension_confidence: dimensionConfidence,
    dimension_applicability: dimensionApplicability,
    strength_tags: unique(strengthEvidence.map((item: JsonRecord) => item.tag)),
    strength_evidence: strengthEvidence,
    weaknesses: engineWeaknesses,
    weakness_evidence_groups: groups,
    uncertainty_flags: uncertainty.engine_flags,
    source_uncertainty_flags: uncertainty.source_flags,
    uncertainty_treatment: uncertainty,
    paper_rules: { source_version: modelRuleVersion, adapter_version: paperModule.version, available_to_source_diagnosis: paperRulesAvailable },
    mark_estimation_eligible: uncertainty.mark_estimation_eligible,
    normalisation_audit: audit,
    adapter_audit: {
      source_case_id: document.benchmark_case_id,
      source_weakness_count: document.major_weaknesses.length,
      engine_weakness_count: engineWeaknesses.length,
      deduplicated_count: document.major_weaknesses.length - engineWeaknesses.length,
      mark_effects_inferred: 0,
      normalisation_action_count: audit.actions.length,
    },
  };
}

function buildProfile(document: JsonRecord, attempt: JsonRecord) {
  return {
    profile_id: "manual-single-attempt",
    paper: document.paper,
    description: "Single-attempt normalised diagnostic evidence",
    current_study_context: { topic: attempt.topic, available_minutes: 60 },
    available_question_keys: [],
    attempts: [attempt],
  };
}

function classifySingleExposure(profile: JsonRecord, attempt: JsonRecord, weakness: JsonRecord, scope: string, contextKey: string) {
  const severityWeight = Number(config.severity_weights[weakness.severity]);
  const diagnosisWeight = Number(config.confidence_weights[weakness.confidence]);
  const dimensionConfidence = attempt.dimension_confidence[weakness.canonical_dimension];
  const classification = ["MEDIUM", "HIGH"].includes(weakness.confidence) ? "HIT" : "WEAK_SIGNAL";
  const exposure = {
    sequence: 0, analysis_id: attempt.analysis_id, attempt_group_id: attempt.attempt_group_id,
    attempted_at: attempt.attempted_at, attempt_date: attempt.attempted_at.slice(0, 10), question_key: attempt.question_key,
    topic: attempt.topic, question_type: attempt.question_type, context_key: `${attempt.topic}|${attempt.question_type}`,
    dimension_score: attempt.dimension_scores[weakness.canonical_dimension], dimension_confidence: dimensionConfidence,
    classification, severity: weakness.severity, diagnosis_confidence: weakness.confidence,
  };
  const hit = classification === "HIT";
  const state = hit ? "OBSERVED" : null;
  const confidence = weakness.confidence;
  const numerator = hit ? severityWeight * diagnosisWeight : 0;
  const denominator = Number(config.confidence_weights[dimensionConfidence]);
  const prevalence = denominator ? Math.min(1, Math.max(0, numerator / denominator)) : 0;
  const currentTopic = profile.current_study_context.topic;
  const examRelevance = currentTopic && exposure.topic === currentTopic
    ? Number(config.priority.current_topic_exam_relevance)
    : Number(config.priority.same_paper_exam_relevance);
  const components = {
    weighted_prevalence: pyRound(Number(config.priority.weighted_prevalence_points) * prevalence, 3),
    recent_max_severity: pyRound(Number(config.priority.recent_max_severity_points) * (hit ? severityWeight : 0), 3),
    state: pyRound(Number(config.priority.state_points) * Number(config.priority.state_weights[state ?? ""] ?? 0), 3),
    exam_relevance: pyRound(Number(config.priority.exam_relevance_points) * examRelevance, 3),
    breadth: pyRound(Number(config.priority.breadth_points) * (hit ? 1 / Number(config.priority.breadth_contexts_for_full_weight) : 0), 3),
  };
  let priorityScore = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (confidence === "LOW") priorityScore = Math.min(priorityScore, Number(config.priority.low_confidence_only_cap));
  priorityScore = pyRound(Math.min(100, Math.max(0, priorityScore)), 3);
  const reasons = hit ? ["AT_LEAST_ONE_SUPPORTED_HIT"] : ["LOW_CONFIDENCE_SIGNAL_ONLY"];
  return {
    tag: weakness.tag,
    dimension: weakness.canonical_dimension,
    scope,
    context_key: contextKey,
    state,
    prior_state: null,
    confidence,
    insufficient_signal: !hit,
    weighted_prevalence: pyRound(prevalence, 6),
    prevalence_numerator: pyRound(numerator, 6),
    prevalence_denominator: pyRound(denominator, 6),
    counts: { hits: hit ? 1 : 0, weak_signals: hit ? 0 : 1, clean: 0, neutral: 0, relevant_exposures: 1 },
    priority_score: priorityScore,
    priority_components: components,
    supporting_analysis_ids: hit ? [attempt.analysis_id] : [],
    last_observed_at: hit ? attempt.attempted_at : null,
    context_breadth: hit ? 1 : 0,
    reactivated: false,
    inactive_observation: false,
    trend: hit
      ? "A supported issue is visible, but independent pattern evidence is insufficient."
      : "Only low-confidence evidence is present; no active weakness state is assigned.",
    current_reason_codes: reasons,
    transitions: [{
      from_state: null, to_state: state, effective_at: attempt.attempted_at,
      rule_version: config.weakness_engine_version, supporting_analysis_ids: [attempt.analysis_id], reason_codes: reasons,
    }].filter((transition) => transition.to_state !== null),
    engine_version: config.weakness_engine_version,
    config_version: config.config_version,
  };
}

function analyzeSingleAttempt(profile: JsonRecord, attempt: JsonRecord) {
  const unsafe = new Set(["SOURCE_UNREADABLE", "OUTSIDE_SUPPORTED_SCOPE", "PAPER_RULES_UNAVAILABLE"]);
  const observedTags = sorted(unique(attempt.weaknesses.map((item: JsonRecord) => item.tag)));
  const contextProfiles: JsonRecord[] = [];
  const displayProfiles: JsonRecord[] = [];
  for (const tag of observedTags) {
    const weakness = attempt.weaknesses.filter((item: JsonRecord) => item.tag === tag).sort((left: JsonRecord, right: JsonRecord) => {
      const rightStrength = Number(config.severity_weights[right.severity]) * Number(config.confidence_weights[right.confidence]);
      const leftStrength = Number(config.severity_weights[left.severity]) * Number(config.confidence_weights[left.confidence]);
      return rightStrength - leftStrength || String(right.severity).localeCompare(String(left.severity));
    })[0];
    const dimension = config.tag_dimensions[tag];
    const dimensionConfidence = attempt.dimension_confidence[dimension];
    if (!(dimension in attempt.dimension_scores) || dimensionConfidence === "LOW" || attempt.uncertainty_flags.some((flag: string) => unsafe.has(flag))) continue;
    const contextKey = `${attempt.topic}|${attempt.question_type}`;
    const context = classifySingleExposure(profile, attempt, weakness, "CONTEXT", contextKey);
    contextProfiles.push(context);
    const isGeneral = config.context.inherently_general_tags.includes(tag);
    displayProfiles.push(isGeneral ? classifySingleExposure(profile, attempt, weakness, "PAPER_ROLLUP", "ANY_TOPIC|ANY_QUESTION_TYPE") : context);
  }
  displayProfiles.sort((left, right) => right.priority_score - left.priority_score || (left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : left.context_key < right.context_key ? -1 : 1));
  contextProfiles.sort((left, right) => left.tag < right.tag ? -1 : left.tag > right.tag ? 1 : left.context_key < right.context_key ? -1 : 1);
  const strengthCounts = new Map<string, number>();
  for (const tag of attempt.strength_tags) strengthCounts.set(tag, (strengthCounts.get(tag) ?? 0) + 1);
  const strengths = [...strengthCounts.entries()].sort(([leftTag, leftCount], [rightTag, rightCount]) => rightCount - leftCount || (leftTag < rightTag ? -1 : 1)).map(([tag, occurrences]) => ({ tag, occurrences, last_observed_at: attempt.attempted_at }));
  return {
    student_id: profile.profile_id, paper: profile.paper, description: profile.description,
    current_study_context: clone(profile.current_study_context), strengths,
    weakness_profiles: displayProfiles, context_profiles: contextProfiles,
    engine_version: config.weakness_engine_version, config_version: config.config_version,
  };
}

function buildRecommendations(profile: JsonRecord, weaknessResult: JsonRecord, allowSpecificQuestions: boolean) {
  const active = weaknessResult.weakness_profiles.filter((item: JsonRecord) =>
    !item.inactive_observation && item.state && item.confidence !== "LOW" && Number(item.priority_score) > 0
  ).map(clone).sort((left: JsonRecord, right: JsonRecord) => right.priority_score - left.priority_score || (left.tag < right.tag ? -1 : 1));
  let mode = "BASELINE";
  if (active.length) {
    const top = active[0];
    if (config.technical_dimensions.includes(top.dimension) && ["EMERGING", "RECURRING", "REGRESSING"].includes(top.state)) mode = "FOUNDATION_REPAIR";
    else if (["IMPROVING", "POTENTIALLY_RESOLVED"].includes(top.state)) mode = "CONFIRM_IMPROVEMENT";
    else {
      const high = active.filter((item: JsonRecord) => Number(item.priority_score) >= Number(config.recommendation.broad_profile_priority_floor));
      const broad = high.length >= Number(config.recommendation.broad_profile_minimum_count)
        && Math.max(0, ...high.map((item: JsonRecord) => Number(item.context_breadth ?? 0))) >= Number(config.recommendation.broad_profile_minimum_contexts);
      if (broad) mode = "MIXED_CHALLENGE";
      else {
        const total = active.reduce((sum: number, item: JsonRecord) => sum + Number(item.priority_score), 0);
        const topTwo = active.slice(0, 2).reduce((sum: number, item: JsonRecord) => sum + Number(item.priority_score), 0);
        mode = total && topTwo / total >= Number(config.recommendation.targeted_priority_share) ? "TARGETED" : "MIXED_CHALLENGE";
      }
    }
  }
  const eligible = active.filter((item: JsonRecord) => mode === "CONFIRM_IMPROVEMENT" || item.state !== "POTENTIALLY_RESOLVED").slice(0, Number(config.recommendation.maximum_targets));
  const totalPriority = eligible.reduce((sum: number, item: JsonRecord) => sum + Number(item.priority_score), 0);
  const targets = eligible.map((item: JsonRecord) => ({
    tag: item.tag, dimension: item.dimension, state: item.state, confidence: item.confidence,
    priority_score: item.priority_score, context_key: item.context_key,
    weight: pyRound(totalPriority ? Number(item.priority_score) / totalPriority : 0, 6),
  }));
  const skillRecommendations = targets.map((target: JsonRecord, index: number) => {
    const sourcedActions: JsonRecord[] = [];
    const sourceAnalysisIds: string[] = [];
    for (const attempt of profile.attempts) for (const weakness of attempt.weaknesses) {
      if (weakness.tag !== target.tag) continue;
      sourceAnalysisIds.push(attempt.analysis_id);
      sourcedActions.push(...clone(weakness.recommended_actions ?? []));
    }
    sourcedActions.sort((left, right) => (left.priority === null ? 1 : 0) - (right.priority === null ? 1 : 0)
      || (left.priority ?? 0) - (right.priority ?? 0)
      || String(left.action_id ?? "").localeCompare(String(right.action_id ?? "")));
    const primary = sourcedActions[0] ?? {};
    return {
      recommendation_type: "SKILL_RECOMMENDATION", safety_status: "BETA_ELIGIBLE_AFTER_HUMAN_REVIEW",
      rank: index + 1, skill_id: target.tag, skill_label: target.tag.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase()),
      dimension: target.dimension, confidence: target.confidence, priority_score: target.priority_score,
      practice_action: primary.action ?? null, success_check: primary.success_check ?? null,
      source_analysis_ids: sorted(unique(sourceAnalysisIds)),
    };
  });
  return {
    student_id: profile.profile_id, paper: profile.paper, mode, outcome: "NO_ELIGIBLE_QUESTION", targets,
    recommendations: [], skill_recommendations: skillRecommendations,
    skill_recommendation_outcome: skillRecommendations.length ? "SKILL_RECOMMENDATIONS_AVAILABLE" : "NO_SUPPORTED_SKILL_RECOMMENDATION",
    specific_question_recommendations: [],
    specific_question_recommendation_status: allowSpecificQuestions ? "DEVELOPMENT_ONLY" : "BLOCKED_PAPER_RULES_UNAVAILABLE",
    safety_flags: [allowSpecificQuestions ? "SYNTHETIC_CATALOGUE_DEVELOPMENT_ONLY" : "PAPER_RULES_UNAVAILABLE_SPECIFIC_QUESTIONS_BLOCKED"],
    exclusions: [], engine_version: config.recommendation_engine_version, config_version: config.config_version,
  };
}

function buildBetaBackendPayload(document: JsonRecord, attempt: JsonRecord, recommendation: JsonRecord) {
  const base = {
    contract_version: "beta-backend-v0.2.0",
    analysis_reference: document.analysis_id,
    paper: document.paper,
    human_review_required: true,
  };
  if (!attempt.paper_rules.available_to_source_diagnosis) {
    return {
      ...base, release_status: "WITHHELD_UNSUPPORTED_PAPER",
      withholding_reasons: [
        "This paper has no validated production paper-rule module.",
        "Universal evidence may be retained internally, but no student view is released.",
      ], student_view: null,
    };
  }
  const normalisedWeaknesses = new Map<string, JsonRecord>();
  for (const group of attempt.weakness_evidence_groups) for (const finding of group.findings) normalisedWeaknesses.set(finding.finding_id, finding);
  const strengths = attempt.strength_evidence.map((item: JsonRecord) => ({
    strength_reference: item.strength_id, dimension: item.canonical_dimension, confidence: item.confidence,
    evidence: clone(item.evidence), explanation: item.explanation,
  }));
  const weaknesses = document.major_weaknesses.map((source: JsonRecord) => {
    const normalised = normalisedWeaknesses.get(source.weakness_id)!;
    return {
      weakness_reference: source.weakness_id, dimension: normalised.canonical_dimension, category: source.gap_class,
      severity: source.severity, confidence: normalised.confidence, evidence: clone(source.evidence), explanation: source.explanation,
    };
  });
  const assessments = document.dimension_assessments.filter((item: JsonRecord) => item.dimension in attempt.dimension_scores).map((item: JsonRecord) => ({
    dimension: item.dimension, applicability: item.applicability, assessment: item.categorical_assessment,
    confidence: attempt.dimension_confidence[item.dimension], evidence: clone(item.evidence), rationale: item.rationale,
  }));
  const priorities: JsonRecord[] = [];
  for (const priority of [...document.priority_weaknesses].sort((left, right) => left.priority_rank - right.priority_rank)) {
    const weakness = normalisedWeaknesses.get(priority.weakness_id);
    if (!weakness) continue;
    const actions = document.recommended_improvement_actions.filter((action: JsonRecord) => action.related_weakness_ids?.includes(priority.weakness_id)).sort((left: JsonRecord, right: JsonRecord) => left.priority - right.priority || (left.action_id < right.action_id ? -1 : 1));
    const action = actions[0] ?? {};
    priorities.push({
      priority: priority.priority_rank, weakness_reference: priority.weakness_id, dimension: weakness.canonical_dimension,
      reason: priority.reason, practice_action: action.action ?? null, success_check: action.success_check ?? null,
    });
  }
  const skillRecommendations = recommendation.skill_recommendations.map((item: JsonRecord) => ({
    recommendation_type: "SKILL_RECOMMENDATION", rank: item.rank, skill: item.skill_label,
    dimension: item.dimension, confidence: item.confidence, practice_action: item.practice_action, success_check: item.success_check,
  }));
  const lowConfidence = sorted(Object.entries(attempt.dimension_confidence).filter(([, confidence]) => confidence === "LOW").map(([dimension]) => dimension));
  const notices = clone(document.uncertainty.details);
  if (lowConfidence.length) notices.push(`Low-confidence evidence affects: ${lowConfidence.map((dimension) => dimension.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase())).join(", ")}.`);
  return {
    ...base, release_status: "HUMAN_REVIEW_REQUIRED", withholding_reasons: [],
    student_view: {
      diagnostic_summary: document.diagnosis_summary, major_strengths: strengths, major_weaknesses: weaknesses,
      dimension_assessments: assessments, priority_improvement_areas: priorities, skill_recommendations: skillRecommendations,
      uncertainty_notices: notices, disclaimer: "Diagnostic feedback only; this is not an official ACCA mark.",
    },
  };
}

function validateStrictSchema(document: unknown): asserts document is JsonRecord {
  if (!validateDiagnosticSchema(document)) {
    const details = (validateDiagnosticSchema.errors ?? []).slice(0, 12).map((error) => `${error.instancePath || "$"} ${error.message}`).join("; ");
    throw new ManualPipelineError(`Strict diagnostic schema validation failed: ${details}`);
  }
}

export async function exportWorkerDiagnosticPacket(attempt: ReviewAttempt): Promise<PacketResponse> {
  const source = {
    attempt_reference: attempt.id,
    paper: attempt.paper,
    question_label: attempt.questionLabel,
    marks_available: attempt.submission.marksAvailable,
    scenario_text: attempt.submission.scenarioText,
    requirement_text: attempt.submission.requirementText,
    permitted_marking_context: attempt.submission.permittedMarkingContext,
    student_answer: attempt.submission.answerText,
  };
  if (!Number.isInteger(source.marks_available) || (source.marks_available ?? 0) < 1 || (source.marks_available ?? 0) > 100) throw new ManualPipelineError("Manual diagnostics require marks_available from 1 to 100.");
  for (const [key, minimum, maximum] of [
    ["attempt_reference", 1, 200], ["question_label", 2, 120], ["scenario_text", 20, 50000],
    ["requirement_text", 8, 10000], ["student_answer", 20, 80000],
  ] as const) {
    const value = source[key];
    if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum) throw new ManualPipelineError(`${key} is outside the permitted length.`);
  }
  if (source.permitted_marking_context !== null && (typeof source.permitted_marking_context !== "string" || source.permitted_marking_context.length > 30000)) throw new ManualPipelineError("permitted_marking_context is invalid.");
  const attemptHash = await sha256Text(source.attempt_reference);
  const caseNumber = BigInt(`0x${attemptHash.slice(0, 12)}`).toString(10);
  const paperModule = paperModules[source.paper];
  const packet: ManualDiagnosticPacket = {
    packet_version: "manual-diagnostic-packet-v0.1.0",
    analysis_context: {
      analysis_id: `manual-${source.paper.toLowerCase()}-${attemptHash.slice(0, 20)}`,
      case_id: `ACCA-${source.paper}-MANUAL-C${caseNumber}`,
      paper: source.paper,
      question_label: source.question_label,
      marks_available: source.marks_available!,
      prompt_version: "manual-codex-v0.1.0",
      taxonomy_version: "diagnostic-taxonomy-v0.2",
      paper_rules_version: paperModule.version,
    },
    submission: {
      scenario_text: source.scenario_text,
      requirement_text: source.requirement_text,
      permitted_marking_context: source.permitted_marking_context,
      student_answer: source.student_answer,
    },
    permitted_context: {
      diagnostic_schema: clone(diagnosticSchema), taxonomy: taxonomyText, paper_rules: paperRulesText,
      paper_rule_module: clone(paperModule), credit_ledger_architecture: creditLedgerText,
      diagnostic_safeguards: safeguardsText, uncertainty_policy: uncertaintyText,
    },
    diagnostic_instructions: promptText as string,
  };
  return {
    packet,
    packetHash: await sha256Json(packet),
    promptText: (promptText as string).replace("`{{DIAGNOSTIC_PACKET_JSON}}`", JSON.stringify(packet, null, 2)),
  };
}

export async function processWorkerManualDiagnostic(packet: ManualDiagnosticPacket, input: unknown): Promise<WorkerPipelineBundle> {
  if (!packet || packet.packet_version !== "manual-diagnostic-packet-v0.1.0") throw new ManualPipelineError("Unsupported or missing packet version.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ManualPipelineError("Diagnostic must be a JSON object.");
  validateStrictSchema(input);
  const document = input as JsonRecord;
  const context = packet.analysis_context;
  const expected: JsonRecord = {
    analysis_id: context.analysis_id,
    benchmark_case_id: context.case_id,
    paper: context.paper,
    marks_available: context.marks_available,
  };
  const mismatches = Object.entries(expected).filter(([key, value]) => document[key] !== value).map(([key]) => key);
  for (const key of ["prompt_version", "taxonomy_version", "paper_rules_version"] as const) {
    if (document.diagnostic_model[key] !== context[key]) mismatches.push(`diagnostic_model.${key}`);
  }
  if (mismatches.length) throw new ManualPipelineError(`Diagnostic does not match the exported packet: ${mismatches.join(", ")}`);
  const attempt = adaptDiagnostic(document);
  const profile = buildProfile(document, attempt);
  const weakness = analyzeSingleAttempt(profile, attempt);
  const recommendation = buildRecommendations(profile, weakness, attempt.paper_rules.available_to_source_diagnosis);
  return {
    pipeline_version: "manual-pipeline-v0.1.0",
    diagnostic_sha256: await sha256Json(document),
    processed_at: new Date().toISOString(),
    beta_backend_payload: buildBetaBackendPayload(document, attempt, recommendation),
    normalised_attempt: attempt,
    weakness_result: weakness,
    recommendation_result: recommendation,
  };
}
