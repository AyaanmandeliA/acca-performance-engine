import { loadAnalytics } from "@/lib/repository";
import { accessErrorResponse, requireReviewer } from "@/lib/access-control";

export async function GET(request: Request) {
  try { requireReviewer(request); return Response.json({ analytics: await loadAnalytics() }); }
  catch (error) { return accessErrorResponse(error, "Analytics unavailable"); }
}
