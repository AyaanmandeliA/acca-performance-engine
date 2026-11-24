import { BetaApp } from "@/components/beta-app";
import { EnrolmentPage, type EnrolmentStatus } from "@/components/enrolment-page";
import { LiveAuthVerificationPage, type VerificationState } from "@/components/live-auth-verification-page";
import { PilotAccessStatus } from "@/components/pilot-access-status";
import { isSyntheticLocal } from "@/lib/access-control";
import { isEnrolledSiteIdentity, loadOwnEnrolmentStatus } from "@/lib/enrolment-repository";
import { getLiveAuthVerification } from "@/lib/live-auth-verification";
import { getPilotReadiness } from "@/lib/pilot-readiness";
import { loadLiveVerificationAttempts } from "@/lib/repository";
import { resolveStudentEntry } from "@/lib/student-entry";
import { redirect } from "next/navigation";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const { student } = await searchParams;
  if (isSyntheticLocal()) {
    const userId = student === "student-b" || student === "local-student" ? student : "student-a";
    return <BetaApp userId={userId} />;
  }

  const user = await requireChatGPTUser("/");
  const entry = resolveStudentEntry(user.userId);
  if (entry === "REVIEWER") redirect("/internal/review");
  if (entry === "VERIFICATION_STUDENT") {
    const verification = getLiveAuthVerification();
    const initialState: VerificationState = { active: true, expiresAt: verification.expiresAt!, attempts: await loadLiveVerificationAttempts(user.userId) };
    return <LiveAuthVerificationPage initialState={initialState} />;
  }
  if (entry === "ACTIVE_STUDENT") return <BetaApp userId={user.userId} />;
  if (entry === "WAITING_STUDENT") return <PilotAccessStatus status="WAITING" />;
  if (await isEnrolledSiteIdentity(user.userId)) {
    return getPilotReadiness().canAcceptRealSubmissions
      ? <BetaApp userId={user.userId} />
      : <PilotAccessStatus status="WAITING" />;
  }

  let status: EnrolmentStatus;
  try {
    status = await loadOwnEnrolmentStatus({ userId: user.userId, email: user.email });
  } catch {
    return <PilotAccessStatus status="NOT_INVITED" />;
  }
  return <EnrolmentPage initialStatus={status} />;
}
