import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  demo: integer("demo", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pilotEnrolments = sqliteTable("pilot_enrolments", {
  inviteKey: text("invite_key").primaryKey(),
  siteUserId: text("site_user_id").notNull().unique(),
  enrolledAt: text("enrolled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  paper: text("paper", { enum: ["AFM", "SBR"] }).notNull(),
  questionLabel: text("question_label").notNull(),
  provider: text("provider").notNull(),
  fixture: integer("fixture", { mode: "boolean" }).notNull().default(true),
  analysisStatus: text("analysis_status").notNull().default("COMPLETED"),
  reviewStatus: text("review_status").notNull().default("PENDING"),
  releaseStatus: text("release_status").notNull().default("HELD"),
  diagnosticConfidence: text("diagnostic_confidence").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_attempts_user_created").on(table.userId, table.createdAt),
  index("idx_attempts_review_status").on(table.reviewStatus),
]);

export const questionInputs = sqliteTable("question_inputs", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  scenarioText: text("scenario_text").notNull(),
  requirementText: text("requirement_text").notNull(),
  markingContextText: text("marking_context_text"),
  marksAvailable: integer("marks_available"),
  sourceType: text("source_type").notNull().default("PASTED_TEXT"),
  retentionUntil: text("retention_until"),
  deletionRequestedAt: text("deletion_requested_at"),
});

export const submissionConsents = sqliteTable("submission_consents", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  userId: text("user_id").notNull().references(() => users.id),
  privacyNoticeVersion: text("privacy_notice_version").notNull(),
  experimentalAiAnalysis: integer("experimental_ai_analysis", { mode: "boolean" }).notNull(),
  humanReview: integer("human_review", { mode: "boolean" }).notNull(),
  consentedAt: text("consented_at").notNull(),
});

export const answerInputs = sqliteTable("answer_inputs", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  answerText: text("answer_text").notNull(),
  sourceType: text("source_type").notNull().default("PASTED_TEXT"),
  retentionUntil: text("retention_until"),
  deletionRequestedAt: text("deletion_requested_at"),
});

export const diagnosticResults = sqliteTable("diagnostic_results", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  contractVersion: text("contract_version").notNull(),
  studentPayloadJson: text("student_payload_json").notNull(),
  rawDiagnosticJson: text("raw_diagnostic_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const normalisedAttemptEvidence = sqliteTable("normalised_attempt_evidence", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  evidenceVersion: text("evidence_version").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const performanceProfiles = sqliteTable("performance_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id),
  safeProfileJson: text("safe_profile_json").notNull(),
  evidenceAttemptCount: integer("evidence_attempt_count").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().references(() => attempts.id),
  reviewerId: text("reviewer_id").notNull(),
  decision: text("decision", { enum: ["APPROVE", "FLAG", "REJECT"] }).notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_reviews_attempt_created").on(table.attemptId, table.createdAt)]);

export const diagnosticExports = sqliteTable("diagnostic_exports", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().references(() => attempts.id),
  reviewerId: text("reviewer_id").notNull(),
  packetHash: text("packet_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_diagnostic_exports_attempt_created").on(table.attemptId, table.createdAt)]);

export const diagnosticImports = sqliteTable("diagnostic_imports", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  reviewerId: text("reviewer_id").notNull(),
  diagnosticHash: text("diagnostic_hash").notNull().unique(),
  pipelineVersion: text("pipeline_version").notNull(),
  pipelineResultJson: text("pipeline_result_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  attemptId: text("attempt_id").notNull().unique().references(() => attempts.id),
  userId: text("user_id").notNull().references(() => users.id),
  usefulness: text("usefulness", { enum: ["YES", "PARTLY", "NO"] }).notNull(),
  accurateText: text("accurate_text").notNull().default(""),
  confusingText: text("confusing_text").notNull().default(""),
  nextWishText: text("next_wish_text").notNull().default(""),
  reuseIntent: text("reuse_intent", { enum: ["YES", "MAYBE", "NO"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_feedback_user").on(table.userId)]);
