import { Clock3, LockKeyhole, ShieldCheck } from "lucide-react";

export function PilotAccessStatus({ status }: { status: "WAITING" | "NOT_INVITED" }) {
  const waiting = status === "WAITING";
  const Icon = waiting ? Clock3 : LockKeyhole;
  return <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-14 sm:px-8">
    <section className="w-full rounded-2xl border bg-card p-7 shadow-sm sm:p-10">
      <div className="flex items-center gap-3 text-sm font-semibold text-primary"><ShieldCheck className="size-5" /> Private AFM/SBR beta</div>
      <span className="mt-8 grid size-12 place-items-center rounded-full bg-muted text-primary"><Icon className="size-6" /></span>
      <h1 className="mt-5 font-serif text-4xl tracking-tight sm:text-5xl">{waiting ? "Your account is confirmed." : "This account does not have beta access."}</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{waiting
        ? "Real submissions are not open for this account yet. The owner is completing the final identity and security checks. Return to this same link after you are told the beta is open."
        : "Access is limited to approved participants. If you received an invitation, sign in with the same ChatGPT account that was invited or contact the beta owner."}</p>
      <div className="mt-8 border-l-2 border-accent bg-muted/40 px-5 py-4 text-sm leading-6 text-muted-foreground">No answer has been submitted or stored. Diagnostics are manually reviewed and will not appear instantly after the beta opens.</div>
    </section>
  </main>;
}
