// Part of ../../PROJECT.md — full synthetic HTTP workflow against isolated temporary D1 state.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stateDir = await mkdtemp(join(tmpdir(), "acca-pilot-flow-"));
const appPort = 8791;
const appOrigin = `http://127.0.0.1:${appPort}`;
const reviewerHeaders = { "x-beta-synthetic-user": "local-reviewer" };
const studentHeaders = { "x-beta-synthetic-user": "student-a" };
const otherStudentHeaders = { "x-beta-synthetic-user": "student-b" };
const children = [];

function command(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

async function waitFor(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500) return response;
      last = new Error(`status ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw last ?? new Error(`Timed out waiting for ${url}`);
}

async function api(path, { headers = {}, ...options } = {}) {
  const response = await fetch(`${appOrigin}${path}`, { ...options, headers: { "Content-Type": "application/json", ...headers } });
  const body = await response.json();
  return { response, body };
}

function submission(label) {
  return {
    paper: "AFM",
    questionLabel: label,
    scenarioText: "A fictional company is considering an investment with uncertain cash flows and a positive base-case value.",
    requirementText: "Evaluate the investment and recommend whether the company should proceed.",
    permittedMarkingContext: "Synthetic context only. Assess the visible conclusion, interpretation, uncertainty and recommendation support.",
    marksAvailable: 20,
    answerText: "The base-case result is positive, so the company should proceed. Management should test the downside cash flows and financing headroom before committing.",
    questionSourceType: "PASTED_TEXT",
    answerSourceType: "PASTED_TEXT",
    consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: "2026-10-08T10:00:00Z" },
  };
}

function allKeys(value) {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

try {
  command(["./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--file", "drizzle/0000_talented_bullseye.sql"]);
  command(["./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--file", "drizzle/0001_petite_iceman.sql"]);

  const app = spawn(process.execPath, [
    "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "dev",
    "--config", "dist/server/wrangler.json", "--local", "--persist-to", stateDir, "--ip", "127.0.0.1", "--port", String(appPort), "--inspector-port", "0",
    "--var", "NODE_ENV:development", "--var", "BETA_SYNTHETIC_MODE:true",
    "--var", "BETA_REAL_PILOT_ENABLED:false", "--var", "BETA_PRIVATE_DEPLOYMENT_VERIFIED:true",
    "--var", "BETA_PRIVATE_STORAGE_VERIFIED:true", "--var", "BETA_AUTHENTICATION_VERIFIED:true",
    "--var", "BETA_REVIEWER_IDS:reviewer-1", "--var", "BETA_STUDENT_IDS:pilot-student-1,pilot-student-2",
    "--var", "BETA_WORKER_PIPELINE_VERIFIED:true",
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  children.push(app);
  await waitFor(`${appOrigin}/api/pilot-readiness`, { headers: studentHeaders });

  const unauthorised = await api("/api/review");
  assert.equal(unauthorised.response.status, 401);

  const noConsent = submission("Synthetic missing-consent attempt");
  noConsent.consent.experimentalAiAnalysis = false;
  const refusedConsent = await api("/api/attempts/manual", { method: "POST", headers: studentHeaders, body: JSON.stringify(noConsent) });
  assert.equal(refusedConsent.response.status, 422);

  const created = await api("/api/attempts/manual", { method: "POST", headers: studentHeaders, body: JSON.stringify(submission("Synthetic full-flow attempt")) });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const attemptId = created.body.attemptId;

  const isolated = await api("/api/attempts?userId=pilot-student-1", { headers: otherStudentHeaders });
  assert.equal(isolated.response.status, 200);
  assert.deepEqual(isolated.body.attempts, []);

  const packetResult = await api("/api/internal/diagnostic-packet", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId }) });
  assert.equal(packetResult.response.status, 200, JSON.stringify(packetResult.body));
  const packetText = JSON.stringify(packetResult.body.packet);
  assert.doesNotMatch(packetText, /student-a|student-b|local-reviewer|@example\.test/);

  const studentPacket = await api("/api/internal/diagnostic-packet", { method: "POST", headers: studentHeaders, body: JSON.stringify({ attemptId }) });
  assert.equal(studentPacket.response.status, 403);

  const invalid = await api("/api/internal/diagnostic-import", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId, diagnosticText: "{not json" }) });
  assert.equal(invalid.response.status, 422);

  const fixture = JSON.parse(await readFile(new URL("../../prototype/fixtures/vnext_synthetic_cases.json", import.meta.url), "utf8")).valid_diagnostic;
  const context = packetResult.body.packet.analysis_context;
  fixture.analysis_id = context.analysis_id;
  fixture.benchmark_case_id = context.case_id;
  fixture.paper = context.paper;
  fixture.marks_available = context.marks_available;
  Object.assign(fixture.diagnostic_model, {
    provider: "OpenAI Codex (manual session)", model: "synthetic-integration-model", reasoning: "test",
    prompt_version: context.prompt_version, taxonomy_version: context.taxonomy_version, paper_rules_version: context.paper_rules_version,
  });
  fixture.uncertainty.flags = ["AMBIGUOUS_EVIDENCE"];
  fixture.uncertainty.details = ["Synthetic evidence is deliberately ambiguous."];

  const imported = await api("/api/internal/diagnostic-import", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId, diagnosticText: JSON.stringify(fixture) }) });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  assert.equal(imported.body.studentPayload.release_status, "HUMAN_REVIEW_REQUIRED");

  const duplicate = await api("/api/internal/diagnostic-import", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId, diagnosticText: JSON.stringify(fixture) }) });
  assert.equal(duplicate.response.status, 409);

  const approved = await api("/api/review", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId, decision: "APPROVE", note: "Synthetic integration approval" }) });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.releaseStatus, "RELEASED");

  const secondDecision = await api("/api/review", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId, decision: "REJECT", note: "Must be final" }) });
  assert.equal(secondDecision.response.status, 422);

  const studentResult = await api("/api/attempts?userId=pilot-student-2", { headers: studentHeaders });
  assert.equal(studentResult.response.status, 200);
  assert.equal(studentResult.body.attempts.length, 1);
  assert.equal(studentResult.body.attempts[0].id, attemptId);
  const keys = new Set(allKeys(studentResult.body));
  for (const prohibited of ["rawDiagnostic", "normalisedEvidence", "pipelineResult", "provider", "fixture", "indicative_mark", "tag", "state", "question_key", "provenance"]) assert.equal(keys.has(prohibited), false, prohibited);

  const feedback = await api("/api/feedback", { method: "POST", headers: studentHeaders, body: JSON.stringify({ attemptId, usefulness: "YES", accurateText: "Synthetic feedback", confusingText: "", nextWishText: "", reuseIntent: "YES" }) });
  assert.equal(feedback.response.status, 201, JSON.stringify(feedback.body));

  const second = await api("/api/attempts/manual", { method: "POST", headers: studentHeaders, body: JSON.stringify(submission("Synthetic rejected attempt")) });
  assert.equal(second.response.status, 201);
  const rejected = await api("/api/review", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId: second.body.attemptId, decision: "REJECT", note: "Synthetic rejection" }) });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.releaseStatus, "REJECTED");

  assert.equal((await api(`/api/attempts/${encodeURIComponent(attemptId)}`, { method: "DELETE", headers: studentHeaders })).response.status, 422, "same-origin deletion is required");
  const deleted = await api(`/api/attempts/${encodeURIComponent(attemptId)}`, { method: "DELETE", headers: { ...studentHeaders, origin: appOrigin } });
  assert.equal(deleted.response.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.deleted, true);
  const afterDelete = await api("/api/attempts", { headers: studentHeaders });
  assert.equal(afterDelete.body.attempts.some((item) => item.id === attemptId), false);

  process.stdout.write("Synthetic hosted pilot flow passed without a sidecar: auth, ownership, consent, export, invalid import, strict Worker pipeline, uncertainty, duplicate rejection, final approval, safe student result, feedback, rejection and deletion.\n");
} finally {
  for (const child of children.reverse()) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(stateDir, { recursive: true, force: true });
}
