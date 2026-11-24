import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answerInputs, attempts, diagnosticExports, diagnosticImports, diagnosticResults, feedback, normalisedAttemptEvidence, performanceProfiles, pilotEnrolments, questionInputs, reviews, submissionConsents, users } from "@/db/schema";
import { parseBetaBackendPayload } from "./beta-contract";
import { makeDemoAttempts, makeManualDemoInput } from "./demo-data";
import { buildSafePerformanceProfile } from "./performance-profile";
import type { AnalyseInput, AnalysisPackage, AttemptSummary, BetaBackendPayload, ReviewAttempt, ReviewDecision, StudentAttemptSummary } from "./domain";
import type { PipelineBundle } from "./manual-pipeline-client";
import { reviewTransition } from "./review";
import { shouldQueueForReview } from "./review-policy";
import { getEnrolmentPolicy } from "./enrolment";
import { getPilotReadiness } from "./pilot-readiness";
import { CHANGES_FOLLOWING_FEEDBACK, summariseUsabilityThemes } from "./portfolio-evidence";
import { isLiveVerificationLabel } from "./live-auth-verification";

const parse = <T,>(value: string | null): T | undefined => value ? JSON.parse(value) as T : undefined;

function parseStoredStudentPayload(value: string | null, paper: string, fixture: boolean) {
  const stored = parse<Record<string, unknown>>(value);
  if (fixture && stored?.contract_version === "beta-backend-v0.1.0" && stored.student_view && typeof stored.student_view === "object") {
    const diagnosticSummary = paper === "AFM"
      ? "Your calculation method and answer structure are sound, but the response does not yet turn its results into a well-supported decision. Focus next on interpretation and evaluation."
      : "You identify relevant reporting principles and the main issue, but the answer needs tighter links between scenario facts and reporting consequences. Focus next on application and developed explanation.";
    return parseBetaBackendPayload({ ...stored, contract_version: "beta-backend-v0.2.0", student_view: { ...(stored.student_view as Record<string, unknown>), diagnostic_summary: diagnosticSummary } });
  }
  return parseBetaBackendPayload(stored);
}

export async function ensureDemoData() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seeding is disabled in production.");
  const db = getDb();
  await db.insert(users).values([
    { id: "student-a", displayName: "Student A", email: null, demo: true },
    { id: "student-b", displayName: "Student B", email: null, demo: true },
    { id: "local-student", displayName: "Local student", email: null, demo: true },
  ]).onConflictDoNothing();
  for (const record of await makeDemoAttempts()) {
    await db.insert(attempts).values({ id: record.id, userId: record.userId, paper: record.input.paper, questionLabel: record.questionLabel, provider: "MOCK_FIXTURE", fixture: true, reviewStatus: "APPROVED", releaseStatus: "RELEASED", diagnosticConfidence: record.analysis.studentPayload.student_view?.major_weaknesses[0]?.confidence ?? "MEDIUM", createdAt: record.createdAt }).onConflictDoNothing();
    await db.insert(questionInputs).values({ id: `q-${record.id}`, attemptId: record.id, scenarioText: record.input.scenarioText, requirementText: record.input.requirementText, markingContextText: record.input.permittedMarkingContext, marksAvailable: record.input.marksAvailable, sourceType: record.input.questionSourceType }).onConflictDoNothing();
    await db.insert(answerInputs).values({ id: `a-${record.id}`, attemptId: record.id, answerText: record.input.answerText, sourceType: record.input.answerSourceType }).onConflictDoNothing();
    await db.insert(submissionConsents).values({ id: `c-${record.id}`, attemptId: record.id, userId: record.userId, ...record.input.consent }).onConflictDoNothing();
    await db.insert(diagnosticResults).values({ id: `d-${record.id}`, attemptId: record.id, contractVersion: record.analysis.studentPayload.contract_version, studentPayloadJson: JSON.stringify(record.analysis.studentPayload), rawDiagnosticJson: JSON.stringify(record.analysis.internal.rawDiagnostic) }).onConflictDoUpdate({ target: diagnosticResults.attemptId, set: { contractVersion: record.analysis.studentPayload.contract_version, studentPayloadJson: JSON.stringify(record.analysis.studentPayload), rawDiagnosticJson: JSON.stringify(record.analysis.internal.rawDiagnostic) } });
    await db.insert(normalisedAttemptEvidence).values({ id: `n-${record.id}`, attemptId: record.id, evidenceVersion: record.analysis.internal.normalisedEvidence.evidenceVersion, evidenceJson: JSON.stringify(record.analysis.internal.normalisedEvidence) }).onConflictDoNothing();
  }
  const manual = makeManualDemoInput();
  await db.insert(attempts).values({ id: "demo-manual-afm-1", userId: "student-a", paper: manual.paper, questionLabel: manual.questionLabel, provider: "MANUAL_CODEX", fixture: true, analysisStatus: "AWAITING_DIAGNOSTIC", reviewStatus: "PENDING", releaseStatus: "HELD", diagnosticConfidence: "LOW", createdAt: "2026-10-08T09:00:00Z" }).onConflictDoNothing();
  await db.insert(questionInputs).values({ id: "q-demo-manual-afm-1", attemptId: "demo-manual-afm-1", scenarioText: manual.scenarioText, requirementText: manual.requirementText, markingContextText: manual.permittedMarkingContext, marksAvailable: manual.marksAvailable, sourceType: manual.questionSourceType }).onConflictDoNothing();
  await db.insert(answerInputs).values({ id: "a-demo-manual-afm-1", attemptId: "demo-manual-afm-1", answerText: manual.answerText, sourceType: manual.answerSourceType }).onConflictDoNothing();
  await db.insert(submissionConsents).values({ id: "c-demo-manual-afm-1", attemptId: "demo-manual-afm-1", userId: "student-a", ...manual.consent }).onConflictDoNothing();
}

