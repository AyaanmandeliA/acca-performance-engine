import type { AttemptSummary, NormalisedEvidence, SafePerformanceProfile } from "./domain";

const severityRank = { MINOR: 1, MODERATE: 2, MAJOR: 3 } as const;
const readable = (value: string) => value.replaceAll("_", " ").toLowerCase();

export function buildSafePerformanceProfile(userId: string, attempts: AttemptSummary[]): SafePerformanceProfile {
  const released = attempts.filter((item) => item.releaseStatus === "RELEASED" && item.normalisedEvidence).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (released.length < 2) return { userId, attemptCount: released.length, ready: false, message: "Complete more practice analyses to start identifying patterns in your performance.", recurringAreas: [], improvingAreas: [], consistentStrengths: [] };

  const weaknessGroups = new Map<string, Array<{ attempt: string; rank: number; category: string }>>();
  const strengthGroups = new Map<string, Set<string>>();
  for (const attempt of released) {
    const evidence = attempt.normalisedEvidence as NormalisedEvidence & {
      weaknesses?: Array<{ canonical_dimension: string; severity: "MINOR" | "MODERATE" | "MAJOR"; weakness_class: string }>;
      strength_evidence?: Array<{ canonical_dimension: string }>;
    };
    const signals = evidence.dimensions ?? [
      ...(evidence.strength_evidence ?? []).map((item) => ({ dimension: item.canonical_dimension, category: "TECHNICAL_KNOWLEDGE", signal: "STRENGTH" as const, confidence: "MEDIUM" as const })),
      ...(evidence.weaknesses ?? []).map((item) => ({ dimension: item.canonical_dimension, category: item.weakness_class, signal: "WEAKNESS" as const, severity: item.severity, confidence: "MEDIUM" as const })),
    ];
    for (const signal of signals) {
      if (signal.signal === "WEAKNESS" && signal.severity) {
        const values = weaknessGroups.get(signal.dimension) ?? [];
        values.push({ attempt: attempt.id, rank: severityRank[signal.severity], category: signal.category });
        weaknessGroups.set(signal.dimension, values);
      } else if (signal.signal === "STRENGTH") {
        const ids = strengthGroups.get(signal.dimension) ?? new Set<string>(); ids.add(attempt.id); strengthGroups.set(signal.dimension, ids);
      }
    }
  }
  const improvingAreas: SafePerformanceProfile["improvingAreas"] = [];
  const recurringAreas: SafePerformanceProfile["recurringAreas"] = [];
  for (const [dimension, signals] of weaknessGroups) {
    const distinct = new Set(signals.map((item) => item.attempt)).size;
    if (distinct < 2) continue;
    const lastThree = signals.slice(-3);
    const improving = lastThree.length === 3 && lastThree[0].rank > lastThree[1].rank && lastThree[1].rank > lastThree[2].rank;
    const item = { dimension, category: signals.at(-1)!.category, evidenceCount: distinct };
    if (improving) improvingAreas.push({ ...item, summary: `${readable(dimension)} is becoming more effective across your recent attempts.` });
    else recurringAreas.push({ ...item, summary: `${readable(dimension)} has affected more than one reviewed attempt and remains worth focused practice.` });
  }
  const consistentStrengths = [...strengthGroups].filter(([, ids]) => ids.size >= 2).map(([dimension, ids]) => ({ dimension, evidenceCount: ids.size, summary: `${readable(dimension)} has been a consistent strength across reviewed attempts.` }));
  return { userId, attemptCount: released.length, ready: true, message: "Patterns are based only on repeated, reviewed attempt evidence.", recurringAreas, improvingAreas, consistentStrengths };
}
