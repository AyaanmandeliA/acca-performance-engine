// Part of ../../PROJECT.md — deterministic extraction and confirmation safety regressions.
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessExtraction,
  extractionNeedsConfirmation,
  reconstructPdfPage,
  type ExtractedDocument,
} from "../lib/client-document-extraction";
import { analyseInputSchema } from "../lib/submission-contract";

test("PDF text reconstruction keeps question numbering, paragraphs, tables and calculations", () => {
  const text = reconstructPdfPage([
    { str: "1 (a) Evaluate the proposal", x: 40, y: 760, width: 170, height: 12 },
    { str: "Use the figures below.", x: 40, y: 742, width: 118, height: 12 },
    { str: "Year", x: 40, y: 700, width: 28, height: 12 },
    { str: "Cash flow ($m)", x: 190, y: 700, width: 82, height: 12 },
    { str: "1", x: 40, y: 682, width: 7, height: 12 },
    { str: "125.5", x: 190, y: 682, width: 34, height: 12 },
    { str: "NPV = 1,250 - 900 = 350", x: 40, y: 640, width: 160, height: 12 },
  ]);

  assert.match(text, /^1 \(a\) Evaluate the proposal/m);
  assert.match(text, /Use the figures below\.\n\nYear\tCash flow \(\$m\)/);
  assert.match(text, /1\t125\.5/);
  assert.match(text, /NPV = 1,250 - 900 = 350/);
});

test("short, damaged or incomplete extraction is classified as low reliability", () => {
  assert.equal(assessExtraction("", null, 0).low, true);
  assert.equal(assessExtraction("short text", 92, 0).low, true);
  assert.equal(assessExtraction("A complete paragraph with enough readable characters for a useful review.", 92, 1).low, true);
  assert.equal(assessExtraction("A complete paragraph with enough readable characters for a useful review.", 92, 0).low, false);
});

test("extracted text must be confirmed and any manual correction invalidates confirmation", () => {
  const result: ExtractedDocument = {
    text: "The initial extracted paragraph contains a numerical figure of 125.",
    kind: "IMAGE_OCR",
    reliability: "REVIEW_REQUIRED",
    warnings: [],
    fileNames: ["answer.png"],
    pageCount: 1,
    confidence: 88,
  };
  assert.equal(extractionNeedsConfirmation(result, result.text, null), true);
  assert.equal(extractionNeedsConfirmation(result, result.text, result.text), false);
  assert.equal(extractionNeedsConfirmation(result, `${result.text} Corrected.`, result.text), true);
  assert.equal(extractionNeedsConfirmation(null, "Manually pasted text", null), false);
});

test("submission schema records PDF, OCR and mixed question sources without changing the payload contract", () => {
  const base = {
    paper: "AFM",
    questionLabel: "Synthetic upload test",
    scenarioText: "A fictional scenario with enough text for safe submission.",
    requirementText: "Evaluate the proposal.",
    marksAvailable: 20,
    answerText: "The proposal creates value, but management should verify the downside case.",
    consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: "2026-10-08T10:00:00.000Z" },
  } as const;

  assert.equal(analyseInputSchema.parse({ ...base, questionSourceType: "PDF_TEXT", answerSourceType: "IMAGE_OCR" }).answerSourceType, "IMAGE_OCR");
  assert.equal(analyseInputSchema.parse({ ...base, questionSourceType: "MIXED_INPUT", answerSourceType: "PDF_TEXT" }).questionSourceType, "MIXED_INPUT");
  assert.throws(() => analyseInputSchema.parse({ ...base, questionSourceType: "EXTERNAL_OCR", answerSourceType: "PASTED_TEXT" }));
});
