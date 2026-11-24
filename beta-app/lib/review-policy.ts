export type ReviewMode = "ALL" | "SAMPLE" | "OFF";

export function getReviewMode(value = process.env.BETA_REVIEW_MODE): ReviewMode {
  if (!value) return "ALL";
  if (value === "ALL" || value === "SAMPLE" || value === "OFF") return value;
  throw new Error("BETA_REVIEW_MODE must be ALL, SAMPLE or OFF.");
}

function stableBucket(reference: string) {
  let value = 0;
  for (const character of reference) value = (value * 31 + character.charCodeAt(0)) % 100;
  return value;
}

export function shouldQueueForReview(reference: string, contractRequiresReview: boolean, mode = getReviewMode()) {
  // The frozen beta contract always wins. SAMPLE/OFF only become active after a
  // future reviewed contract version explicitly permits unreviewed release.
  if (contractRequiresReview) return true;
  if (mode === "ALL") return true;
  if (mode === "OFF") return false;
  return stableBucket(reference) < 25;
}
