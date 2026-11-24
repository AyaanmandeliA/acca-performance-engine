"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export type EnrolmentStatus = { invited: true; enrolled: boolean; slot: number; invitedTotal: number; total: 5; enrolmentOpen: boolean };

async function requestStatus(method = "GET"): Promise<EnrolmentStatus> {
  const response = await fetch("/api/enrolment", { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  const body = await response.json() as EnrolmentStatus & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Enrolment is unavailable.");
  return body;
}

export function EnrolmentPage({ initialStatus = null }: { initialStatus?: EnrolmentStatus | null }) {
  const [status, setStatus] = useState<EnrolmentStatus | null>(initialStatus);
  const [busy, setBusy] = useState(!initialStatus);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialStatus) return;
    requestStatus().then(setStatus).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false));
  }, [initialStatus]);

  const enrol = async () => {
    setBusy(true); setError("");
    try {
      const nextStatus = await requestStatus("POST");
      setStatus(nextStatus);
      window.location.replace("/");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enrolment is unavailable."); }
    finally { setBusy(false); }
  };

  return <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-14 sm:px-8">
    <section className="w-full rounded-2xl border bg-card p-7 shadow-sm sm:p-10">
      <div className="flex items-center gap-3 text-sm font-semibold text-primary"><ShieldCheck className="size-5" /> Private pilot identity check</div>
      <h1 className="mt-6 font-serif text-4xl tracking-tight sm:text-5xl">Confirm your invited account.</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">This one-time check securely links your private invitation to the ChatGPT account you used to sign in. It does not expose your identity to other students or grant access to anyone else&apos;s records.</p>
      <div className="mt-8 rounded-xl border bg-muted/40 p-5 text-sm leading-6"><div className="flex gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" /><p>Your identity comes directly from ChatGPT sign-in. No identity value is requested from your browser or shown on this page.</p></div></div>
      {busy && !status && <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /> Checking this account…</div>}
      {error && <div role="alert" className="mt-8 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      {status?.enrolled ? <div className="mt-8 flex gap-3 border-l-2 border-emerald-600 bg-emerald-50 px-4 py-4 text-sm text-emerald-950"><CheckCircle2 className="size-5 shrink-0" /><div><strong>Invited account confirmed.</strong><p className="mt-1">The owner is completing the final security check. Return to this same link after you are told submissions are open.</p></div></div> : status && status.enrolmentOpen ? <div className="mt-8"><p className="text-sm text-muted-foreground">Your account matches a private beta invitation.</p><Button className="mt-4" disabled={busy} onClick={() => void enrol()}>{busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Confirm invited account</Button></div> : status && <div className="mt-8 border-l-2 border-amber-500 bg-amber-50 px-4 py-4 text-sm text-amber-950"><strong>Your invitation is recognised.</strong><p className="mt-1">Identity confirmation is not open yet. Return to this link after the owner tells you it is ready.</p></div>}
      <p className="mt-8 border-t pt-5 text-xs leading-5 text-muted-foreground">Experimental AFM/SBR private beta · Maximum five active students · Diagnostics are human-reviewed and not instant.</p>
    </section>
  </main>;
}
