// Part of ../../PROJECT.md — fail-closed enrolment flow against isolated temporary D1 state.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stateDir = await mkdtemp(join(tmpdir(), "acca-enrolment-flow-"));
const appPort = 8792;
const appOrigin = `http://127.0.0.1:${appPort}`;
const invitedEmails = ["student.one@example.test"];
const identity = (userId, email) => ({ "oai-authenticated-user-id": userId, "oai-authenticated-user-email": email });
const reviewerHeaders = identity("reviewer-1", "reviewer@example.test");
const studentOneHeaders = identity("site-student-1", invitedEmails[0]);
const studentTwoHeaders = identity("site-student-2", "other@example.test");
const uninvitedHeaders = identity("uninvited", "uninvited@example.test");
const children = [];
let appOutput = "";

function command(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
}

async function waitFor(url) {
  let last;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const result = await request(url, { timeout: 2_000 });
      if (result.status < 500) return result;
      last = new Error(`status ${result.status}`);
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw last ?? new Error(`Timed out waiting for ${url}`);
}

function request(url, { headers = {}, body, method = "GET", timeout = 5_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: { "Content-Type": "application/json", ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`Request timed out: ${method} ${url}`)));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function submission() {
  return {
    paper: "SBR",
    questionLabel: "Synthetic same-session enrolment attempt",
    scenarioText: "A fictional reporting entity is assessing the accounting treatment and disclosure of a material transaction.",
    requirementText: "Explain the appropriate accounting treatment and the key disclosure implications.",
    permittedMarkingContext: "Synthetic context only. Assess the visible technical explanation and application.",
    marksAvailable: 20,
    answerText: "The entity should identify the relevant recognition criteria, apply them to the transaction facts, and explain the measurement and disclosure consequences clearly.",
    questionSourceType: "PASTED_TEXT",
    answerSourceType: "PASTED_TEXT",
    consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: "2026-10-13T10:00:00Z" },
  };
}

