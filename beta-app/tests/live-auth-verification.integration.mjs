// Part of ../../PROJECT.md — exact-two live identity verification against isolated temporary D1 state.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stateDir = await mkdtemp(join(tmpdir(), "acca-live-auth-verification-"));
const appPort = 8793;
const appOrigin = `http://127.0.0.1:${appPort}`;
const identity = (userId, email) => ({ "oai-authenticated-user-id": userId, "oai-authenticated-user-email": email });
const reviewerHeaders = identity("reviewer-1", "reviewer@example.test");
const studentAHeaders = identity("verified-student-a", "a@example.test");
const studentBHeaders = identity("verified-student-b", "b@example.test");
const strangerHeaders = identity("stranger", "stranger@example.test");
const children = [];
let appOutput = "";

function command(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

function queryRows(sql) {
  const result = spawnSync(process.execPath, [
    "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
    "--config", "dist/server/wrangler.json", "--persist-to", stateDir,
    "--command", sql, "--json",
  ], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${sql}\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout)[0]?.results ?? [];
}

async function waitFor(url) {
  let last;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
      last = new Error(`status ${response.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw last ?? new Error(`Timed out waiting for ${url}`);
}

async function api(path, { headers = {}, ...options } = {}) {
  const response = await fetch(`${appOrigin}${path}`, { signal: AbortSignal.timeout(20_000), ...options, headers: { "Content-Type": "application/json", ...headers } });
  const body = await response.json();
  return { response, body };
}

function allKeys(value) {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...allKeys(nested)]);
}

try {
  for (const migration of ["0000_talented_bullseye.sql", "0001_petite_iceman.sql", "0002_adorable_azazel.sql"]) {
    command(["./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--file", `drizzle/${migration}`]);
  }
  command(["./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--command", "INSERT INTO users (id, display_name, demo) VALUES ('unrelated-fixture-user', 'Unrelated fixture user', 1)"]);
  command(["./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--command", "INSERT INTO attempts (id, user_id, paper, question_label, provider, fixture, diagnostic_confidence) VALUES ('unrelated-fixture-attempt', 'unrelated-fixture-user', 'AFM', 'Unrelated synthetic fixture', 'MANUAL_CODEX', 1, 'LOW')"]);
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const app = spawn(process.execPath, [
    "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "dev",
    "--config", "dist/server/wrangler.json", "--local", "--persist-to", stateDir, "--ip", "127.0.0.1", "--port", String(appPort), "--inspector-port", "0",
    "--var", "NODE_ENV:development", "--var", "BETA_SYNTHETIC_MODE:false",
    "--var", "BETA_REAL_PILOT_ENABLED:false", "--var", "BETA_AUTHENTICATION_VERIFIED:false",
    "--var", "BETA_PRIVATE_DEPLOYMENT_VERIFIED:true", "--var", "BETA_PRIVATE_STORAGE_VERIFIED:true", "--var", "BETA_WORKER_PIPELINE_VERIFIED:true",
    "--var", "BETA_REVIEWER_IDS:reviewer-1", "--var", "BETA_STUDENT_IDS:verified-student-a,verified-student-b",
    "--var", "BETA_VERIFICATION_STUDENT_IDS:verified-student-a,verified-student-b",
    "--var", "BETA_LIVE_AUTH_VERIFICATION_ENABLED:true", "--var", `BETA_LIVE_AUTH_VERIFICATION_STARTED_AT:${startedAt}`, "--var", `BETA_LIVE_AUTH_VERIFICATION_EXPIRES_AT:${expiresAt}`,
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  children.push(app);
  app.stdout.on("data", (chunk) => { appOutput += chunk.toString(); });
  app.stderr.on("data", (chunk) => { appOutput += chunk.toString(); });
  await waitFor(`${appOrigin}/api/verification`);

  assert.equal((await api("/api/verification")).response.status, 401);
  assert.equal((await api("/api/verification", { headers: strangerHeaders })).response.status, 403);
  assert.equal((await api("/api/verification", { headers: reviewerHeaders })).response.status, 403);
  assert.equal((await api("/api/verification", { headers: { "x-beta-synthetic-user": "student-a" } })).response.status, 401);
  assert.equal((await api("/api/attempts?userId=verified-student-a", { headers: reviewerHeaders })).response.status, 403, "reviewer cannot impersonate a student through the URL");

  const studentHome = await fetch(`${appOrigin}/`, { headers: studentAHeaders });
  assert.equal(studentHome.status, 200);
  assert.match(await studentHome.text(), /Live identity verification/);

  assert.equal((await api("/api/verification", { method: "POST", headers: studentAHeaders, body: JSON.stringify({ experimentalAiAnalysis: true, humanReview: true }) })).response.status, 403, "same-origin write is required");
  assert.equal((await api("/api/verification", { method: "POST", headers: { ...studentAHeaders, origin: appOrigin }, body: JSON.stringify({ experimentalAiAnalysis: false, humanReview: true }) })).response.status, 422, "both consents are mandatory");
  assert.equal((await api("/api/verification", { method: "POST", headers: { ...studentAHeaders, origin: appOrigin }, body: JSON.stringify({ experimentalAiAnalysis: true, humanReview: true, answerText: "arbitrary text" }) })).response.status, 422, "arbitrary content is rejected");

  const blockedNormalSubmission = await api("/api/attempts/manual", { method: "POST", headers: studentAHeaders, body: JSON.stringify({
    paper: "AFM", questionLabel: "Must stay blocked", marksAvailable: 20,
    scenarioText: "A fictional scenario with enough text to satisfy the ordinary production submission schema.",
    requirementText: "Evaluate this fictional scenario and recommend an appropriate response.",
    answerText: "This arbitrary answer must never be accepted while only the live-auth verification workflow is active.",
    questionSourceType: "PASTED_TEXT", answerSourceType: "PASTED_TEXT",
    consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: new Date().toISOString() },
  }) });
  assert.equal(blockedNormalSubmission.response.status, 422, "normal production submission remains gated");
  assert.match(blockedNormalSubmission.body.error, /real pilot is disabled/i);
  assert.equal((await api("/api/analyse", { method: "POST", headers: studentAHeaders, body: JSON.stringify({
    paper: "AFM", questionLabel: "Must stay blocked", marksAvailable: 20,
    scenarioText: "A fictional scenario with enough text to satisfy the fixture analysis schema safely.",
    requirementText: "Evaluate this fictional scenario and recommend an appropriate response.",
    answerText: "This arbitrary answer must not reach the local-only fixture analysis endpoint from a platform-authenticated account.",
    questionSourceType: "PASTED_TEXT", answerSourceType: "PASTED_TEXT",
  }) })).response.status, 404, "platform identities cannot use the local fixture-analysis endpoint");

  const createdA = await api("/api/verification", { method: "POST", headers: { ...studentAHeaders, origin: appOrigin }, body: JSON.stringify({ experimentalAiAnalysis: true, humanReview: true }) });
  const createdB = await api("/api/verification", { method: "POST", headers: { ...studentBHeaders, origin: appOrigin }, body: JSON.stringify({ experimentalAiAnalysis: true, humanReview: true }) });
  assert.equal(createdA.response.status, 201, JSON.stringify(createdA.body));
  assert.equal(createdB.response.status, 201, JSON.stringify(createdB.body));
  assert.notEqual(createdA.body.attemptId, createdB.body.attemptId);
  assert.equal((await api("/api/verification", { method: "POST", headers: { ...studentAHeaders, origin: appOrigin }, body: JSON.stringify({ experimentalAiAnalysis: true, humanReview: true }) })).response.status, 409, "duplicate creation fails closed");

  const historyA = await api("/api/attempts?userId=verified-student-b", { headers: studentAHeaders });
  const historyB = await api("/api/attempts?userId=verified-student-a", { headers: studentBHeaders });
  assert.deepEqual(historyA.body.attempts.map((item) => item.id), [createdA.body.attemptId]);
  assert.deepEqual(historyB.body.attempts.map((item) => item.id), [createdB.body.attemptId]);
  assert.equal((await api(`/api/attempts/${encodeURIComponent(createdA.body.attemptId)}`, { method: "DELETE", headers: { ...studentBHeaders, origin: appOrigin } })).response.status, 404, "Student B cannot delete Student A's record");
  assert.equal((await api("/api/internal/diagnostic-packet", { method: "POST", headers: studentAHeaders, body: JSON.stringify({ attemptId: createdA.body.attemptId }) })).response.status, 403);
  assert.equal((await fetch(`${appOrigin}/internal/review`, { headers: studentAHeaders })).status, 404);

  const packetResult = await api("/api/internal/diagnostic-packet", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId: createdA.body.attemptId }) });
  assert.equal(packetResult.response.status, 200, JSON.stringify(packetResult.body));
  const packetText = JSON.stringify(packetResult.body.packet);
  assert.doesNotMatch(packetText, /verified-student-a|verified-student-b|@example\.test/);

  const fixture = JSON.parse(await readFile(new URL("../../prototype/fixtures/vnext_synthetic_cases.json", import.meta.url), "utf8")).valid_diagnostic;
  const context = packetResult.body.packet.analysis_context;
  fixture.analysis_id = context.analysis_id;
  fixture.benchmark_case_id = context.case_id;
  fixture.paper = context.paper;
  fixture.marks_available = context.marks_available;
  Object.assign(fixture.diagnostic_model, {
    provider: "OpenAI Codex (manual session)", model: "synthetic-live-auth-verification", reasoning: "test",
    prompt_version: context.prompt_version, taxonomy_version: context.taxonomy_version, paper_rules_version: context.paper_rules_version,
  });

  const imported = await api("/api/internal/diagnostic-import", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId: createdA.body.attemptId, diagnosticText: JSON.stringify(fixture) }) });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.body));
  const approved = await api("/api/review", { method: "POST", headers: reviewerHeaders, body: JSON.stringify({ attemptId: createdA.body.attemptId, decision: "APPROVE", note: "Synthetic live-auth verification" }) });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.releaseStatus, "RELEASED");

  const releasedA = await api("/api/verification", { headers: studentAHeaders });
  assert.equal(releasedA.body.attempts[0].releaseStatus, "RELEASED");
  assert.ok(releasedA.body.attempts[0].studentPayload?.student_view);
  const keys = new Set(allKeys(releasedA.body));
  for (const prohibited of ["rawDiagnostic", "normalisedEvidence", "pipelineResult", "provider", "fixture", "indicative_mark", "tag", "state", "question_key", "provenance"]) assert.equal(keys.has(prohibited), false, prohibited);
  assert.deepEqual((await api("/api/verification", { headers: studentBHeaders })).body.attempts.map((item) => item.id), [createdB.body.attemptId]);

  assert.equal((await api(`/api/attempts/${encodeURIComponent(createdA.body.attemptId)}`, { method: "DELETE", headers: studentAHeaders })).response.status, 422, "student deletion requires a same-origin request");
  const deletedA = await api(`/api/attempts/${encodeURIComponent(createdA.body.attemptId)}`, { method: "DELETE", headers: { ...studentAHeaders, origin: appOrigin } });
  assert.equal(deletedA.response.status, 200, JSON.stringify(deletedA.body));
  assert.equal(deletedA.body.deleted, true);
  assert.deepEqual((await api("/api/attempts", { headers: studentAHeaders })).body.attempts, []);

  assert.equal((await api("/api/internal/verification-cleanup", { method: "POST", headers: { ...studentBHeaders, origin: appOrigin }, body: "{}" })).response.status, 403);
  assert.equal((await api("/api/internal/verification-cleanup", { method: "POST", headers: reviewerHeaders, body: "{}" })).response.status, 422, "same-origin reviewer cleanup is required");
  const cleanup = await api("/api/internal/verification-cleanup", { method: "POST", headers: { ...reviewerHeaders, origin: appOrigin }, body: "{}" });
  assert.equal(cleanup.response.status, 200, JSON.stringify(cleanup.body));
  assert.equal(cleanup.body.deletedAttempts, 1);
  assert.deepEqual((await api("/api/attempts", { headers: studentBHeaders })).body.attempts, []);
  assert.equal((await api("/api/review", { headers: reviewerHeaders })).body.attempts.length, 0);

  app.kill("SIGTERM");
  await Promise.race([once(app, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  children.pop();
  const graphTables = ["question_inputs", "answer_inputs", "submission_consents", "diagnostic_exports", "diagnostic_imports", "diagnostic_results", "normalised_attempt_evidence", "reviews", "feedback"];
  assert.equal(Number(queryRows("SELECT COUNT(*) AS count FROM attempts WHERE id LIKE 'live-verification-%'")[0].count), 0, "all verification attempts must be removed from D1");
  for (const table of graphTables) {
    assert.equal(Number(queryRows(`SELECT COUNT(*) AS count FROM ${table} WHERE attempt_id LIKE 'live-verification-%'`)[0].count), 0, `${table} must contain no verification residue`);
  }
  assert.equal(Number(queryRows("SELECT COUNT(*) AS count FROM users WHERE id IN ('verified-student-a','verified-student-b')")[0].count), 0, "synthetic verification user rows must be removed");
  assert.equal(Number(queryRows("SELECT COUNT(*) AS count FROM attempts WHERE id = 'unrelated-fixture-attempt'")[0].count), 1, "cleanup must preserve unrelated fixture attempts");

  process.stdout.write("Live-auth verification flow passed: exact-two platform identities, expiring independent switch, server-generated content, consent, cross-account isolation, reviewer-only diagnostics, same-origin student deletion with zero D1 graph residue, scoped reviewer cleanup and unchanged real-pilot gate.\n");
} catch (error) {
  if (appOutput) process.stderr.write(appOutput.slice(-8_000));
  throw error;
} finally {
  for (const child of children.reverse()) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(stateDir, { recursive: true, force: true });
}
