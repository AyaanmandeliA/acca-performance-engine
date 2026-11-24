import { z } from "zod";
import { AccessControlError, accessErrorResponse, requireStudent } from "@/lib/access-control";
import { LiveAuthVerificationError, liveVerificationAttemptId, makeLiveVerificationInput, requireLiveAuthVerificationStudent } from "@/lib/live-auth-verification";
import { loadLiveVerificationAttempts, saveManualAttempt } from "@/lib/repository";

const consentSchema = z.object({ experimentalAiAnalysis: z.literal(true), humanReview: z.literal(true) }).strict();

function errorResponse(error: unknown) {
  if (error instanceof LiveAuthVerificationError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof AccessControlError) return accessErrorResponse(error, "Verification access denied");
  const status = error instanceof Error && /constraint failed|already exists/i.test(error.message) ? 409 : 422;
  return Response.json({ error: error instanceof Error ? error.message : "Verification failed safely." }, { status, headers: { "Cache-Control": "no-store" } });
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new LiveAuthVerificationError("A same-origin verification request is required.");
}

export async function GET(request: Request) {
  try {
    const actor = requireStudent(request);
    const verification = requireLiveAuthVerificationStudent(actor.userId);
    return Response.json({ active: true, expiresAt: verification.expiresAt, attempts: await loadLiveVerificationAttempts(actor.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const actor = requireStudent(request);
    requireLiveAuthVerificationStudent(actor.userId);
    consentSchema.parse(await request.json());
    if ((await loadLiveVerificationAttempts(actor.userId)).length) throw new LiveAuthVerificationError("A synthetic verification attempt already exists for this identity.", 409);
    const input = makeLiveVerificationInput(actor.userId, new Date().toISOString());
    const attemptId = await liveVerificationAttemptId(actor.userId);
    await saveManualAttempt(actor.userId, input, true, attemptId);
    return Response.json({ attemptId, analysisStatus: "AWAITING_DIAGNOSTIC", reviewStatus: "PENDING", releaseStatus: "HELD" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
