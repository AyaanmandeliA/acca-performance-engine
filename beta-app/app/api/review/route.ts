import { z } from "zod";
import { accessErrorResponse, requireReviewer } from "@/lib/access-control";
import { applyReview, loadReviewAttempts } from "@/lib/repository";
import { getReviewMode } from "@/lib/review-policy";
import { getPilotReadiness } from "@/lib/pilot-readiness";

export async function GET(request: Request) {
  try {
    requireReviewer(request);
    return Response.json({ attempts: await loadReviewAttempts(), mode: getReviewMode(), samplePercent: 25, pilot: getPilotReadiness() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessErrorResponse(error, "Review queue unavailable"); }
}

const schema = z.object({ attemptId: z.string().min(1), decision: z.enum(["APPROVE", "FLAG", "REJECT"]), note: z.string().max(1500).default("") }).strict();
export async function POST(request: Request) {
  try {
    const reviewer = requireReviewer(request);
    const body = schema.parse(await request.json());
    return Response.json(await applyReview(body.attemptId, reviewer.userId, body.decision, body.note));
  } catch (error) {
    if (error instanceof Error && /Authentication|access|permission|enrolled/i.test(error.message)) return accessErrorResponse(error, "Review access denied");
    return Response.json({ error: error instanceof Error ? error.message : "Review failed" }, { status: 422 });
  }
}
