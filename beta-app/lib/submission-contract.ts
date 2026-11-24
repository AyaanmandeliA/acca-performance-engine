import { z } from "zod";

export const consentSchema = z.object({
  privacyNoticeVersion: z.literal("pilot-consent-v0.1.0"),
  experimentalAiAnalysis: z.literal(true),
  humanReview: z.literal(true),
  consentedAt: z.string().datetime(),
}).strict();

export const analyseInputSchema = z.object({
  paper: z.enum(["AFM", "SBR"]),
  questionLabel: z.string().min(2).max(120),
  scenarioText: z.string().min(20).max(50000),
  requirementText: z.string().min(8).max(10000),
  permittedMarkingContext: z.string().max(30000).optional(),
  marksAvailable: z.number().int().positive().max(100).optional(),
  answerText: z.string().min(20).max(80000),
  questionSourceType: z.enum(["PASTED_TEXT", "TEXT_FILE", "PDF_TEXT", "IMAGE_OCR", "MIXED_INPUT"]),
  answerSourceType: z.enum(["PASTED_TEXT", "TEXT_FILE", "PDF_TEXT", "IMAGE_OCR"]),
  consent: consentSchema,
}).strict();