export async function loadAttempts(userId?: string): Promise<AttemptSummary[]> {
  const db = getDb();
  const base = db.select({
    id: attempts.id, userId: attempts.userId, paper: attempts.paper, questionLabel: attempts.questionLabel, createdAt: attempts.createdAt,
    reviewStatus: attempts.reviewStatus, releaseStatus: attempts.releaseStatus, provider: attempts.provider, fixture: attempts.fixture, diagnosticConfidence: attempts.diagnosticConfidence,
    studentPayloadJson: diagnosticResults.studentPayloadJson, rawDiagnosticJson: diagnosticResults.rawDiagnosticJson, evidenceJson: normalisedAttemptEvidence.evidenceJson,
  }).from(attempts).leftJoin(diagnosticResults, eq(attempts.id, diagnosticResults.attemptId)).leftJoin(normalisedAttemptEvidence, eq(attempts.id, normalisedAttemptEvidence.attemptId)).orderBy(desc(attempts.createdAt));
  const rows = userId ? await base.where(eq(attempts.userId, userId)) : await base;
  return rows.filter((row) => row.studentPayloadJson).map((row) => ({
    id: row.id, userId: row.userId, paper: row.paper as "AFM" | "SBR", questionLabel: row.questionLabel, createdAt: row.createdAt,
    reviewStatus: row.reviewStatus as AttemptSummary["reviewStatus"], releaseStatus: row.releaseStatus as AttemptSummary["releaseStatus"], provider: row.provider, fixture: row.fixture,
    diagnosticConfidence: row.diagnosticConfidence as AttemptSummary["diagnosticConfidence"], studentPayload: parseStoredStudentPayload(row.studentPayloadJson, row.paper, row.fixture),
    rawDiagnostic: parse(row.rawDiagnosticJson), normalisedEvidence: parse(row.evidenceJson),
  }));
}

