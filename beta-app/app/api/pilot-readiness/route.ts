import { accessErrorResponse } from "@/lib/access-control";
import { getPilotReadiness } from "@/lib/pilot-readiness";
import { actorFromRequestWithEnrolment } from "@/lib/student-authorization";

export async function GET(request: Request) {
  try {
    const actor = await actorFromRequestWithEnrolment(request);
    const readiness = getPilotReadiness();
    return Response.json(actor.role === "REVIEWER" ? readiness : {
      pilotEnabled: readiness.pilotEnabled,
      canAcceptRealSubmissions: readiness.canAcceptRealSubmissions,
      mode: readiness.mode,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessErrorResponse(error, "Pilot status unavailable"); }
}
