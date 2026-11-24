import { requireReviewerChatGPTUser } from "@/app/chatgpt-auth";
import { InternalApp } from "@/components/internal-app";

export default async function InternalReviewPage() {
  await requireReviewerChatGPTUser("/internal/review");
  return <InternalApp view="review" />;
}