export async function saveAttempt(userId: string, input: AnalyseInput, analysis: AnalysisPackage) {
  const db = getDb(); const id = crypto.randomUUID(); const payload = parseBetaBackendPayload(analysis.studentPayload);
  const reviewRequired = shouldQueueForReview(id, payload.human_review_required);
  const retentionUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.insert(users).values({ id: userId, displayName: userId === "local-student" ? "Local student" : userId, demo: true }).onConflictDoNothing();
  await db.insert(attempts).values({ id, userId, paper: input.paper, questionLabel: input.questionLabel, provider: analysis.internal.provider, fixture: analysis.internal.fixture, reviewStatus: reviewRequired ? "PENDING" : "APPROVED", releaseStatus: reviewRequired ? "HELD" : "RELEASED", diagnosticConfidence: payload.student_view?.major_weaknesses[0]?.confidence ?? "LOW" });
  await db.insert(questionInputs).values({ id: crypto.randomUUID(), attemptId: id, scenarioText: input.scenarioText, requirementText: input.requirementText, markingContextText: input.permittedMarkingContext, marksAvailable: input.marksAvailable, sourceType: input.questionSourceType, retentionUntil });
  await db.insert(answerInputs).values({ id: crypto.randomUUID(), attemptId: id, answerText: input.answerText, sourceType: input.answerSourceType, retentionUntil });
  await db.insert(submissionConsents).values({ id: crypto.randomUUID(), attemptId: id, userId, ...input.consent });
  await db.insert(diagnosticResults).values({ id: crypto.randomUUID(), attemptId: id, contractVersion: payload.contract_version, studentPayloadJson: JSON.stringify(payload), rawDiagnosticJson: JSON.stringify(analysis.internal.rawDiagnostic) });
  await db.insert(normalisedAttemptEvidence).values({ id: crypto.randomUUID(), attemptId: id, evidenceVersion: analysis.internal.normalisedEvidence.evidenceVersion, evidenceJson: JSON.stringify(analysis.internal.normalisedEvidence) });
  return id;
}

export async function saveManualAttempt(userId: string, input: AnalyseInput, fixture = false, requestedId?: string) {
  if (!input.marksAvailable) throw new Error("Manual diagnostic submissions require marks available.");
  const db = getDb();
  const id = requestedId ?? crypto.randomUUID();
  const retentionUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  await db.insert(users).values({ id: userId, displayName: userId, demo: fixture }).onConflictDoNothing();
  await db.insert(attempts).values({
    id, userId, paper: input.paper, questionLabel: input.questionLabel, provider: "MANUAL_CODEX", fixture,
    analysisStatus: "AWAITING_DIAGNOSTIC", reviewStatus: "PENDING", releaseStatus: "HELD", diagnosticConfidence: "LOW",
  });
  await db.insert(questionInputs).values({
    id: crypto.randomUUID(), attemptId: id, scenarioText: input.scenarioText, requirementText: input.requirementText,
    markingContextText: input.permittedMarkingContext, marksAvailable: input.marksAvailable,
    sourceType: input.questionSourceType, retentionUntil,
  });
  await db.insert(answerInputs).values({ id: crypto.randomUUID(), attemptId: id, answerText: input.answerText, sourceType: input.answerSourceType, retentionUntil });
  await db.insert(submissionConsents).values({ id: crypto.randomUUID(), attemptId: id, userId, ...input.consent });
  return id;
}

export async function loadStudentAttempts(userId: string): Promise<StudentAttemptSummary[]> {
  const db = getDb();
  const rows = await db.select({
    id: attempts.id, paper: attempts.paper, questionLabel: attempts.questionLabel, createdAt: attempts.createdAt,
    reviewStatus: attempts.reviewStatus, releaseStatus: attempts.releaseStatus, diagnosticConfidence: attempts.diagnosticConfidence,
    studentPayloadJson: diagnosticResults.studentPayloadJson, fixture: attempts.fixture,
  }).from(attempts).leftJoin(diagnosticResults, eq(attempts.id, diagnosticResults.attemptId))
    .where(eq(attempts.userId, userId)).orderBy(desc(attempts.createdAt));
  return rows.map((row) => ({
    id: row.id, paper: row.paper as "AFM" | "SBR", questionLabel: row.questionLabel, createdAt: row.createdAt,
    reviewStatus: row.reviewStatus as StudentAttemptSummary["reviewStatus"], releaseStatus: row.releaseStatus as StudentAttemptSummary["releaseStatus"],
    diagnosticConfidence: row.diagnosticConfidence as StudentAttemptSummary["diagnosticConfidence"],
    studentPayload: row.releaseStatus === "RELEASED" && row.studentPayloadJson ? parseStoredStudentPayload(row.studentPayloadJson, row.paper, row.fixture) : null,
  }));
}

