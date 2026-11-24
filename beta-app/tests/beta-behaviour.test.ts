import assert from "node:assert/strict";
import test from "node:test";
import { parseBetaBackendPayload } from "../lib/beta-contract";
import { makeDemoAttempts } from "../lib/demo-data";
import { getDiagnosticProvider, MockFixtureDiagnosticProvider } from "../lib/diagnostic-provider";
import type { AnalyseInput, AttemptSummary, BetaBackendPayload } from "../lib/domain";
import { feedbackSchema } from "../lib/feedback";
import { buildSafePerformanceProfile } from "../lib/performance-profile";
import { reviewTransition } from "../lib/review";
import { shouldQueueForReview } from "../lib/review-policy";
import { AccessControlError, actorFromRequest, enrolledIdentityAccessEnabled, isReviewerIdentity, isStudentIdentity, requirePlatformIdentity, requireReviewer, requireStudent } from "../lib/access-control";
import { getEnrolmentPolicy, invitationForEmail, maskEmail } from "../lib/enrolment";
import { getPilotReadiness } from "../lib/pilot-readiness";
import { resolveStudentEntry } from "../lib/student-entry";
import { getLiveAuthVerification, makeLiveVerificationInput } from "../lib/live-auth-verification";
import { analyseInputSchema } from "../lib/submission-contract";
import { buildPortfolioCaseStudy, CHANGES_FOLLOWING_FEEDBACK, summariseUsabilityThemes } from "../lib/portfolio-evidence";

function input(paper: "AFM" | "SBR"): AnalyseInput {
  return {
    paper,
    questionLabel: "Synthetic practice question",
    scenarioText: "A fictional business is considering a decision based on supplied facts.",
    requirementText: "Evaluate the issue and explain a suitable response.",
    answerText: "The relevant result is positive. This supports the proposed action, although management should consider the scenario risk before deciding.",
    questionSourceType: "PASTED_TEXT",
    answerSourceType: "PASTED_TEXT",
    consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: "2026-10-08T10:00:00Z" },
  };
}

async function validPayload(): Promise<BetaBackendPayload> {
  return (await new MockFixtureDiagnosticProvider().analyse(input("AFM"))).studentPayload;
}

function withStudentLeak(payload: BetaBackendPayload, key: string, value: unknown) {
  return { ...payload, student_view: { ...payload.student_view, [key]: value } };
}

function asAttempt(record: Awaited<ReturnType<typeof makeDemoAttempts>>[number]): AttemptSummary {
  return {
    id: record.id, userId: record.userId, paper: record.input.paper, questionLabel: record.questionLabel,
    createdAt: record.createdAt, reviewStatus: "APPROVED", releaseStatus: "RELEASED",
    provider: "MOCK_FIXTURE", fixture: true, diagnosticConfidence: "HIGH",
    studentPayload: record.analysis.studentPayload, normalisedEvidence: record.analysis.internal.normalisedEvidence,
  };
}

test("AFM is accepted", async () => {
  const result = await new MockFixtureDiagnosticProvider().analyse(input("AFM"));
  assert.equal(result.studentPayload.paper, "AFM");
  assert.ok(result.studentPayload.student_view);
});

test("SBR is accepted", async () => {
  const result = await new MockFixtureDiagnosticProvider().analyse(input("SBR"));
  assert.equal(result.studentPayload.paper, "SBR");
  assert.ok(result.studentPayload.student_view);
});

test("diagnostic summary is concise, provider-authored and contains no marks", async () => {
  for (const paper of ["AFM", "SBR"] as const) {
    const view = (await new MockFixtureDiagnosticProvider().analyse(input(paper))).studentPayload.student_view!;
    assert.match(view.diagnostic_summary, /\S/);
    assert.ok(view.diagnostic_summary.split(/[.!?]+/).filter((part) => part.trim()).length <= 3);
    assert.doesNotMatch(view.diagnostic_summary, /\b(?:mark|marks|score|scores|percentage|percent)\b|\b\d+\s*%/i);
  }
});

