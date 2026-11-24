import { AccessControlError, accessErrorResponse } from "@/lib/access-control";
import { requireRealPilotReady } from "@/lib/pilot-readiness";
import { saveManualAttempt } from "@/lib/repository";
import { requireAuthorisedStudent } from "@/lib/student-authorization";
import { analyseInputSchema } from "@/lib/submission-contract";

export async function POST(request: Request) {
  try {
    const actor = await requireAuthorisedStudent(request);
    const input = analyseInputSchema.parse(await request.json());
    const synthetic = actor.source === "SYNTHETIC_LOCAL";
    if (!synthetic) requireRealPilotReady();
    const attemptId = await saveManualAttempt(actor.userId, input, synthetic);
    return Response.json({ attemptId, analysisStatus: "AWAITING_DIAGNOSTIC", reviewStatus: "PENDING", releaseStatus: "HELD" }, { status: 201 });
  } catch (error) {
    if (error instanceof AccessControlError) return accessErrorResponse(error, "Submission access denied");
    return Response.json({ error: error instanceof Error ? error.message : "Submission could not be saved" }, { status: 422 });
  }
}
