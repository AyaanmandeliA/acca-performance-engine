type RuntimeConfig = Record<string, string | undefined>;

export type PilotReadiness = {
  pilotEnabled: boolean;
  canAcceptRealSubmissions: boolean;
  mode: "SYNTHETIC_ONLY" | "REAL_PILOT";
  blockers: string[];
};

const ids = (value?: string) => new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));

export function getPilotReadiness(config: RuntimeConfig = process.env): PilotReadiness {
  const blockers: string[] = [];
  if (config.BETA_REAL_PILOT_ENABLED !== "true") blockers.push("The real-submission kill switch is off.");
  if (config.BETA_PRIVATE_DEPLOYMENT_VERIFIED !== "true") blockers.push("A private, authenticated deployment has not been verified.");
  if (config.BETA_PRIVATE_STORAGE_VERIFIED !== "true") blockers.push("Private submission storage outside any file-sync folder has not been verified.");
  if (config.BETA_AUTHENTICATION_VERIFIED !== "true") blockers.push("Student authentication and ownership isolation have not been verified in the target environment.");
  const reviewers = ids(config.BETA_REVIEWER_IDS);
  const students = ids(config.BETA_STUDENT_IDS);
  if (reviewers.size !== 1) blockers.push("The server-side reviewer allowlist must contain exactly one identity.");
  if (students.size < 1) blockers.push("The student allowlist must contain at least one verified identity.");
  if (students.size > 5) blockers.push("The student allowlist cannot exceed five active identities.");
  if ([...reviewers].some((reviewer) => students.has(reviewer))) blockers.push("Reviewer and student identities must not overlap.");
  if (config.BETA_WORKER_PIPELINE_VERIFIED !== "true") blockers.push("Worker/Python manual-pipeline equivalence has not been verified in the target release.");
  const canAcceptRealSubmissions = blockers.length === 0;
  return {
    pilotEnabled: config.BETA_REAL_PILOT_ENABLED === "true",
    canAcceptRealSubmissions,
    mode: canAcceptRealSubmissions ? "REAL_PILOT" : "SYNTHETIC_ONLY",
    blockers,
  };
}

export function requireRealPilotReady(config: RuntimeConfig = process.env): void {
  const readiness = getPilotReadiness(config);
  if (!readiness.canAcceptRealSubmissions) throw new Error(`Real pilot is disabled: ${readiness.blockers.join(" ")}`);
}
