import { z } from "zod";
import { accessErrorResponse, requireReviewer } from "@/lib/access-control";
import { exportDiagnosticPacket } from "@/lib/manual-pipeline-client";
import { loadReviewAttempt, recordDiagnosticExport } from "@/lib/repository";

const schema = z.object({ attemptId: z.string().min(1) }).strict();

export async function POST(request: Request) {
  try {
    const reviewer = requireReviewer(request);
    const { attemptId } = schema.parse(await request.json());
    const attempt = await loadReviewAttempt(attemptId);
    if (attempt.provider !== "MANUAL_CODEX") throw new Error("Manual packets are only available for manual Codex attempts.");
    const result = await exportDiagnosticPacket(attempt);
    await recordDiagnosticExport(attemptId, reviewer.userId, result.packetHash);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /Authentication|access|permission|enrolled/i.test(error.message)) return accessErrorResponse(error, "Packet export access denied");
    return Response.json({ error: error instanceof Error ? error.message : "Diagnostic packet export failed" }, { status: 422 });
  }
}