export async function loadLiveVerificationAttempts(userId: string): Promise<StudentAttemptSummary[]> {
  return (await loadStudentAttempts(userId)).filter((attempt) => isLiveVerificationLabel(attempt.questionLabel));
}

export async function loadReviewAttempts(): Promise<ReviewAttempt[]> {
  const db = getDb();
  const rows = await db.select({
    id: attempts.id, paper: attempts.paper, questionLabel: attempts.questionLabel, createdAt: attempts.createdAt,
    reviewStatus: attempts.reviewStatus, releaseStatus: attempts.releaseStatus, analysisStatus: attempts.analysisStatus,
    provider: attempts.provider, fixture: attempts.fixture, diagnosticConfidence: attempts.diagnosticConfidence,
    scenarioText: questionInputs.scenarioText, requirementText: questionInputs.requirementText, markingContextText: questionInputs.markingContextText,
    marksAvailable: questionInputs.marksAvailable, answerText: answerInputs.answerText,
    studentPayloadJson: diagnosticResults.studentPayloadJson, rawDiagnosticJson: diagnosticResults.rawDiagnosticJson,
    evidenceJson: normalisedAttemptEvidence.evidenceJson, pipelineResultJson: diagnosticImports.pipelineResultJson,
    importId: diagnosticImports.id,
  }).from(attempts)
    .innerJoin(questionInputs, eq(attempts.id, questionInputs.attemptId))
    .innerJoin(answerInputs, eq(attempts.id, answerInputs.attemptId))
    .leftJoin(diagnosticResults, eq(attempts.id, diagnosticResults.attemptId))
    .leftJoin(normalisedAttemptEvidence, eq(attempts.id, normalisedAttemptEvidence.attemptId))
    .leftJoin(diagnosticImports, eq(attempts.id, diagnosticImports.attemptId))
    .orderBy(desc(attempts.createdAt));
  return rows.map((row) => ({
    id: row.id, paper: row.paper as "AFM" | "SBR", questionLabel: row.questionLabel, createdAt: row.createdAt,
    reviewStatus: row.reviewStatus as ReviewAttempt["reviewStatus"], releaseStatus: row.releaseStatus as ReviewAttempt["releaseStatus"],
    analysisStatus: row.analysisStatus as ReviewAttempt["analysisStatus"], provider: row.provider, fixture: row.fixture,
    diagnosticConfidence: row.diagnosticConfidence as ReviewAttempt["diagnosticConfidence"],
    submission: { scenarioText: row.scenarioText, requirementText: row.requirementText, permittedMarkingContext: row.markingContextText, marksAvailable: row.marksAvailable, answerText: row.answerText },
    studentPayload: row.studentPayloadJson ? parseStoredStudentPayload(row.studentPayloadJson, row.paper, row.fixture) : null,
    rawDiagnostic: parse(row.rawDiagnosticJson) ?? null,
    normalisedEvidence: parse(row.evidenceJson) ?? null,
    pipelineResult: parse(row.pipelineResultJson) ?? null,
    imported: Boolean(row.importId),
  }));
}

export async function loadReviewAttempt(attemptId: string): Promise<ReviewAttempt> {
  const attempt = (await loadReviewAttempts()).find((item) => item.id === attemptId);
  if (!attempt) throw new Error("Attempt not found.");
  return attempt;
}

export async function recordDiagnosticExport(attemptId: string, reviewerId: string, packetHash: string) {
  await getDb().insert(diagnosticExports).values({ id: crypto.randomUUID(), attemptId, reviewerId, packetHash });
}