async function api(path, options = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await request(`${appOrigin}${path}`, options);
      if (!result.text.startsWith("Your worker restarted mid-request")) {
        return { response: { status: result.status }, body: JSON.parse(result.text) };
      }
    } catch (error) {
      if (attempt === 3) throw error;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Worker did not stabilise for ${path}`);
}

try {
  for (const migration of ["0000_talented_bullseye.sql", "0001_petite_iceman.sql", "0002_adorable_azazel.sql"]) {
    command(["./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--file", `drizzle/${migration}`]);
  }

  const app = spawn(process.execPath, [
    "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "dev",
    "--config", "dist/server/wrangler.json", "--local", "--persist-to", stateDir, "--ip", "127.0.0.1", "--port", String(appPort), "--inspector-port", "0",
    "--var", "NODE_ENV:development", "--var", "BETA_SYNTHETIC_MODE:false",
    "--var", "BETA_REAL_PILOT_ENABLED:true", "--var", "BETA_AUTHENTICATION_VERIFIED:true",
    "--var", "BETA_PRIVATE_DEPLOYMENT_VERIFIED:true", "--var", "BETA_PRIVATE_STORAGE_VERIFIED:true",
    "--var", "BETA_WORKER_PIPELINE_VERIFIED:true", "--var", "BETA_REVIEWER_IDS:reviewer-1",
    "--var", "BETA_STUDENT_IDS:site-student-2",
    "--var", "BETA_ENROLMENT_ENABLED:true", "--var", `BETA_INVITED_STUDENT_EMAILS:${invitedEmails.join(",")}`,
    "--var", "BETA_ENROLMENT_HASH_SECRET:synthetic-enrolment-secret-with-at-least-32-characters",
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  children.push(app);
  app.stdout.on("data", (chunk) => { appOutput += chunk.toString(); });
  app.stderr.on("data", (chunk) => { appOutput += chunk.toString(); });
  await waitFor(`${appOrigin}/api/enrolment`);
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  assert.equal((await api("/api/enrolment")).response.status, 401);
  assert.equal((await api("/api/enrolment", { method: "POST", headers: { origin: appOrigin }, body: JSON.stringify({ userId: "site-student-1", email: invitedEmails[0] }) })).response.status, 401);
  assert.equal((await api("/api/enrolment", { method: "POST", headers: { ...uninvitedHeaders, origin: appOrigin }, body: JSON.stringify({ userId: "site-student-1", email: invitedEmails[0] }) })).response.status, 403);
  assert.equal((await api("/api/enrolment", { headers: uninvitedHeaders })).response.status, 403);
  assert.equal((await api("/api/enrolment", { method: "POST", headers: { ...reviewerHeaders, origin: appOrigin }, body: "{}" })).response.status, 403);
  assert.equal((await api("/api/enrolment", { method: "POST", headers: studentOneHeaders, body: "{}" })).response.status, 403, "same-origin POST is mandatory");

  const before = await api("/api/enrolment", { headers: studentOneHeaders });
  assert.equal(before.response.status, 200);
  assert.equal(before.body.enrolled, false);
  assert.equal(before.body.invitedTotal, 1);
  assert.equal(before.body.enrolmentOpen, true);
  assert.equal((await api("/api/attempts", { headers: studentOneHeaders })).response.status, 403, "an invitation alone does not authorize student data APIs");
  const invitedHome = await request(`${appOrigin}/`, { headers: studentOneHeaders });
  assert.equal(invitedHome.status, 200);
  assert.match(invitedHome.text, /Confirm your invited account/);
  const uninvitedHome = await request(`${appOrigin}/`, { headers: uninvitedHeaders });
  assert.equal(uninvitedHome.status, 200);
  assert.match(uninvitedHome.text, /does not have beta access/);
  const enrolled = await api("/api/enrolment", { method: "POST", headers: { ...studentOneHeaders, origin: appOrigin }, body: "{}" });
  assert.equal(enrolled.response.status, 201, JSON.stringify(enrolled.body));
  assert.deepEqual(enrolled.body, { invited: true, enrolled: true, slot: 1, invitedTotal: 1, total: 5, enrolmentOpen: true });
  assert.equal((await api("/api/enrolment", { method: "POST", headers: { ...studentOneHeaders, origin: appOrigin }, body: "{}" })).response.status, 409);

  const own = await api("/api/enrolment", { headers: studentOneHeaders });
  assert.equal(own.body.enrolled, true);
  assert.equal((await api("/api/enrolment", { headers: studentTwoHeaders })).response.status, 403, "uninvited accounts remain isolated");
  assert.equal((await api("/api/enrolment", { headers: identity("site-student-2", invitedEmails[0]) })).response.status, 409, "one invitation cannot bind to a second Site identity");

  const overview = await api("/api/internal/enrolment", { headers: reviewerHeaders });
  assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
  assert.equal(overview.body.invitedCount, 1);
  assert.equal(overview.body.enrolledCount, 1);
  assert.equal(overview.body.slots[0].status, "ENROLLED");
  const overviewText = JSON.stringify(overview.body);
  for (const sensitive of [...invitedEmails, "site-student-1", "inviteKey", "siteUserId"]) assert.equal(overviewText.includes(sensitive), false, sensitive);
  assert.equal((await api("/api/internal/enrolment", { headers: studentOneHeaders })).response.status, 403);
  assert.equal((await api("/api/internal/enrolment")).response.status, 401);

  const analytics = await api("/api/analytics", { headers: reviewerHeaders });
  assert.equal(analytics.response.status, 200, JSON.stringify(analytics.body));
  assert.equal(analytics.body.analytics.studentsInvited, 1);
  assert.equal(analytics.body.analytics.studentsEnrolled, 1);
  assert.equal(analytics.body.analytics.firstSubmissions, 0);
  assert.equal(analytics.body.analytics.completedDiagnostics, 0);
  const analyticsText = JSON.stringify(analytics.body);
  for (const sensitive of [...invitedEmails, "site-student-1", "inviteKey", "siteUserId"]) assert.equal(analyticsText.includes(sensitive), false, sensitive);

  assert.equal((await request(`${appOrigin}/internal/review`, { headers: reviewerHeaders })).status, 200, "reviewer can render the internal route");
  assert.equal((await request(`${appOrigin}/internal/review`, { headers: studentOneHeaders })).status, 404, "student cannot render an internal route");

  const enrolledHome = await request(`${appOrigin}/`, { headers: studentOneHeaders });
  assert.equal(enrolledHome.status, 200);
  assert.match(enrolledHome.text, /Preparing the private beta/, "the enrolled identity reaches the product in the same authenticated session");
  assert.doesNotMatch(enrolledHome.text, /Confirm your invited account|does not have beta access/);
  assert.equal((await api("/api/attempts", { headers: studentOneHeaders })).response.status, 200, "the private D1 binding authorizes the enrolled identity");
  assert.equal((await api("/api/pilot-readiness", { headers: studentOneHeaders })).body.canAcceptRealSubmissions, true);

  const noConsent = submission();
  noConsent.consent.humanReview = false;
  assert.equal((await api("/api/attempts/manual", { method: "POST", headers: studentOneHeaders, body: JSON.stringify(noConsent) })).response.status, 422, "explicit consent remains mandatory");
  const created = await api("/api/attempts/manual", { method: "POST", headers: studentOneHeaders, body: JSON.stringify(submission()) });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const attemptId = created.body.attemptId;
  const ownAttempts = await api("/api/attempts", { headers: studentOneHeaders });
  assert.equal(ownAttempts.body.attempts.length, 1);
  assert.equal(ownAttempts.body.attempts[0].paper, "SBR");
  assert.equal(ownAttempts.body.attempts[0].studentPayload, null, "held diagnostics remain unavailable to the student");
  const isolated = await api("/api/attempts?userId=site-student-1", { headers: studentTwoHeaders });
  assert.equal(isolated.response.status, 200);
  assert.deepEqual(isolated.body.attempts, []);
  assert.equal((await api(`/api/attempts/${attemptId}`, { method: "DELETE", headers: { ...studentTwoHeaders, origin: appOrigin } })).response.status, 404, "another authorized student cannot delete the attempt");
  assert.equal((await api("/api/review", { headers: studentOneHeaders })).response.status, 403, "enrolment must not authorize reviewer APIs");
  assert.equal((await api("/api/analytics", { headers: studentOneHeaders })).response.status, 403, "enrolment must not authorize analytics");
  assert.equal((await api("/api/internal/diagnostic-packet", { method: "POST", headers: studentOneHeaders, body: JSON.stringify({ attemptId: "none" }) })).response.status, 403, "enrolment must not authorize packet export");
  assert.equal((await api("/api/internal/diagnostic-import", { method: "POST", headers: studentOneHeaders, body: JSON.stringify({ attemptId: "none", diagnosticText: "{}" }) })).response.status, 403, "enrolment must not authorize diagnostic import");
  assert.equal((await api(`/api/attempts/${attemptId}`, { method: "DELETE", headers: { ...studentOneHeaders, origin: appOrigin } })).response.status, 200, "the owner can delete the complete attempt graph");
  assert.deepEqual((await api("/api/attempts", { headers: studentOneHeaders })).body.attempts, []);

  process.stdout.write("Progressive enrolment passed: one invited student can bind a platform identity and enter the real pilot in the same session; consent, reviewer denial, cross-student isolation and complete deletion remain enforced.\n");
} catch (error) {
  if (appOutput) process.stderr.write(appOutput.slice(-8_000));
  throw error;
} finally {
  for (const child of children.reverse()) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(stateDir, { recursive: true, force: true });
}
