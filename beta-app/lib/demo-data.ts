import type { AnalyseInput, AnalysisPackage, Confidence } from "./domain";
import { MockFixtureDiagnosticProvider } from "./diagnostic-provider";

export type DemoAttemptRecord = { id: string; userId: string; questionLabel: string; createdAt: string; input: AnalyseInput; analysis: AnalysisPackage };

function syntheticInput(paper: "AFM" | "SBR", questionLabel: string, answer: string): AnalyseInput {
  return {
    paper, questionLabel,
    scenarioText: paper === "AFM" ? "A fictional company is comparing two investment choices under uncertain cash flows." : "A fictional group is assessing the reporting effect of a newly negotiated arrangement.",
    requirementText: paper === "AFM" ? "Evaluate the choices and recommend a course of action." : "Explain the appropriate reporting treatment and apply it to the scenario.",
    marksAvailable: 20, answerText: answer, questionSourceType: "PASTED_TEXT", answerSourceType: "PASTED_TEXT",
    consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: "2026-09-01T00:00:00Z" },
  };
}

export function makeManualDemoInput(): AnalyseInput {
  return {
    ...syntheticInput(
      "AFM",
      "Synthetic AFM manual review",
      "The investment produces a positive base-case value using the supplied cash flows. I would accept it because the result is positive. The downside case is lower, so management should consider risk before deciding.",
    ),
    permittedMarkingContext: "Synthetic context only: assess the visible calculation conclusion, interpretation of the result, treatment of uncertainty and support for the recommendation. Do not infer any official marking guide.",
  };
}

function narrowPackage(analysis: AnalysisPackage, dimension: string, severity: "MINOR" | "MODERATE" | "MAJOR", confidence: Confidence) {
  const view = analysis.studentPayload.student_view!;
  const weakness = view.major_weaknesses.find((item) => item.dimension === dimension)!;
  weakness.severity = severity; weakness.confidence = confidence;
  view.major_weaknesses = [weakness];
  view.priority_improvement_areas = view.priority_improvement_areas.filter((item) => item.dimension === dimension).slice(0, 1);
  view.skill_recommendations = view.skill_recommendations.filter((item) => item.dimension === dimension).slice(0, 1);
  analysis.internal.normalisedEvidence.dimensions = analysis.internal.normalisedEvidence.dimensions
    .filter((item) => item.signal === "STRENGTH" || item.dimension === dimension)
    .map((item) => item.dimension === dimension ? { ...item, severity, confidence } : item);
  return analysis;
}

export async function makeDemoAttempts(): Promise<DemoAttemptRecord[]> {
  const provider = new MockFixtureDiagnosticProvider();
  const afmAnswers = [
    "The project result is positive. The workings compare the two choices using the supplied cash flows and discount factors. Option A produces the larger value, so it should be selected.",
    "The calculated value is positive and supports acceptance. This would increase shareholder value, although the recommendation is sensitive to the cash-flow assumption and financing constraint.",
    "The positive value supports acceptance because it adds value under the base case. The downside scenario remains acceptable, but management should test the key volume assumption before committing and retain the alternative if financing headroom tightens.",
  ];
  const records: DemoAttemptRecord[] = [];
  for (const [index, severity] of (["MAJOR", "MODERATE", "MINOR"] as const).entries()) {
    const input = syntheticInput("AFM", `Synthetic AFM practice ${index + 1}`, afmAnswers[index]);
    const analysis = narrowPackage(await provider.analyse(input), "QUANTITATIVE_INTERPRETATION", severity, index === 0 ? "MEDIUM" : "HIGH");
    records.push({ id: `demo-a-afm-${index + 1}`, userId: "student-a", questionLabel: input.questionLabel, createdAt: `2026-09-${String(20 + index * 5).padStart(2, "0")}T10:00:00Z`, input, analysis });
  }
  const sbrAnswers = [
    "The arrangement meets the definition of a reporting obligation and should be recognised. The relevant technical principle is identified and the entry should reflect the present obligation.",
    "The standard requires recognition when the obligation exists. The scenario contains an agreement and a probable outflow, so the item should be recognised and measured using the best estimate available.",
  ];
  for (const [index, answer] of sbrAnswers.entries()) {
    const input = syntheticInput("SBR", `Synthetic SBR practice ${index + 1}`, answer);
    const analysis = narrowPackage(await provider.analyse(input), "SCENARIO_APPLICATION", "MODERATE", "HIGH");
    records.push({ id: `demo-b-sbr-${index + 1}`, userId: "student-b", questionLabel: input.questionLabel, createdAt: `2026-09-${String(22 + index * 7).padStart(2, "0")}T11:00:00Z`, input, analysis });
  }
  return records;
}
