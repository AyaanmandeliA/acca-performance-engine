import { requireReviewerChatGPTUser } from "@/app/chatgpt-auth";
import { InternalApp } from "@/components/internal-app";

export default async function InternalAnalyticsPage() {
  await requireReviewerChatGPTUser("/internal/analytics");
  return <InternalApp view="analytics" />;
}
