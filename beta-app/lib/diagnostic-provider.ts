import { parseBetaBackendPayload } from "./beta-contract";
import type { AnalyseInput, AnalysisPackage, BetaBackendPayload, Confidence, NormalisedEvidence } from "./domain";

export interface DiagnosticProvider {
  readonly id: string;
  readonly fixture: boolean;
  analyse(input: AnalyseInput): Promise<AnalysisPackage>;
}

const label = (value: string) => value.replaceAll("_", " ").toLowerCase();
const excerpt = (answer: string) => answer.trim().replace(/\s+/g, " ").slice(0, 150) || "No usable answer excerpt supplied.";

function studentPayload(input: AnalyseInput, confidence: Confidence, reference: string): BetaBackendPayload {
  const sourceExcerpt = excerpt(input.answerText);
  const common = {
    contract_version: "beta-backend-v0.2.0" as const,
    analysis_reference: reference,
    paper: input.paper,
    human_review_required: true as const,
    release_status: "HUMAN_REVIEW_REQUIRED" as const,
    withholding_reasons: [],
  };
  if (input.paper === "AFM") {
    return {
      ...common,
      student_view: {
        diagnostic_summary: "Your calculation method and answer structure are sound, but the response does not yet turn its results into a well-supported decision. Focus next on interpretation and evaluation.",
        major_strengths: [
          { strength_reference: "strength-method", dimension: "QUANTITATIVE_ACCURACY", confidence, evidence: [{ answer_location: "Visible workings", excerpt: sourceExcerpt }], explanation: "The response sets out a traceable calculation approach and reaches a decision-relevant result." },
          { strength_reference: "strength-structure", dimension: "REQUIREMENT_INTERPRETATION", confidence, evidence: [{ answer_location: "Answer structure", excerpt: sourceExcerpt }], explanation: "The response addresses the main requirement in a recognisable order." },
        ],
        major_weaknesses: [
          { weakness_reference: "weakness-interpretation", dimension: "QUANTITATIVE_INTERPRETATION", category: "EXAM_TECHNIQUE", severity: "MODERATE", confidence, evidence: [{ answer_location: "After the main calculation", excerpt: sourceExcerpt }], explanation: "The numerical result is not fully translated into a scenario-specific decision implication." },
          { weakness_reference: "weakness-evaluation", dimension: "EVALUATION_JUDGEMENT", category: "EXAM_TECHNIQUE", severity: "MODERATE", confidence, evidence: [{ answer_location: "Recommendation", excerpt: sourceExcerpt }], explanation: "The recommendation would be stronger if it weighed the result against risk, assumptions and constraints." },
        ],
        dimension_assessments: [
          { dimension: "QUANTITATIVE_ACCURACY", applicability: "APPLICABLE", assessment: "GOOD", confidence, evidence: [{ answer_location: "Visible workings", excerpt: sourceExcerpt }], rationale: "A coherent calculation method is visible." },
          { dimension: "QUANTITATIVE_INTERPRETATION", applicability: "APPLICABLE", assessment: "MIXED", confidence, evidence: [{ answer_location: "Discussion following calculation", excerpt: sourceExcerpt }], rationale: "The result is stated, but its decision meaning needs more development." },
          { dimension: "EVALUATION_JUDGEMENT", applicability: "APPLICABLE", assessment: "MIXED", confidence, evidence: [], rationale: "A position is reached without fully weighing the material criteria." },
        ],
        priority_improvement_areas: [
          { priority: 1, weakness_reference: "weakness-interpretation", dimension: "QUANTITATIVE_INTERPRETATION", reason: "Interpretation is the clearest route from a correct result to a more effective answer.", practice_action: "After each calculation, add one sentence explaining the result, its scenario effect and the decision it supports.", success_check: "Every material result is followed by a scenario-specific implication." },
          { priority: 2, weakness_reference: "weakness-evaluation", dimension: "EVALUATION_JUDGEMENT", reason: "The recommendation needs explicit decision criteria.", practice_action: "Compare the leading option against risk, assumptions and one practical constraint before concluding.", success_check: "The recommendation cites at least two material criteria and one limitation." },
        ],
        skill_recommendations: [
          { recommendation_type: "SKILL_RECOMMENDATION", rank: 1, skill: "Interpreting calculation results", dimension: "QUANTITATIVE_INTERPRETATION", confidence, practice_action: "Write a result → implication → decision sentence after each major calculation.", success_check: "A reader can see why the number changes the decision." },
          { recommendation_type: "SKILL_RECOMMENDATION", rank: 2, skill: "Evaluating against decision criteria", dimension: "EVALUATION_JUDGEMENT", confidence, practice_action: "Weigh return, risk and constraints before choosing an option.", success_check: "The final choice follows from the criteria discussed." },
        ],
        uncertainty_notices: confidence === "LOW" ? ["The answer is short, so some dimensions could not be assessed confidently."] : [],
        disclaimer: "Diagnostic feedback only; this is not an official ACCA mark.",
      },
    };
  }
  return {
    ...common,
    student_view: {
      diagnostic_summary: "You identify relevant reporting principles and the main issue, but the answer needs tighter links between scenario facts and reporting consequences. Focus next on application and developed explanation.",
      major_strengths: [
        { strength_reference: "strength-knowledge", dimension: "TECHNICAL_KNOWLEDGE", confidence, evidence: [{ answer_location: "Technical discussion", excerpt: sourceExcerpt }], explanation: "The response identifies relevant reporting principles and uses broadly appropriate terminology." },
        { strength_reference: "strength-requirement", dimension: "REQUIREMENT_INTERPRETATION", confidence, evidence: [{ answer_location: "Response structure", excerpt: sourceExcerpt }], explanation: "The response recognises the main reporting issue requested." },
      ],
      major_weaknesses: [
        { weakness_reference: "weakness-application", dimension: "SCENARIO_APPLICATION", category: "EXAM_TECHNIQUE", severity: "MODERATE", confidence, evidence: [{ answer_location: "Technical discussion", excerpt: sourceExcerpt }], explanation: "The technical point is not consistently connected to the specific facts and consequences in the scenario." },
        { weakness_reference: "weakness-development", dimension: "ANALYSIS_DEVELOPMENT", category: "EXAM_TECHNIQUE", severity: "MODERATE", confidence, evidence: [{ answer_location: "Explanation", excerpt: sourceExcerpt }], explanation: "Several correct points stop before explaining the accounting or stakeholder consequence." },
      ],
      dimension_assessments: [
        { dimension: "TECHNICAL_KNOWLEDGE", applicability: "APPLICABLE", assessment: "GOOD", confidence, evidence: [{ answer_location: "Technical discussion", excerpt: sourceExcerpt }], rationale: "Relevant technical principles are identified." },
        { dimension: "SCENARIO_APPLICATION", applicability: "APPLICABLE", assessment: "MIXED", confidence, evidence: [{ answer_location: "Scenario references", excerpt: sourceExcerpt }], rationale: "Some facts are mentioned, but their significance is not consistently developed." },
        { dimension: "ANALYSIS_DEVELOPMENT", applicability: "APPLICABLE", assessment: "MIXED", confidence, evidence: [], rationale: "Reasoning often ends before the consequence is made explicit." },
      ],
      priority_improvement_areas: [
        { priority: 1, weakness_reference: "weakness-application", dimension: "SCENARIO_APPLICATION", reason: "Applying the correct rule to the facts is the main improvement opportunity.", practice_action: "For each technical point, cite a scenario fact and explain why it changes the treatment or conclusion.", success_check: "Every technical paragraph contains a fact → rule → consequence chain." },
        { priority: 2, weakness_reference: "weakness-development", dimension: "ANALYSIS_DEVELOPMENT", reason: "Developed consequences make technical knowledge useful to the requirement.", practice_action: "Finish each point with the reporting, financial statement or stakeholder consequence.", success_check: "No material point ends as an unsupported label or rule statement." },
      ],
      skill_recommendations: [
        { recommendation_type: "SKILL_RECOMMENDATION", rank: 1, skill: "Applying technical rules to scenario facts", dimension: "SCENARIO_APPLICATION", confidence, practice_action: "Use a fact → rule → consequence structure for every material issue.", success_check: "The scenario fact and its accounting effect are explicit." },
        { recommendation_type: "SKILL_RECOMMENDATION", rank: 2, skill: "Developing accounting consequences", dimension: "ANALYSIS_DEVELOPMENT", confidence, practice_action: "Explain what changes in recognition, measurement or presentation.", success_check: "Each point reaches a clear reporting consequence." },
      ],
      uncertainty_notices: confidence === "LOW" ? ["The answer is short, so the breadth of technical coverage is uncertain."] : [],
      disclaimer: "Diagnostic feedback only; this is not an official ACCA mark.",
    },
  };
}

