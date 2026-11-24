import { ensureDemoData, loadUsers } from "@/lib/repository";
import { accessErrorResponse, actorFromRequest, isSyntheticLocal } from "@/lib/access-control";

export async function POST(request: Request) {
  try {
    if (!isSyntheticLocal()) return Response.json({ error: "Demo setup is unavailable." }, { status: 404 });
    actorFromRequest(request);
    await ensureDemoData();
    return Response.json({ users: await loadUsers(), provider: "MOCK_FIXTURE", fixture: true });
  } catch (error) { return accessErrorResponse(error, "Demo setup failed"); }
}