export async function storeManualDiagnostic(attemptId: string, reviewerId: string, rawDiagnostic: Record<string, unknown>, bundle: PipelineBundle) {
  const db = getDb();
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new Error("Attempt not found.");
  if (attempt.provider !== "MANUAL_CODEX") throw new Error("Manual imports are only available for manual Codex attempts.");
  if (attempt.reviewStatus === "REJECTED") throw new Error("A rejected attempt cannot receive a diagnostic import.");
  const [existing] = await db.select({ id: diagnosticImports.id }).from(diagnosticImports).where(eq(diagnosticImports.attemptId, attemptId)).limit(1);
  if (existing) throw new Error("A diagnostic has already been imported for this attempt.");
  const payload = parseBetaBackendPayload(bundle.beta_backend_payload) as BetaBackendPayload;
  if (payload.paper !== attempt.paper) throw new Error("Imported diagnostic paper does not match the attempt.");
  const confidence = payload.student_view?.major_weaknesses[0]?.confidence ?? "LOW";
  await db.batch([
    db.insert(diagnosticImports).values({ id: crypto.randomUUID(), attemptId, reviewerId, diagnosticHash: bundle.diagnostic_sha256, pipelineVersion: bundle.pipeline_version, pipelineResultJson: JSON.stringify(bundle) }),
    db.insert(diagnosticResults).values({ id: crypto.randomUUID(), attemptId, contractVersion: payload.contract_version, studentPayloadJson: JSON.stringify(payload), rawDiagnosticJson: JSON.stringify(rawDiagnostic) }),
    db.insert(normalisedAttemptEvidence).values({ id: crypto.randomUUID(), attemptId, evidenceVersion: String(bundle.normalised_attempt.normalised_evidence_version ?? "attempt-evidence-v0.2.1"), evidenceJson: JSON.stringify(bundle.normalised_attempt) }),
    db.update(attempts).set({ analysisStatus: "COMPLETED", diagnosticConfidence: confidence, reviewStatus: "PENDING", releaseStatus: "HELD" }).where(eq(attempts.id, attemptId)),
  ]);
  return payload;
}

export async function applyReview(attemptId: string, reviewerId: string, decision: ReviewDecision, note: string) {
  const db = getDb(); const transition = reviewTransition(decision);
  const [attempt] = await db.select().from(attempts).where(eq(attempts.id, attemptId)).limit(1);
  if (!attempt) throw new Error("Attempt not found.");
  if (attempt.reviewStatus !== "PENDING") throw new Error("This attempt has already received a final review decision.");
  if (decision === "APPROVE") {
    const [diagnostic] = await db.select({ id: diagnosticResults.id }).from(diagnosticResults).where(eq(diagnosticResults.attemptId, attemptId)).limit(1);
    if (!diagnostic) throw new Error("A validated diagnostic must be imported before approval.");
  }
  await db.insert(reviews).values({ id: crypto.randomUUID(), attemptId, reviewerId, decision, note });
  await db.update(attempts).set(transition).where(eq(attempts.id, attemptId));
  return transition;
}

export async function deleteOwnedAttempt(attemptId: string, userId: string) {
  const db = getDb();
  const [attempt] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId))).limit(1);
  if (!attempt) throw new Error("Attempt not found.");
  await deleteAttemptGraph(attemptId, userId);
  if (attempt.fixture && isLiveVerificationLabel(attempt.questionLabel)) {
    await removeVerificationIdentityRecords(userId);
  } else {
    await loadAndStoreProfile(userId);
  }
  return { deleted: true };
}

