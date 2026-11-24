export type Paper = "AFM" | "SBR";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type ReviewDecision = "APPROVE" | "FLAG" | "REJECT";
export type Evidence = { answer_location: string; excerpt: string };

export type StudentView = {
  diagnostic_summary: string;
  major_strengths: Array<{ strength_reference: string; dimension: string; confidence: Confidence; evidence: Evidence[]; explanation: string }>;
  major_weaknesses: Array<{ weakness_reference: string; dimension: string; category: "TECHNICAL_KNOWLEDGE" | "EXAM_TECHNIQUE"; severity: "MINOR" | "MODERATE" | "MAJOR"; confidence: Confidence; evidence: Evidence[]; explanation: string }>;
  dimension_assessments: Array<{ dimension: string; applicability: "APPLICABLE"; assessment: "WEAK" | "MIXED" | "GOOD" | "STRONG"; confidence: Confidence; evidence: Evidence[]; rationale: string }>;
  priority_improvement_areas: Array<{ priority: number; weakness_reference: string; dimension: string; reason: string; practice_action: string | null; success_check: string | null }>;
  skill_recommendations: Array<{ recommendation_type: "SKILL_RECOMMENDATION"; rank: number; skill: string; dimension: string; confidence: Confidence; practice_action: string | null; success_check: string | null }>;
  uncertainty_notices: string[];
  disclaimer: string;
};

export type BetaBackendPayload = {
  contract_version: "beta-backend-v0.2.0";
  analysis_reference: string;
  paper: Paper;
  human_review_required: true;
  release_status: "HUMAN_REVIEW_REQUIRED" | "WITHHELD_UNSUPPORTED_PAPER";
  withholding_reasons: string[];
  student_view: StudentView | null;
};

export type AnalyseInput = {
  paper: Paper;
  questionLabel: string;
  scenarioText: string;
  requirementText: string;
  permittedMarkingContext?: string;
  marksAvailable?: number;
  answerText: string;
  questionSourceType: "PASTED_TEXT" | "TEXT_FILE" | "PDF_TEXT" | "IMAGE_OCR" | "MIXED_INPUT";
  answerSourceType: "PASTED_TEXT" | "TEXT_FILE" | "PDF_TEXT" | "IMAGE_OCR";
  consent: SubmissionConsent;
};

export type SubmissionConsent = {
  privacyNoticeVersion: "pilot-consent-v0.1.0";
  experimentalAiAnalysis: true;
  humanReview: true;
  consentedAt: string;
};

export type NormalisedEvidence = {
  evidenceVersion: "attempt-evidence-demo-v0.1.0";
  dimensions: Array<{ dimension: string; category: "TECHNICAL_KNOWLEDGE" | "EXAM_TECHNIQUE"; signal: "STRENGTH" | "WEAKNESS"; severity?: "MINOR" | "MODERATE" | "MAJOR"; confidence: Confidence }>;
  uncertainty: string[];
};

export type AnalysisPackage = {
  studentPayload: BetaBackendPayload;
  internal: { provider: "MOCK_FIXTURE"; fixture: true; rawDiagnostic: Record<string, unknown>; normalisedEvidence: NormalisedEvidence };
};

export type AttemptSummary = {
  id: string; userId: string; paper: Paper; questionLabel: string; createdAt: string;
  reviewStatus: "PENDING" | "APPROVED" | "FLAGGED" | "REJECTED";
  releaseStatus: "HELD" | "RELEASED" | "REJECTED";
  provider: string; fixture: boolean; diagnosticConfidence: Confidence;
  studentPayload: BetaBackendPayload; rawDiagnostic?: Record<string, unknown>; normalisedEvidence?: NormalisedEvidence;
};

export type StudentAttemptSummary = {
  id: string;
  paper: Paper;
  questionLabel: string;
  createdAt: string;
  reviewStatus: "PENDING" | "APPROVED" | "FLAGGED" | "REJECTED";
  releaseStatus: "HELD" | "RELEASED" | "REJECTED";
  diagnosticConfidence: Confidence;
  studentPayload: BetaBackendPayload | null;
};

export type ReviewAttempt = {
  id: string;
  paper: Paper;
  questionLabel: string;
  createdAt: string;
  reviewStatus: "PENDING" | "APPROVED" | "FLAGGED" | "REJECTED";
  releaseStatus: "HELD" | "RELEASED" | "REJECTED";
  analysisStatus: "AWAITING_DIAGNOSTIC" | "COMPLETED" | "FAILED";
  provider: string;
  fixture: boolean;
  diagnosticConfidence: Confidence;
  submission: {
    scenarioText: string;
    requirementText: string;
    permittedMarkingContext: string | null;
    marksAvailable: number | null;
    answerText: string;
  };
  studentPayload: BetaBackendPayload | null;
  rawDiagnostic: Record<string, unknown> | null;
  normalisedEvidence: Record<string, unknown> | null;
  pipelineResult: Record<string, unknown> | null;
  imported: boolean;
};

export type ManualDiagnosticPacket = {
  packet_version: "manual-diagnostic-packet-v0.1.0";
  analysis_context: {
    analysis_id: string;
    case_id: string;
    paper: Paper;
    question_label: string;
    marks_available: number;
    prompt_version: "manual-codex-v0.1.0";
    taxonomy_version: "diagnostic-taxonomy-v0.2";
    paper_rules_version: "afm-rules-v0.2.0" | "sbr-rules-v0.2.0";
  };
  submission: {
    scenario_text: string;
    requirement_text: string;
    permitted_marking_context: string | null;
    student_answer: string;
  };
  permitted_context: Record<string, unknown>;
  diagnostic_instructions: string;
};

export type SafePerformanceProfile = {
  userId: string; attemptCount: number; ready: boolean; message: string;
  recurringAreas: Array<{ dimension: string; category: string; summary: string; evidenceCount: number }>;
  improvingAreas: Array<{ dimension: string; category: string; summary: string; evidenceCount: number }>;
  consistentStrengths: Array<{ dimension: string; summary: string; evidenceCount: number }>;
};
