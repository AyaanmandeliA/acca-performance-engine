import type { AnalyseInput, Paper } from "./domain";

type RuntimeConfig = Record<string, string | undefined>;

const MAX_WINDOW_MS = 4 * 60 * 60 * 1000;
export const LIVE_VERIFICATION_LABEL_PREFIX = "Live identity verification — ";

const ids = (value?: string) => [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
const sameMembers = (left: string[], right: string[]) => left.length === right.length && left.every((item) => right.includes(item));

export type LiveAuthVerification = {
  active: boolean;
  blockers: string[];
  expiresAt: string | null;
  studentIds: string[];
};

export class LiveAuthVerificationError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
    this.name = "LiveAuthVerificationError";
  }
}

export function getLiveAuthVerification(config: RuntimeConfig = process.env, now = new Date()): LiveAuthVerification {
  const blockers: string[] = [];
  const students = ids(config.BETA_STUDENT_IDS);
  const verificationStudents = ids(config.BETA_VERIFICATION_STUDENT_IDS);
  const reviewers = ids(config.BETA_REVIEWER_IDS);
  const startedAt = config.BETA_LIVE_AUTH_VERIFICATION_STARTED_AT ? new Date(config.BETA_LIVE_AUTH_VERIFICATION_STARTED_AT) : null;
  const expiresAt = config.BETA_LIVE_AUTH_VERIFICATION_EXPIRES_AT ? new Date(config.BETA_LIVE_AUTH_VERIFICATION_EXPIRES_AT) : null;

  if (config.BETA_LIVE_AUTH_VERIFICATION_ENABLED !== "true") blockers.push("The live-auth verification switch is off.");
  if (config.BETA_REAL_PILOT_ENABLED !== "false") blockers.push("The real-pilot switch must remain off during verification.");
  if (config.BETA_AUTHENTICATION_VERIFIED !== "false") blockers.push("Authentication verification must remain false until this workflow succeeds.");
  if (config.BETA_PRIVATE_DEPLOYMENT_VERIFIED !== "true" || config.BETA_PRIVATE_STORAGE_VERIFIED !== "true") blockers.push("Private deployment and storage must already be verified.");
  if (config.BETA_WORKER_PIPELINE_VERIFIED !== "true") blockers.push("The Worker diagnostic pipeline must already be verified.");
  if (reviewers.length !== 1) blockers.push("Exactly one reviewer identity is required.");
  if (students.length !== 2 || verificationStudents.length !== 2 || !sameMembers(students, verificationStudents)) blockers.push("Exactly two matching student and verification identities are required.");
  if (reviewers.some((reviewer) => verificationStudents.includes(reviewer))) blockers.push("Reviewer and verification-student identities must not overlap.");

  const validTimes = startedAt && expiresAt && !Number.isNaN(startedAt.getTime()) && !Number.isNaN(expiresAt.getTime());
  if (!validTimes) {
    blockers.push("A valid verification start and expiry are required.");
  } else {
    const duration = expiresAt.getTime() - startedAt.getTime();
    if (duration <= 0 || duration > MAX_WINDOW_MS) blockers.push("The verification window must be greater than zero and no longer than four hours.");
    if (now.getTime() < startedAt.getTime() || now.getTime() >= expiresAt.getTime()) blockers.push("The verification window is not currently active.");
  }

  return {
    active: blockers.length === 0,
    blockers,
    expiresAt: validTimes ? expiresAt.toISOString() : null,
    studentIds: verificationStudents,
  };
}

export function isLiveAuthVerificationStudent(userId: string, config: RuntimeConfig = process.env, now = new Date()): boolean {
  const verification = getLiveAuthVerification(config, now);
  return verification.active && verification.studentIds.includes(userId);
}

export function requireLiveAuthVerificationStudent(userId: string, config: RuntimeConfig = process.env, now = new Date()): LiveAuthVerification {
  const verification = getLiveAuthVerification(config, now);
  if (!verification.active) throw new LiveAuthVerificationError(`Live authentication verification is unavailable: ${verification.blockers.join(" ")}`);
  if (!verification.studentIds.includes(userId)) throw new LiveAuthVerificationError("This identity is not authorised for live authentication verification.");
  return verification;
}

export function isLiveVerificationLabel(label: string): boolean {
  return label.startsWith(LIVE_VERIFICATION_LABEL_PREFIX);
}

export async function liveVerificationAttemptId(userId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`acca-live-auth-verification:${userId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `live-verification-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

export function makeLiveVerificationInput(userId: string, consentedAt: string, config: RuntimeConfig = process.env): AnalyseInput {
  const verification = getLiveAuthVerification(config, new Date(consentedAt));
  if (!verification.active || !verification.studentIds.includes(userId)) throw new LiveAuthVerificationError("Live authentication verification is unavailable for this identity.");
  const paper: Paper = verification.studentIds.indexOf(userId) === 0 ? "AFM" : "SBR";
  const afm = paper === "AFM";
  return {
    paper,
    questionLabel: `${LIVE_VERIFICATION_LABEL_PREFIX}${paper}`,
    scenarioText: afm
      ? "Synthetic Example Ltd is considering a fictional investment. The supplied test figures indicate a positive net present value, but demand and exchange-rate assumptions remain uncertain. No real company, exam response or student information is used."
      : "Synthetic Example Group acquired a fictional subsidiary during the year. The supplied test facts require the accounting treatment and its effect on the financial statements to be explained. No real company, exam response or student information is used.",
    requirementText: afm
      ? "Evaluate the fictional investment and recommend whether it should proceed, including relevant uncertainty."
      : "Explain the appropriate fictional reporting treatment and apply it to the supplied synthetic facts.",
    permittedMarkingContext: "Verification-only synthetic context. Assess clear method, application, explanation and justified conclusion. Do not infer any official ACCA mark or unsupported rule.",
    marksAvailable: 20,
    answerText: afm
      ? "The synthetic calculation gives a positive net present value, which supports proceeding in principle. However, the result depends on demand and exchange-rate assumptions. Management should test those variables, consider the downside case and proceed only if the project remains acceptable under a reasonable adverse scenario."
      : "The synthetic acquisition should be reflected from the fictional control date. The identifiable assets and liabilities should be considered using the supplied facts, with the resulting effect explained in the group statements. The answer should also disclose uncertainty where the test information does not support a definitive treatment.",
    questionSourceType: "PASTED_TEXT",
    answerSourceType: "PASTED_TEXT",
    consent: {
      privacyNoticeVersion: "pilot-consent-v0.1.0",
      experimentalAiAnalysis: true,
      humanReview: true,
      consentedAt,
    },
  };
}