test("unsupported paper is blocked", async () => {
  await assert.rejects(() => new MockFixtureDiagnosticProvider().analyse({ ...input("AFM"), paper: "FR" as never }), /Unsupported paper/);
});

test("exact mark cannot reach the student payload", async () => {
  const payload = await validPayload();
  assert.throws(() => parseBetaBackendPayload(withStudentLeak(payload, "mark", 72)));
});

test("mark range cannot reach the student payload", async () => {
  const payload = await validPayload();
  assert.throws(() => parseBetaBackendPayload(withStudentLeak(payload, "mark_range", "65-70")));
});

test("taxonomy codes cannot reach the student payload", async () => {
  const payload = await validPayload();
  assert.throws(() => parseBetaBackendPayload(withStudentLeak(payload, "tag", "AFM.QI.1")));
});

test("engine state cannot reach the student payload", async () => {
  const payload = await validPayload();
  assert.throws(() => parseBetaBackendPayload(withStudentLeak(payload, "state", "RECURRING")));
});

test("synthetic specific-question recommendations cannot reach the student payload", async () => {
  const payload = await validPayload();
  assert.throws(() => parseBetaBackendPayload(withStudentLeak(payload, "specific_question_recommendations", ["Practice kit Q12"])));
});

test("low confidence produces a natural uncertainty notice", async () => {
  const result = await new MockFixtureDiagnosticProvider().analyse({ ...input("SBR"), answerText: "A reporting rule is relevant and should be applied to the facts." });
  assert.ok(result.studentPayload.student_view!.uncertainty_notices.length > 0);
});

test("a single released attempt does not produce a fake trend", async () => {
  const records = (await makeDemoAttempts()).filter((item) => item.userId === "student-a");
  const profile = buildSafePerformanceProfile("student-a", [asAttempt(records[0])]);
  assert.equal(profile.ready, false);
  assert.equal(profile.improvingAreas.length, 0);
  assert.match(profile.message, /Complete more practice analyses/);
});

test("multiple released attempts can create a supported improvement trend", async () => {
  const attempts = (await makeDemoAttempts()).filter((item) => item.userId === "student-a").map(asAttempt);
  const profile = buildSafePerformanceProfile("student-a", attempts);
  assert.equal(profile.ready, true);
  assert.deepEqual(profile.improvingAreas.map((item) => item.dimension), ["QUANTITATIVE_INTERPRETATION"]);
  assert.equal(profile.improvingAreas[0].evidenceCount, 3);
});

test("review approve, flag and reject transitions are safe", () => {
  assert.deepEqual(reviewTransition("APPROVE"), { reviewStatus: "APPROVED", releaseStatus: "RELEASED" });
  assert.deepEqual(reviewTransition("FLAG"), { reviewStatus: "FLAGGED", releaseStatus: "HELD" });
  assert.deepEqual(reviewTransition("REJECT"), { reviewStatus: "REJECTED", releaseStatus: "REJECTED" });
  assert.equal(shouldQueueForReview("attempt-1", true, "OFF"), true, "the frozen contract must override review configuration");
  assert.equal(shouldQueueForReview("attempt-1", false, "OFF"), false);
});

test("feedback capture accepts the beta fields and rejects undeclared data", () => {
  const captured = feedbackSchema.parse({ attemptId: "attempt-1", userId: "student-a", usefulness: "PARTLY", accurateText: "The interpretation point.", confusingText: "", nextWishText: "More practice guidance.", reuseIntent: "YES" });
  assert.equal(captured.usefulness, "PARTLY");
  assert.throws(() => feedbackSchema.parse({ ...captured, hiddenTrackingId: "third-party" }));
});

test("mock provider is explicitly marked as a fixture and isolated from live providers", () => {
  const previous = process.env.DIAGNOSTIC_PROVIDER;
  process.env.DIAGNOSTIC_PROVIDER = "LIVE";
  assert.throws(() => getDiagnosticProvider(), /No live diagnostic provider is connected/);
  if (previous === undefined) delete process.env.DIAGNOSTIC_PROVIDER; else process.env.DIAGNOSTIC_PROVIDER = previous;
  const mock = new MockFixtureDiagnosticProvider();
  assert.equal(mock.id, "MOCK_FIXTURE");
  assert.equal(mock.fixture, true);
});

