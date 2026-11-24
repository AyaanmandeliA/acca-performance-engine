"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Overview = {
  configured: boolean;
  open: boolean;
  invitedCount: number;
  enrolledCount: number;
  slots: Array<{ slot: number; account: string; status: "ENROLLED" | "PENDING" }>;
  blockers: string[];
};

async function fetchOverview(): Promise<Overview> {
  const response = await fetch("/api/internal/enrolment", { headers: { Accept: "application/json" } });
  const body = await response.json() as Overview & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Enrolment status unavailable.");
  return body;
}

export function EnrolmentAdmin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const body = await fetchOverview();
      setError("");
      setOverview(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Enrolment status unavailable."); }
  }, []);
  useEffect(() => {
    fetchOverview().then(setOverview).catch((reason: Error) => setError(reason.message));
  }, []);

  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-[#0e1d2f] text-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-white text-sm font-bold text-[#0e1d2f]">P</span><div><p className="font-semibold">Performance Engine</p><p className="text-[10px] uppercase tracking-[0.16em] text-white/60">Internal · private pilot</p></div></div><nav className="flex flex-wrap items-center gap-2" aria-label="Internal navigation"><Link href="/internal/review" className="rounded-full px-4 py-2 text-sm font-medium text-white/75 hover:bg-white/10">Review</Link><Link href="/internal/analytics" className="rounded-full px-4 py-2 text-sm font-medium text-white/75 hover:bg-white/10">Analytics</Link><Link href="/internal/enrolment" className="rounded-full bg-white px-4 py-2 text-sm font-medium text-[#0e1d2f]">Enrolment</Link><Link href="/" className="rounded-full px-4 py-2 text-sm font-medium text-white/75 hover:bg-white/10">Student experience</Link></nav></div></header>
    <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Owner only</p><h1 className="page-title">Student enrolment</h1><p className="page-lede">Confirm invited ChatGPT accounts progressively, up to five active students, without displaying Site identity IDs.</p></div><Button variant="outline" onClick={() => void refresh()}><RefreshCw /> Refresh</Button></div>
      {error && <div role="alert" className="mt-7 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>}
      {!overview ? <div className="mt-12 flex items-center gap-3 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /> Loading enrolment status…</div> : <>
        <div className="mt-10 grid gap-4 sm:grid-cols-3"><Metric label="Invited slots" value={`${overview.invitedCount}/5`} /><Metric label="Enrolled" value={`${overview.enrolledCount}/5`} /><Metric label="Window" value={overview.open ? "Open" : "Closed"} /></div>
        {!overview.open && <div className="mt-7 border-l-2 border-amber-500 bg-amber-50 px-5 py-4 text-sm text-amber-950"><strong>Enrolment remains fail-closed.</strong><ul className="mt-2 list-disc space-y-1 pl-5">{overview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
        <div className="mt-8 overflow-hidden rounded-2xl border bg-card">{overview.slots.length ? overview.slots.map((slot) => <div key={slot.slot} className="flex items-center justify-between gap-4 border-b p-5 last:border-0"><div><p className="eyebrow">Student {slot.slot}</p><p className="mt-1 font-semibold">{slot.account}</p></div><Badge variant="outline" className={slot.status === "ENROLLED" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}>{slot.status === "ENROLLED" ? <CheckCircle2 className="mr-1 size-3" /> : <Clock3 className="mr-1 size-3" />}{slot.status === "ENROLLED" ? "Enrolled" : "Pending"}</Badge></div>) : <div className="p-8 text-center text-sm text-muted-foreground"><ShieldCheck className="mx-auto mb-3 size-6 text-primary" />Configure one invited account to start, then add approved students later up to the five-student limit.</div>}</div>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">Site-scoped identity IDs are stored only in managed D1 and are never returned by this view. Enrolment does not add an identity to the production student allowlist.</p>
      </>}
    </main>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-t bg-card/50 p-6"><p className="font-serif text-4xl">{value}</p><p className="mt-2 text-sm text-muted-foreground">{label}</p></div>; }
