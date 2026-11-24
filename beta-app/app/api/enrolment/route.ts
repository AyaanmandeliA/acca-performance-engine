import { AccessControlError, requirePlatformIdentity } from "@/lib/access-control";
import { EnrolmentError, enrolInvitedIdentity, loadOwnEnrolmentStatus } from "@/lib/enrolment-repository";

function errorResponse(error: unknown): Response {
  if (error instanceof AccessControlError || error instanceof EnrolmentError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "Enrolment is unavailable." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new EnrolmentError("A same-origin enrolment request is required.");
}

export async function GET(request: Request) {
  try {
    return Response.json(await loadOwnEnrolmentStatus(requirePlatformIdentity(request)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const result = await enrolInvitedIdentity(requirePlatformIdentity(request));
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