test("malformed backend payload is rejected safely", async () => {
  const payload = await validPayload();
  assert.throws(() => parseBetaBackendPayload({ ...payload, human_review_required: false }));
  assert.throws(() => parseBetaBackendPayload({ ...payload, contract_version: "unknown-contract" }));
  assert.throws(() => parseBetaBackendPayload({ ...payload, student_view: { ...payload.student_view, diagnostic_summary: "A score of 70 percent." } }));
  const withoutSummary = Object.fromEntries(Object.entries(payload.student_view!).filter(([key]) => key !== "diagnostic_summary"));
  assert.throws(() => parseBetaBackendPayload({ ...payload, student_view: withoutSummary }));
});

test("submission requires explicit experimental-analysis and human-review consent", () => {
  assert.equal(analyseInputSchema.parse(input("AFM")).consent.humanReview, true);
  assert.throws(() => analyseInputSchema.parse({ ...input("AFM"), consent: { ...input("AFM").consent, humanReview: false } }));
  assert.throws(() => analyseInputSchema.parse(Object.fromEntries(Object.entries(input("AFM")).filter(([key]) => key !== "consent"))));
});

test("platform identity overrides client-selected student and enforces reviewer allowlist", () => {
  const request = new Request("https://beta.local/api/attempts?userId=student-b", { headers: { "oai-authenticated-user-id": "student-a", "oai-authenticated-user-email": "a@example.test" } });
  const config = { NODE_ENV: "production", BETA_STUDENT_IDS: "student-a,student-b", BETA_REVIEWER_IDS: "reviewer-1" };
  assert.equal(actorFromRequest(request, config).userId, "student-a");
  assert.equal(requireStudent(request, config).role, "STUDENT");
  assert.throws(() => requireReviewer(request, config), AccessControlError);
  const reviewer = new Request("https://beta.local/api/review", { headers: { "oai-authenticated-user-id": "reviewer-1", "oai-authenticated-user-email": "reviewer@example.test" } });
  assert.equal(requireReviewer(reviewer, config).role, "REVIEWER");
  assert.equal(isReviewerIdentity("reviewer-1", config), true);
  assert.equal(isReviewerIdentity("student-a", config), false);
  assert.equal(isStudentIdentity("student-a", config), true);
});

test("portfolio evidence is aggregate, excludes raw feedback and reports zeroes honestly", () => {
  const usability = summariseUsabilityThemes([
    { confusingText: "The PDF upload and OCR took a long time." },
    { confusingText: "" },
    { confusingText: "I could not find the next button." },
  ]);
  assert.equal(usability.reports, 2);
  assert.deepEqual(usability.themes.map((item) => item.theme), ["Instructions or navigation", "Upload or text extraction", "Waiting time"]);
  const report = buildPortfolioCaseStudy({
    studentsInvited: 0, studentsEnrolled: 0, firstSubmissions: 0, completedDiagnostics: 0,
    studentsReturningForSecondAttempt: 0, feedbackResponses: 0, reportedUsefulResponses: 0,
    usabilityIssueReports: 0, usabilityThemes: [], changesFollowingFeedback: CHANGES_FOLLOWING_FEEDBACK,
    usefulness: { yes: 0, partly: 0, no: 0 },
  }, "2026-10-12T00:00:00.000Z");
  assert.match(report, /Students invited: 0/);
  assert.match(report, /No responses yet/);
  assert.doesNotMatch(report, /student-a|site-user|example\.test|answerText|confusingText/);
});

test("unauthenticated and unenrolled production requests fail closed", () => {
  assert.throws(() => actorFromRequest(new Request("https://beta.local/api/attempts"), { NODE_ENV: "production" }), /Authentication is required/);
  assert.throws(() => actorFromRequest(new Request("https://beta.local/api/attempts", { headers: { "oai-authenticated-user-id": "stranger", "oai-authenticated-user-email": "stranger@example.test" } }), { NODE_ENV: "production", BETA_STUDENT_IDS: "student-a" }), /not enrolled/);
});

