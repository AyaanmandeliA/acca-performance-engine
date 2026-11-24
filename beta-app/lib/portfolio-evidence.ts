export type PortfolioChange = {
  date: string;
  source: string;
  problem: string;
  change: string;
  status: "SHIPPED" | "PLANNED";
};

export type UsabilityTheme = { theme: string; count: number };

export type PortfolioAnalytics = {
  studentsInvited: number;
  studentsEnrolled: number;
  firstSubmissions: number;
  completedDiagnostics: number;
  studentsReturningForSecondAttempt: number;
  feedbackResponses: number;
  reportedUsefulResponses: number;
  usabilityIssueReports: number;
  usabilityThemes: UsabilityTheme[];
  changesFollowingFeedback: PortfolioChange[];
  usefulness: { yes: number; partly: number; no: number };
};

export const CHANGES_FOLLOWING_FEEDBACK: PortfolioChange[] = [
  {
    date: "2026-10-08",
    source: "Owner usability feedback",
    problem: "Students are more likely to submit PDFs or screenshots than plain-text files.",
    change: "Prioritised PDF and screenshot input, kept extraction on-device, and added editable confirmation before submission.",
    status: "SHIPPED",
  },
];

const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: "Upload or text extraction", pattern: /\b(?:pdf|upload|ocr|image|screenshot|scan|extract|file)\b/i },
  { theme: "Instructions or navigation", pattern: /\b(?:confus|unclear|instruction|navigation|find|step|screen|button)\w*/i },
  { theme: "Diagnostic clarity", pattern: /\b(?:feedback|diagnostic|explanation|weakness|strength|guidance|understand|accurate)\w*/i },
  { theme: "Waiting time", pattern: /\b(?:slow|wait|delay|instant|long|time|day|hour)\w*/i },
  { theme: "Mobile experience", pattern: /\b(?:mobile|phone|tap|small screen)\b/i },
];

export function summariseUsabilityThemes(items: Array<{ confusingText: string }>): { reports: number; themes: UsabilityTheme[] } {
  const reports = items.map((item) => item.confusingText.trim()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const report of reports) {
    const matched = THEME_RULES.filter((rule) => rule.pattern.test(report)).map((rule) => rule.theme);
    for (const theme of matched.length ? matched : ["Other reported issue"]) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  return {
    reports: reports.length,
    themes: [...counts].map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme)),
  };
}

export function buildPortfolioCaseStudy(analytics: PortfolioAnalytics, generatedAt = new Date().toISOString()): string {
  const feedbackTotal = analytics.usefulness.yes + analytics.usefulness.partly + analytics.usefulness.no;
  const usefulRate = feedbackTotal ? `${Math.round(analytics.reportedUsefulResponses / feedbackTotal * 100)}%` : "No responses yet";
  const usability = analytics.usabilityThemes.length
    ? analytics.usabilityThemes.map((item) => `- ${item.theme}: ${item.count}`).join("\n")
    : "- No usability problems have been reported yet.";
  const changes = analytics.changesFollowingFeedback.length
    ? analytics.changesFollowingFeedback.map((item) => `- ${item.date} — ${item.change} (${item.source}; ${item.status.toLowerCase()})`).join("\n")
    : "- No feedback-led changes recorded yet.";

  return `# ACCA Performance Engine — private-beta evidence snapshot

Generated: ${generatedAt}

## Product and workflow

AFM/SBR diagnostic beta using private authenticated access, managed D1 storage and a supervised manual Codex workflow. Students submit reviewed text; an authorised reviewer exports an anonymised packet, imports schema-valid diagnostic JSON, reviews the student-safe result and releases it. No paid model API is connected.

## Aggregate evidence

- Students invited: ${analytics.studentsInvited}
- Students enrolled: ${analytics.studentsEnrolled}
- Students making a first submission: ${analytics.firstSubmissions}
- Completed diagnostics: ${analytics.completedDiagnostics}
- Students returning for a second attempt: ${analytics.studentsReturningForSecondAttempt}
- Feedback responses: ${analytics.feedbackResponses}
- Reported useful or partly useful: ${usefulRate}
- Usability problem reports: ${analytics.usabilityIssueReports}

## Common usability problems

${usability}

## Changes following feedback

${changes}

## Evidence boundary

These figures exclude synthetic fixture attempts. This export contains aggregate counts only: no student identities, emails, answers, diagnostic evidence or testimonial claims.
`;
}
