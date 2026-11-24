import { accessErrorResponse, requireReviewer } from "@/lib/access-control";
import { loadEnrolmentOverview } from "@/lib/enrolment-repository";

export async function GET(request: Request) {
  try {
    requireReviewer(request);
    return Response.json(await loadEnrolmentOverview(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return accessErrorResponse(error, "Enrolment status unavailable");
  }
}
