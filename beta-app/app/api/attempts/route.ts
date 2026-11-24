import { z } from "zod";
import { accessErrorResponse, requireStudent } from "@/lib/access-control";
import { loadStudentAttempts, saveAttempt } from "@/lib/repository";
import { requireAuthorisedStudent } from "@/lib/student-authorization";
import { analyseInputSchema } from "@/lib/submission-contract";

export async function GET(request: Request) {
  try {
    const actor = await requireAuthorisedStudent(request);
    return Response.json({ attempts: await loadStudentAttempts(actor.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessErrorResponse(error, "History unavailable"); }
}

const saveSchema = z.object({ userId: z.string().min(1).optional(), input: analyseInputSchema, analysis: z.record(z.string(), z.unknown()) }).strict();
export async function POST(request: Request) {
  try {
    const actor = requireStudent(request);
    if (actor.source !== "SYNTHETIC_LOCAL") {
      return Response.json({ error: "Fixture attempt saves are unavailable outside the local synthetic preview." }, { status: 404 });
    }
    const body = saveSchema.parse(await request.json());
    if (body.userId && body.userId !== actor.userId) return Response.json({ error: "Attempts can only be saved to the authenticated student's account." }, { status: 403 });
    const attemptId = await saveAttempt(actor.userId, body.input, body.analysis as never);
    return Response.json({ attemptId, reviewStatus: "PENDING", releaseStatus: "HELD" }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /Authentication|access|permission|enrolled/i.test(error.message)) return accessErrorResponse(error, "Attempt access denied");
    return Response.json({ error: error instanceof Error ? error.message : "Attempt could not be saved" }, { status: 422 });
  }
}
