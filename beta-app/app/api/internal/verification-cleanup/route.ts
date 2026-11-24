import { AccessControlError, accessErrorResponse, requireReviewer } from "@/lib/access-control";
import { cleanupLiveVerificationRecords } from "@/lib/repository";

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new Error("A same-origin reviewer request is required.");
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    requireReviewer(request);
    return Response.json(await cleanupLiveVerificationRecords(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessControlError) return accessErrorResponse(error, "Verification cleanup access denied");
    return Response.json({ error: error instanceof Error ? error.message : "Verification cleanup failed safely." }, { status: 422 });
  }
}
