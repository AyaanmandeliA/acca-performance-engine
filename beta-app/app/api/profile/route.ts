import { loadAndStoreProfile } from "@/lib/repository";
import { accessErrorResponse } from "@/lib/access-control";
import { requireAuthorisedStudent } from "@/lib/student-authorization";

export async function GET(request: Request) {
  try {
    const actor = await requireAuthorisedStudent(request);
    return Response.json({ profile: await loadAndStoreProfile(actor.userId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return accessErrorResponse(error, "Profile unavailable"); }
}
