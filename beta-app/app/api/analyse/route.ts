import { AccessControlError, accessErrorResponse, requireStudent } from "@/lib/access-control";
import { getDiagnosticProvider } from "@/lib/diagnostic-provider";
import { analyseInputSchema } from "@/lib/submission-contract";

export async function POST(request: Request) {
  try {
    const actor = requireStudent(request);
    if (actor.source !== "SYNTHETIC_LOCAL") {
      throw new AccessControlError("Fixture analysis is available only in the local synthetic preview.", 404);
    }
    const input = analyseInputSchema.parse(await request.json());
    const result = await getDiagnosticProvider().analyse(input);
    return Response.json({ result, notice: "Development fixture result — no live AI provider is connected." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed safely";
    if (error instanceof AccessControlError) return accessErrorResponse(error, "Analysis access denied");
    return Response.json({ error: message }, { status: message.includes("Unsupported") ? 400 : 422 });
  }
}