async function attemptGraphResidue(attemptId: string) {
  const db = getDb();
  const probes = await db.batch([
    db.select({ id: feedback.id }).from(feedback).where(eq(feedback.attemptId, attemptId)).limit(1),
    db.select({ id: reviews.id }).from(reviews).where(eq(reviews.attemptId, attemptId)).limit(1),
    db.select({ id: diagnosticImports.id }).from(diagnosticImports).where(eq(diagnosticImports.attemptId, attemptId)).limit(1),
    db.select({ id: diagnosticExports.id }).from(diagnosticExports).where(eq(diagnosticExports.attemptId, attemptId)).limit(1),
    db.select({ id: normalisedAttemptEvidence.id }).from(normalisedAttemptEvidence).where(eq(normalisedAttemptEvidence.attemptId, attemptId)).limit(1),
    db.select({ id: diagnosticResults.id }).from(diagnosticResults).where(eq(diagnosticResults.attemptId, attemptId)).limit(1),
    db.select({ id: submissionConsents.id }).from(submissionConsents).where(eq(submissionConsents.attemptId, attemptId)).limit(1),
    db.select({ id: answerInputs.id }).from(answerInputs).where(eq(answerInputs.attemptId, attemptId)).limit(1),
    db.select({ id: questionInputs.id }).from(questionInputs).where(eq(questionInputs.attemptId, attemptId)).limit(1),
    db.select({ id: attempts.id }).from(attempts).where(eq(attempts.id, attemptId)).limit(1),
  ]);
  return probes.reduce((total, rows) => total + rows.length, 0);
}

async function deleteAttemptGraph(attemptId: string, userId?: string) {
  const db = getDb();
  await db.batch([
    db.delete(feedback).where(eq(feedback.attemptId, attemptId)),
    db.delete(reviews).where(eq(reviews.attemptId, attemptId)),
    db.delete(diagnosticImports).where(eq(diagnosticImports.attemptId, attemptId)),
    db.delete(diagnosticExports).where(eq(diagnosticExports.attemptId, attemptId)),
    db.delete(normalisedAttemptEvidence).where(eq(normalisedAttemptEvidence.attemptId, attemptId)),
    db.delete(diagnosticResults).where(eq(diagnosticResults.attemptId, attemptId)),
    db.delete(submissionConsents).where(eq(submissionConsents.attemptId, attemptId)),
    db.delete(answerInputs).where(eq(answerInputs.attemptId, attemptId)),
    db.delete(questionInputs).where(eq(questionInputs.attemptId, attemptId)),
    db.delete(attempts).where(userId ? and(eq(attempts.id, attemptId), eq(attempts.userId, userId)) : eq(attempts.id, attemptId)),
  ]);
  if (await attemptGraphResidue(attemptId)) throw new Error("Attempt deletion could not be verified. No success response was issued.");
}

async function removeVerificationIdentityRecords(userId: string) {
  const db = getDb();
  const remaining = await db.select({ id: attempts.id }).from(attempts).where(eq(attempts.userId, userId)).limit(1);
  if (remaining.length) return;
  await db.delete(performanceProfiles).where(eq(performanceProfiles.userId, userId));
  await db.delete(users).where(and(eq(users.id, userId), eq(users.demo, true)));
}

export async function cleanupLiveVerificationRecords() {
  const db = getDb();
  const rows = await db.select({ id: attempts.id, userId: attempts.userId, fixture: attempts.fixture, questionLabel: attempts.questionLabel }).from(attempts);
  const verificationAttempts = rows.filter((attempt) => attempt.fixture && isLiveVerificationLabel(attempt.questionLabel));
  for (const attempt of verificationAttempts) await deleteAttemptGraph(attempt.id);
  for (const userId of new Set(verificationAttempts.map((attempt) => attempt.userId))) await removeVerificationIdentityRecords(userId);
  const remaining = await db.select({ id: attempts.id, fixture: attempts.fixture, questionLabel: attempts.questionLabel }).from(attempts);
  if (remaining.some((attempt) => attempt.fixture && isLiveVerificationLabel(attempt.questionLabel))) {
    throw new Error("Verification cleanup could not be verified. No success response was issued.");
  }
  return { deletedAttempts: verificationAttempts.length };
}

