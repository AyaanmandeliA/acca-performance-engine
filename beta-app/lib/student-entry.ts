import { isReviewerIdentity, isStudentIdentity } from "./access-control";
import { isLiveAuthVerificationStudent } from "./live-auth-verification";
import { getPilotReadiness } from "./pilot-readiness";

type RuntimeConfig = Record<string, string | undefined>;

export type StudentEntryState = "REVIEWER" | "VERIFICATION_STUDENT" | "ACTIVE_STUDENT" | "WAITING_STUDENT" | "CANDIDATE";

export function resolveStudentEntry(userId: string, config: RuntimeConfig = process.env, now = new Date()): StudentEntryState {
  if (isReviewerIdentity(userId, config)) return "REVIEWER";
  if (!isStudentIdentity(userId, config)) return "CANDIDATE";
  if (isLiveAuthVerificationStudent(userId, config, now)) return "VERIFICATION_STUDENT";
  return getPilotReadiness(config).canAcceptRealSubmissions ? "ACTIVE_STUDENT" : "WAITING_STUDENT";
}
