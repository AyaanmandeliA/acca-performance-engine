"use client";

import { useCallback, useState } from "react";
import { CheckCircle2, Clock3, LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { StudentAttemptSummary } from "@/lib/domain";

export type VerificationState = { active: true; expiresAt: string; attempts: StudentAttemptSummary[] };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Verification is unavailable.");
  return body;
}

export function LiveAuthVerificationPage({ initialState }: { initialState: VerificationState }) {
  const [state, setState] = useState<VerificationState>(initialState);
  const [analysisConsent, setAnalysisConsent] = useState(false);
  const [reviewConsent, setReviewConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setState(await api<VerificationState>("/api/verification"));
  }, []);

  const createAttempt = async () => {
    setBusy(true); setError("");
    try {
      await api("/api/verification", { method: "POST", body: JSON.stringify({ experimentalAiAnalysis: analysisConsent, humanReview: reviewConsent }) });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Verification failed safely."); }
    finally { setBusy(false); }
  };

  const removeAttempt = async (attemptId: string) => {
    setBusy(true); setError("");
    try {
      const result = await api<{ deleted: boolean }>(`/api/attempts/${encodeURIComponent(attemptId)}`, { method: "DELETE" });
      if (!result.deleted) throw new Error("The server did not verify deletion.");
      setState((current) => ({ ...current, attempts: current.attempts.filter((item) => item.id !== attemptId) }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The synthetic record could not be deleted."); }
    finally { setBusy(false); }
  };

  const attempt = state.attempts[0];
  const result = attempt?.studentPayload?.student_view;

  return <main className="mx-auto flex min-h-screen max-w-3xl items-center px-5 py-14 sm:px-8">
    <section className="w-full rounded-2xl border bg-card p-7 shadow-sm sm:p-10">
      <div className="flex items-center gap-3 text-sm font-semibold text-primary"><ShieldCheck className="size-5" /> Live identity verification</div>
      <h1 className="mt-6 font-serif text-4xl tracking-tight sm:text-5xl">Check the private account boundary.</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">This temporary check creates one fictional AFM or SBR attempt entirely on the server. It does not accept uploads, pasted answers or real student work, and it does not open the real pilot.</p>

      {error && <div role="alert" className="mt-7 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      {!attempt && <div className="mt-8 space-y-5">
        <div className="rounded-xl border bg-muted/35 p-5 text-sm leading-6"><strong>What will be stored</strong><p className="mt-1 text-muted-foreground">One clearly labelled synthetic question and answer, your Site-scoped identity, the consent record and the reviewer workflow audit. No email, upload or personal answer is placed in the attempt.</p></div>
        <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={analysisConsent} onCheckedChange={(value) => setAnalysisConsent(value === true)} className="mt-1" /><span>I consent to experimental AI-assisted analysis of this server-generated synthetic attempt.</span></label>
        <label className="flex items-start gap-3 text-sm leading-6"><Checkbox checked={reviewConsent} onCheckedChange={(value) => setReviewConsent(value === true)} className="mt-1" /><span>I consent to human review of this server-generated synthetic attempt.</span></label>
        <Button disabled={busy || !analysisConsent || !reviewConsent} onClick={() => void createAttempt()}>{busy ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />} Create synthetic verification attempt</Button>
      </div>}

      {attempt && <div className="mt-8 rounded-xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Synthetic {attempt.paper} attempt</p><h2 className="mt-2 text-xl font-semibold">{attempt.releaseStatus === "RELEASED" ? "Verification result released" : "Being reviewed"}</h2></div>{attempt.releaseStatus === "RELEASED" ? <CheckCircle2 className="size-6 text-emerald-700" /> : <Clock3 className="size-6 text-amber-700" />}</div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{attempt.releaseStatus === "RELEASED" ? "The reviewer released a student-safe result to this account only." : "The reviewer must export, validate, import and approve the diagnostic. It will not appear instantly."}</p>
        {result && <div className="mt-5 border-l-2 border-emerald-600 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-950"><strong>Released diagnostic</strong><p className="mt-1">{result.diagnostic_summary}</p></div>}
        <Button variant="outline" className="mt-6" disabled={busy} onClick={() => void removeAttempt(attempt.id)}>{busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />} Permanently delete synthetic record</Button>
      </div>}

      <p className="mt-8 border-t pt-5 text-xs leading-5 text-muted-foreground">Verification expires automatically. The real-submission switch remains off throughout this check.</p>
    </section>
  </main>;
}
