import { AccessControlError, accessErrorResponse } from "@/lib/access-control";
import { deleteOwnedAttempt } from "@/lib/repository";
import { requireAuthorisedStudent } from "@/lib/student-authorization";

function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new AccessControlError("A same-origin deletion request is required.", 422);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const actor = await requireAuthorisedStudent(request);
    const { id } = await context.params;
    return Response.json(await deleteOwnedAttempt(id, actor.userId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "Attempt not found.") return Response.json({ error: error.message }, { status: 404 });
    return accessErrorResponse(error, "Attempt could not be deleted");
  }
}
