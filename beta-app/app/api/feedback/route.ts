import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attempts, feedback } from "@/db/schema";
import { feedbackSchema } from "@/lib/feedback";
import { accessErrorResponse } from "@/lib/access-control";
import { requireAuthorisedStudent } from "@/lib/student-authorization";

export async function POST(request: Request) {
  try {
    const actor = await requireAuthorisedStudent(request);
    const body = feedbackSchema.parse(await request.json()); const db = getDb();
    if (body.userId && body.userId !== actor.userId) return Response.json({ error: "Feedback can only be submitted for the authenticated student's account." }, { status: 403 });
    const [attempt] = await db.select().from(attempts).where(eq(attempts.id, body.attemptId)).limit(1);
    if (!attempt || attempt.userId !== actor.userId) return Response.json({ error: "Attempt not found." }, { status: 404 });
    if (attempt.releaseStatus !== "RELEASED") return Response.json({ error: "Feedback is available only for released diagnostics." }, { status: 409 });
    await db.insert(feedback).values({ id: crypto.randomUUID(), attemptId: body.attemptId, userId: actor.userId, usefulness: body.usefulness, accurateText: body.accurateText, confusingText: body.confusingText, nextWishText: body.nextWishText, reuseIntent: body.reuseIntent }).onConflictDoUpdate({ target: feedback.attemptId, set: { usefulness: body.usefulness, accurateText: body.accurateText, confusingText: body.confusingText, nextWishText: body.nextWishText, reuseIntent: body.reuseIntent, createdAt: new Date().toISOString() } });
    return Response.json({ saved: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /Authentication|access|permission|enrolled/i.test(error.message)) return accessErrorResponse(error, "Feedback access denied");
    return Response.json({ error: error instanceof Error ? error.message : "Feedback could not be saved" }, { status: 422 });
  }
}
