import type { ReviewDecision } from "./domain";

export function reviewTransition(decision: ReviewDecision) {
  if (decision === "APPROVE") return { reviewStatus: "APPROVED" as const, releaseStatus: "RELEASED" as const };
  if (decision === "FLAG") return { reviewStatus: "FLAGGED" as const, releaseStatus: "HELD" as const };
  return { reviewStatus: "REJECTED" as const, releaseStatus: "REJECTED" as const };
}