export class MockFixtureDiagnosticProvider implements DiagnosticProvider {
  readonly id = "MOCK_FIXTURE";
  readonly fixture = true;
  async analyse(input: AnalyseInput): Promise<AnalysisPackage> {
    if (input.paper !== "AFM" && input.paper !== "SBR") throw new Error("Unsupported paper");
    if (input.scenarioText.trim().length < 20 || input.requirementText.trim().length < 8 || input.answerText.trim().length < 20) throw new Error("Question, requirement and answer need enough readable text for a diagnostic.");
    const confidence: Confidence = input.answerText.trim().length < 220 ? "LOW" : input.answerText.trim().length < 500 ? "MEDIUM" : "HIGH";
    const reference = `fixture-${input.paper.toLowerCase()}-${crypto.randomUUID()}`;
    const payload = parseBetaBackendPayload(studentPayload(input, confidence, reference));
    const view = payload.student_view!;
    const normalisedEvidence: NormalisedEvidence = {
      evidenceVersion: "attempt-evidence-demo-v0.1.0",
      dimensions: [
        ...view.major_strengths.map((item) => ({ dimension: item.dimension, category: "TECHNICAL_KNOWLEDGE" as const, signal: "STRENGTH" as const, confidence: item.confidence })),
        ...view.major_weaknesses.map((item) => ({ dimension: item.dimension, category: item.category, signal: "WEAKNESS" as const, severity: item.severity, confidence: item.confidence })),
      ],
      uncertainty: [...view.uncertainty_notices],
    };
    return {
      studentPayload: payload,
      internal: {
        provider: "MOCK_FIXTURE",
        fixture: true,
        rawDiagnostic: { fixture_notice: "Development fixture — not a live AI diagnosis", paper: input.paper, analysis_id: reference, weakness_tags: view.major_weaknesses.map((item) => `INTERNAL_${item.dimension}`), diagnostic_confidence: confidence },
        normalisedEvidence,
      },
    };
  }
}

export function getDiagnosticProvider(): DiagnosticProvider {
  const configured = process.env.DIAGNOSTIC_PROVIDER ?? "MOCK_FIXTURE";
  if (configured !== "MOCK_FIXTURE") throw new Error("No live diagnostic provider is connected.");
  if (process.env.NODE_ENV === "production") throw new Error("Mock fixture diagnostics are disabled in production.");
  return new MockFixtureDiagnosticProvider();
}

export function readableDimension(dimension: string) { return label(dimension).replace(/\b\w/g, (letter) => letter.toUpperCase()); }
