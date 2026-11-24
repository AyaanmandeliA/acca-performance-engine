import { z } from "zod";
import { accessErrorResponse, requireReviewer } from "@/lib/access-control";
import { exportDiagnosticPacket, processManualDiagnostic } from "@/lib/manual-pipeline-client";
import { loadReviewAttempt, storeManualDiagnostic } from "@/lib/repository";

const schema = z.object({ attemptId: z.string().min(1), diagnosticText: z.string().min(2).max(500000) }).strict();

export async function POST(request: Request) {
  try {
    const reviewer = requireReviewer(request);
    const { attemptId, diagnosticText } = schema.parse(await request.json());
    let diagnostic: Record<string, unknown>;
    try { diagnostic = JSON.parse(diagnosticText) as Record<string, unknown>; }
    catch { return Response.json({ error: "The imported diagnostic is not valid JSON." }, { status: 422 }); }
    const attempt = await loadReviewAttempt(attemptId);
    if (attempt.provider !== "MANUAL_CODEX") throw new Error("Manual imports are only available for manual Codex attempts.");
    if (attempt.imported) return Response.json({ error: "A diagnostic has already been imported for this attempt." }, { status: 409 });
    const { packet } = await exportDiagnosticPacket(attempt);
    const bundle = await processManualDiagnostic(packet, diagnostic);
    const studentPayload = await storeManualDiagnostic(attemptId, reviewer.userId, diagnostic, bundle);
    return Response.json({ imported: true, studentPayload }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && /Authentication|access|permission|enrolled/i.test(error.message)) return accessErrorResponse(error, "Diagnostic import access denied");
    const status = error instanceof Error && /already been imported|UNIQUE constraint/i.test(error.message) ? 409 : 422;
    return Response.json({ error: error instanceof Error ? error.message : "Diagnostic import failed safely" }, { status });
  }
}