test("enrolment supports one-to-five unique invitations and fails closed outside that range", () => {
  const base = {
    BETA_ENROLMENT_ENABLED: "true",
    BETA_ENROLMENT_HASH_SECRET: "synthetic-enrolment-secret-with-at-least-32-characters",
    BETA_REAL_PILOT_ENABLED: "false",
    BETA_AUTHENTICATION_VERIFIED: "false",
    BETA_REVIEWER_IDS: "reviewer-1",
  };
  const emails = "one@example.test,two@example.test,three@example.test,four@example.test,five@example.test";
  const open = getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: emails });
  assert.equal(open.open, true);
  assert.equal(open.invitations.length, 5);
  assert.equal(invitationForEmail(open, " TWO@EXAMPLE.TEST ")?.slot, 2);
  assert.equal(maskEmail("student.one@example.test"), "st…ne@e•••.test");
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: "one@example.test" }).open, true);
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: "one@example.test,two@example.test" }).open, true);
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: `${emails},one@example.test` }).open, false);
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: `${emails},six@example.test` }).open, false);
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: emails, BETA_STUDENT_IDS: "student-1", BETA_REAL_PILOT_ENABLED: "true", BETA_AUTHENTICATION_VERIFIED: "true" }).open, true);
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: emails, BETA_STUDENT_IDS: "student-1,student-2,student-3,student-4,student-5,student-6" }).open, false);
  assert.equal(getEnrolmentPolicy({ ...base, BETA_INVITED_STUDENT_EMAILS: emails, BETA_STUDENT_IDS: "reviewer-1" }).open, false);
});

test("enrolment identity is accepted only from the platform header pair", () => {
  const authenticated = new Request("https://beta.local/api/enrolment", { headers: { "oai-authenticated-user-id": "site-user-1", "oai-authenticated-user-email": "one@example.test" } });
  assert.deepEqual(requirePlatformIdentity(authenticated), { userId: "site-user-1", email: "one@example.test" });
  const bodyOnly = new Request("https://beta.local/api/enrolment", { method: "POST", body: JSON.stringify({ userId: "site-user-1", email: "one@example.test" }) });
  assert.throws(() => requirePlatformIdentity(bodyOnly), /Authentication is required/);
  const incomplete = new Request("https://beta.local/api/enrolment", { headers: { "oai-authenticated-user-id": "site-user-1" } });
  assert.throws(() => requirePlatformIdentity(incomplete), /Authentication is required/);
});

test("D1 enrolment authorization remains fail-closed until the production identity boundary is verified", () => {
  const base = {
    BETA_REVIEWER_IDS: "reviewer-1",
    BETA_PRIVATE_DEPLOYMENT_VERIFIED: "true",
    BETA_PRIVATE_STORAGE_VERIFIED: "true",
  };
  assert.equal(enrolledIdentityAccessEnabled(base), false);
  assert.equal(enrolledIdentityAccessEnabled({ ...base, BETA_AUTHENTICATION_VERIFIED: "false" }), false);
  assert.equal(enrolledIdentityAccessEnabled({ ...base, BETA_AUTHENTICATION_VERIFIED: "true" }), true);
  assert.equal(enrolledIdentityAccessEnabled({ ...base, BETA_AUTHENTICATION_VERIFIED: "true", BETA_REVIEWER_IDS: "reviewer-1,reviewer-2" }), false);
});