export async function loadAndStoreProfile(userId: string) {
  const db = getDb(); const profile = buildSafePerformanceProfile(userId, await loadAttempts(userId));
  await db.insert(performanceProfiles).values({ id: `profile-${userId}`, userId, safeProfileJson: JSON.stringify(profile), evidenceAttemptCount: profile.attemptCount, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: performanceProfiles.userId, set: { safeProfileJson: JSON.stringify(profile), evidenceAttemptCount: profile.attemptCount, updatedAt: new Date().toISOString() } });
  return profile;
}

export async function loadUsers() { return getDb().select().from(users).orderBy(users.displayName); }

export async function loadAnalytics() {
  const db = getDb();
  const allAttempts = await db.select().from(attempts);
  const allFeedback = await db.select().from(feedback);
  const enrolments = await db.select().from(pilotEnrolments);
  const evidenceAttempts = allAttempts.filter((item) => !item.fixture);
  const evidenceAttemptIds = new Set(evidenceAttempts.map((item) => item.id));
  const evidenceFeedback = allFeedback.filter((item) => evidenceAttemptIds.has(item.attemptId));
  const reviewed = evidenceAttempts.filter((item) => item.reviewStatus !== "PENDING");
  const userCounts = new Map<string, number>(); evidenceAttempts.forEach((item) => userCounts.set(item.userId, (userCounts.get(item.userId) ?? 0) + 1));
  const weaknessCategories = new Map<string, number>();
  for (const attempt of (await loadAttempts()).filter((item) => evidenceAttemptIds.has(item.id))) for (const item of attempt.studentPayload.student_view?.major_weaknesses ?? []) weaknessCategories.set(item.category, (weaknessCategories.get(item.category) ?? 0) + 1);
  const usefulness = {
    yes: evidenceFeedback.filter((item) => item.usefulness === "YES").length,
    partly: evidenceFeedback.filter((item) => item.usefulness === "PARTLY").length,
    no: evidenceFeedback.filter((item) => item.usefulness === "NO").length,
  };
  const usability = summariseUsabilityThemes(evidenceFeedback);
  const completedDiagnostics = evidenceAttempts.filter((item) => item.analysisStatus === "COMPLETED").length;
  const studentsReturningForSecondAttempt = [...userCounts.values()].filter((count) => count >= 2).length;
  const policy = getEnrolmentPolicy();
  return {
    studentsInvited: policy.invitations.length,
    studentsEnrolled: enrolments.length,
    firstSubmissions: userCounts.size,
    completedDiagnostics,
    studentsReturningForSecondAttempt,
    feedbackResponses: evidenceFeedback.length,
    reportedUsefulResponses: usefulness.yes + usefulness.partly,
    usabilityIssueReports: usability.reports,
    usabilityThemes: usability.themes,
    changesFollowingFeedback: CHANGES_FOLLOWING_FEEDBACK,
    betaUsers: userCounts.size, attemptsSubmitted: evidenceAttempts.length, analysesCompleted: completedDiagnostics,
    secondAttemptRate: userCounts.size ? studentsReturningForSecondAttempt / userCounts.size : 0,
    attemptsPerUser: userCounts.size ? evidenceAttempts.length / userCounts.size : 0,
    usefulness,
    papers: { AFM: evidenceAttempts.filter((item) => item.paper === "AFM").length, SBR: evidenceAttempts.filter((item) => item.paper === "SBR").length },
    confidence: { HIGH: evidenceAttempts.filter((item) => item.diagnosticConfidence === "HIGH").length, MEDIUM: evidenceAttempts.filter((item) => item.diagnosticConfidence === "MEDIUM").length, LOW: evidenceAttempts.filter((item) => item.diagnosticConfidence === "LOW").length },
    review: { approved: reviewed.filter((item) => item.reviewStatus === "APPROVED").length, flagged: reviewed.filter((item) => item.reviewStatus === "FLAGGED").length, rejected: reviewed.filter((item) => item.reviewStatus === "REJECTED").length, pending: evidenceAttempts.filter((item) => item.reviewStatus === "PENDING").length },
    weaknessCategories: [...weaknessCategories].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    readiness: getPilotReadiness(),
  };
}
