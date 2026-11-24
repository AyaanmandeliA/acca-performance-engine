import { requireReviewerChatGPTUser } from "@/app/chatgpt-auth";
import { EnrolmentAdmin } from "@/components/enrolment-admin";

export default async function InternalEnrolmentPage() {
  await requireReviewerChatGPTUser("/internal/enrolment");
  return <EnrolmentAdmin />;
}