test("real pilot readiness remains disabled until every security prerequisite is verified", () => {
  const disabled = getPilotReadiness({ NODE_ENV: "production" });
  assert.equal(disabled.canAcceptRealSubmissions, false);
  assert.ok(disabled.blockers.length >= 6);
  const readyConfig = {
    NODE_ENV: "production", BETA_REAL_PILOT_ENABLED: "true", BETA_PRIVATE_DEPLOYMENT_VERIFIED: "true",
    BETA_PRIVATE_STORAGE_VERIFIED: "true", BETA_AUTHENTICATION_VERIFIED: "true", BETA_REVIEWER_IDS: "reviewer-1",
    BETA_STUDENT_IDS: "student-1", BETA_WORKER_PIPELINE_VERIFIED: "true",
  };
  const ready = getPilotReadiness(readyConfig);
  assert.equal(ready.canAcceptRealSubmissions, true);
  assert.equal(resolveStudentEntry("student-1", readyConfig), "ACTIVE_STUDENT");
  assert.equal(resolveStudentEntry("student-1", { ...readyConfig, BETA_REAL_PILOT_ENABLED: "false" }), "WAITING_STUDENT");
  assert.equal(resolveStudentEntry("reviewer-1", readyConfig), "REVIEWER");
  assert.equal(resolveStudentEntry("stranger", readyConfig), "CANDIDATE");
  const overlap = getPilotReadiness({
    ...readyConfig, BETA_REVIEWER_IDS: "student-1",
  });
  assert.equal(overlap.canAcceptRealSubmissions, false);
  assert.ok(overlap.blockers.some((blocker) => /must not overlap/.test(blocker)));
  const none = getPilotReadiness({ ...readyConfig, BETA_STUDENT_IDS: "" });
  assert.ok(none.blockers.some((blocker) => /at least one verified identity/.test(blocker)));
  const tooMany = getPilotReadiness({
    ...readyConfig, BETA_STUDENT_IDS: "student-1,student-2,student-3,student-4,student-5,student-6",
  });
  assert.ok(tooMany.blockers.some((blocker) => /cannot exceed five active identities/.test(blocker)));
});

test("live authentication verification is exact-two, expiring and independent from the real pilot", () => {
  const now = new Date("2026-10-12T12:00:00.000Z");
  const config = {
    NODE_ENV: "production",
    BETA_LIVE_AUTH_VERIFICATION_ENABLED: "true",
    BETA_LIVE_AUTH_VERIFICATION_STARTED_AT: "2026-10-12T11:55:00.000Z",
    BETA_LIVE_AUTH_VERIFICATION_EXPIRES_AT: "2026-10-12T14:00:00.000Z",
    BETA_REAL_PILOT_ENABLED: "false",
    BETA_AUTHENTICATION_VERIFIED: "false",
    BETA_PRIVATE_DEPLOYMENT_VERIFIED: "true",
    BETA_PRIVATE_STORAGE_VERIFIED: "true",
    BETA_WORKER_PIPELINE_VERIFIED: "true",
    BETA_REVIEWER_IDS: "reviewer-1",
    BETA_STUDENT_IDS: "student-1,student-2",
    BETA_VERIFICATION_STUDENT_IDS: "student-1,student-2",
  };
  assert.equal(getLiveAuthVerification(config, now).active, true);
  assert.equal(resolveStudentEntry("student-1", config, now), "VERIFICATION_STUDENT");
  const afm = makeLiveVerificationInput("student-1", now.toISOString(), config);
  const sbr = makeLiveVerificationInput("student-2", now.toISOString(), config);
  assert.equal(afm.paper, "AFM");
  assert.equal(sbr.paper, "SBR");
  assert.equal(afm.consent.experimentalAiAnalysis, true);
  assert.match(afm.answerText, /synthetic/i);
  assert.equal(getLiveAuthVerification({ ...config, BETA_LIVE_AUTH_VERIFICATION_ENABLED: "false" }, now).active, false);
  assert.equal(getLiveAuthVerification({ ...config, BETA_REAL_PILOT_ENABLED: "true" }, now).active, false);
  assert.equal(getLiveAuthVerification({ ...config, BETA_STUDENT_IDS: "student-1" }, now).active, false);
  assert.equal(getLiveAuthVerification({ ...config, BETA_REVIEWER_IDS: "student-1" }, now).active, false);
  assert.equal(getLiveAuthVerification({ ...config, BETA_LIVE_AUTH_VERIFICATION_EXPIRES_AT: "2026-10-12T16:30:00.000Z" }, now).active, false);
  assert.equal(getLiveAuthVerification(config, new Date("2026-10-12T14:00:00.000Z")).active, false);
});
