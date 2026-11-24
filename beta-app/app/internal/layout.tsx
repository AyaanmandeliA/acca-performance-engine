import { isSyntheticLocal } from "@/lib/access-control";
import { requireChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  if (!isSyntheticLocal()) {
    const user = await requireChatGPTUser("/internal/review");
    const reviewers = new Set((process.env.BETA_REVIEWER_IDS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    if (!reviewers.has(user.userId)) {
      return <main className="grid min-h-screen place-items-center px-6 text-center"><div><h1 className="font-serif text-4xl">Reviewer access required</h1><p className="mt-3 text-muted-foreground">This authenticated account is not on the server-side reviewer allowlist.</p></div></main>;
    }
  }
  return children;
}

