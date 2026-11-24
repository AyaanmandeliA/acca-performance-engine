import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { EnrolmentPage } from "@/components/enrolment-page";

export const dynamic = "force-dynamic";

export default async function StudentEnrolmentPage() {
  await requireChatGPTUser("/enrol");
  return <EnrolmentPage />;
}
