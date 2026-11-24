"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Clipboard, Download, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ReviewAttempt } from "@/lib/domain";
import { buildPortfolioCaseStudy, type PortfolioAnalytics } from "@/lib/portfolio-evidence";

type InternalView = "review" | "analytics";
type Analytics = PortfolioAnalytics & {
  betaUsers: number; attemptsSubmitted: number; analysesCompleted: number; secondAttemptRate: number; attemptsPerUser: number;
  usefulness: { yes: number; partly: number; no: number }; papers: { AFM: number; SBR: number };
  confidence: { HIGH: number; MEDIUM: number; LOW: number }; review: { approved: number; flagged: number; rejected: number; pending: number };
  weaknessCategories: Array<{ category: string; count: number }>;
  readiness: PilotReadiness;
};
type PilotReadiness = { pilotEnabled: boolean; canAcceptRealSubmissions: boolean; mode: "SYNTHETIC_ONLY" | "REAL_PILOT"; blockers: string[] };

function api<T>(url: string, options?: RequestInit): Promise<T> {
  return fetch(url, { headers: { "Content-Type": "application/json", ...options?.headers }, ...options }).then(async (response) => {
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error || "Something went wrong");
    return body;
  });
}

function readable(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function InternalStatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : status === "REJECTED" ? "bg-red-50 text-red-800 border-red-200" : "bg-amber-50 text-amber-900 border-amber-200";
  return <Badge variant="outline" className={tone}>{readable(status)}</Badge>;
}

export function InternalApp({ view }: { view: InternalView }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState<ReviewAttempt[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [pilot, setPilot] = useState<PilotReadiness | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [previewStudent, setPreviewStudent] = useState("student-a");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const [reviewResult, analyticsResult] = await Promise.all([
      api<{ attempts: ReviewAttempt[]; pilot: PilotReadiness }>("/api/review?userId=local-reviewer"),
      api<{ analytics: Analytics }>("/api/analytics?userId=local-reviewer"),
    ]);
    setAttempts(reviewResult.attempts);
    setAnalytics(analyticsResult.analytics);
    setPilot(reviewResult.pilot);
  }, []);

  useEffect(() => {
    const initialise = async () => {
      try {
        if (process.env.NODE_ENV !== "production") await api("/api/demo?userId=local-reviewer", { method: "POST" });
        await refresh();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Internal tools are unavailable"); }
      finally { setLoading(false); }
    };
    void initialise();
  }, [refresh]);

  const pending = attempts.filter((item) => item.reviewStatus === "PENDING");
  const selected = attempts.find((item) => item.id === selectedId) ?? pending[0] ?? attempts[0];
  const decide = async (decision: "APPROVE" | "FLAG" | "REJECT") => {
    if (!selected) return;
    setBusy(true);
    try {
      await api("/api/review?userId=local-reviewer", { method: "POST", body: JSON.stringify({ attemptId: selected.id, decision, note }) });
      setNote("");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="grid min-h-screen place-items-center"><div className="text-center"><LoaderCircle className="mx-auto size-8 animate-spin text-primary" /><p className="mt-3 font-semibold">Loading internal tools…</p></div></main>;

  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b bg-[#0e1d2f] text-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-white text-sm font-bold text-[#0e1d2f]">P</span><div><p className="font-semibold">Performance Engine</p><p className="text-[10px] uppercase tracking-[0.16em] text-white/60">Internal · private pilot</p></div></div><nav className="flex flex-wrap items-center gap-2" aria-label="Internal navigation"><Link href="/internal/review" className={`rounded-full px-4 py-2 text-sm font-medium ${view === "review" ? "bg-white text-[#0e1d2f]" : "text-white/75 hover:bg-white/10"}`}>Review</Link><Link href="/internal/analytics" className={`rounded-full px-4 py-2 text-sm font-medium ${view === "analytics" ? "bg-white text-[#0e1d2f]" : "text-white/75 hover:bg-white/10"}`}>Analytics</Link><Link href="/internal/enrolment" className="rounded-full px-4 py-2 text-sm font-medium text-white/75 hover:bg-white/10">Enrolment</Link><Link href="/" className="rounded-full px-4 py-2 text-sm font-medium text-white/75 hover:bg-white/10">Student experience</Link></nav></div></header>
    <div className="border-b bg-card"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8"><div className="flex items-center gap-2 text-muted-foreground"><ShieldCheck className="size-4 text-emerald-700" /> Reviewer-authorised internal tools</div>{process.env.NODE_ENV !== "production" && <div className="flex flex-wrap items-center gap-2"><label htmlFor="preview-student" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Synthetic preview</label><select id="preview-student" value={previewStudent} onChange={(event) => setPreviewStudent(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm"><option value="student-a">Student A</option><option value="student-b">Student B</option><option value="local-student">Local student</option></select><Button size="sm" variant="outline" onClick={() => router.push(`/?student=${previewStudent}`)}>Open student view</Button></div>}</div></div>
    {error && <div role="alert" className="mx-auto mt-5 flex max-w-3xl items-center justify-between gap-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X className="size-4" /></button></div>}
    {view === "review" ? <ReviewView attempts={attempts} selected={selected} selectedId={selectedId} setSelectedId={setSelectedId} note={note} setNote={setNote} pendingCount={pending.length} busy={busy} decide={decide} refresh={refresh} pilot={pilot} onError={setError} /> : <AnalyticsView analytics={analytics} />}
  </div>;
}

function ReviewView({ attempts, selected, selectedId, setSelectedId, note, setNote, pendingCount, busy, decide, refresh, pilot, onError }: { attempts: ReviewAttempt[]; selected?: ReviewAttempt; selectedId: string | null; setSelectedId: (id: string) => void; note: string; setNote: (note: string) => void; pendingCount: number; busy: boolean; decide: (decision: "APPROVE" | "FLAG" | "REJECT") => void; refresh: () => Promise<void>; pilot: PilotReadiness | null; onError: (message: string) => void }) {
  return <main className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Internal only</p><h1 className="page-title">Human review queue</h1><p className="page-lede">Export an anonymised packet, import the strict diagnostic, inspect the validated result, then decide what can be released.</p></div><Badge variant="outline" className="w-fit">{pendingCount} pending</Badge></div>{pilot && !pilot.canAcceptRealSubmissions && <div className="mt-7 border-l-2 border-amber-500 bg-amber-50 px-5 py-4 text-sm text-amber-950"><strong>Real pilot disabled — synthetic workflow only.</strong><ul className="mt-2 list-disc space-y-1 pl-5">{pilot.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}<div className="mt-10 grid gap-6 lg:grid-cols-[320px_1fr]"><aside className="space-y-2">{attempts.map((attempt) => <button key={attempt.id} onClick={() => setSelectedId(attempt.id)} className={`w-full rounded-xl border p-4 text-left ${selected?.id === attempt.id || (!selectedId && selected?.id === attempt.id) ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}><div className="flex items-center justify-between gap-3"><Badge variant="outline">{attempt.paper}</Badge><InternalStatusBadge status={attempt.reviewStatus} /></div><p className="mt-3 font-semibold">{attempt.questionLabel}</p><p className="mt-1 text-xs text-muted-foreground">{readable(attempt.analysisStatus)} · {dateLabel(attempt.createdAt)}</p></button>)}</aside>{selected ? <AttemptReviewPanel key={selected.id} selected={selected} note={note} setNote={setNote} busy={busy} decide={decide} refresh={refresh} onError={onError} /> : <InternalEmpty title="Review queue is empty" description="Newly submitted attempts will be held here." action="Refresh" onAction={() => void refresh()} />}</div></main>;
}

function AttemptReviewPanel({ selected, note, setNote, busy, decide, refresh, onError }: { selected: ReviewAttempt; note: string; setNote: (note: string) => void; busy: boolean; decide: (decision: "APPROVE" | "FLAG" | "REJECT") => void; refresh: () => Promise<void>; onError: (message: string) => void }) {
  const [packet, setPacket] = useState("");
  const [prompt, setPrompt] = useState("");
  const [diagnosticText, setDiagnosticText] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const manualHandoffAvailable = selected.provider === "MANUAL_CODEX";
  const exportPacket = async () => {
    setWorking(true); setNotice("");
    try {
      const result = await api<{ packet: unknown; promptText: string }>("/api/internal/diagnostic-packet?userId=local-reviewer", { method: "POST", body: JSON.stringify({ attemptId: selected.id }) });
      setPacket(JSON.stringify(result.packet, null, 2)); setPrompt(result.promptText); setNotice("Packet ready. It contains no student identity.");
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Packet export failed"); }
    finally { setWorking(false); }
  };
  const copy = async (value: string, label: string) => { try { await navigator.clipboard.writeText(value); setNotice(`${label} copied.`); } catch { onError("Clipboard access was unavailable. Select and copy the text manually."); } };
  const download = () => { const blob = new Blob([prompt], { type: "text/plain" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${selected.paper}-${selected.id}-codex-prompt.txt`; anchor.click(); URL.revokeObjectURL(url); };
  const importDiagnostic = async () => {
    setWorking(true); setNotice("");
    try {
      await api("/api/internal/diagnostic-import?userId=local-reviewer", { method: "POST", body: JSON.stringify({ attemptId: selected.id, diagnosticText }) });
      setNotice("Diagnostic passed strict schema validation and the validated downstream pipeline.");
      await refresh();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Diagnostic import failed safely"); }
    finally { setWorking(false); }
  };
  const cleanupVerification = async () => {
    setWorking(true); setNotice("");
    try {
      const result = await api<{ deletedAttempts: number }>("/api/internal/verification-cleanup", { method: "POST", body: "{}" });
      setNotice(`${result.deletedAttempts} verification attempt${result.deletedAttempts === 1 ? "" : "s"} permanently deleted and verified.`);
      await refresh();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Verification cleanup failed safely"); }
    finally { setWorking(false); }
  };
  return <section className="min-w-0 rounded-2xl border bg-card p-5 sm:p-8"><div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Anonymous attempt · {selected.paper}</p><h2 className="mt-2 font-serif text-3xl">{selected.questionLabel}</h2><p className="mt-2 text-sm text-muted-foreground">{readable(selected.analysisStatus)} · Diagnostic confidence: {readable(selected.diagnosticConfidence)} · Uncertainty notices: {selected.studentPayload?.student_view?.uncertainty_notices.length ?? 0}</p></div><InternalStatusBadge status={selected.reviewStatus} /></div>{notice && <p className="mb-5 border-l-2 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">{notice}</p>}<Tabs defaultValue={selected.studentPayload ? "student" : "submission"}><TabsList className="max-w-full flex-wrap"><TabsTrigger value="submission">Submission</TabsTrigger><TabsTrigger value="handoff">Codex handoff</TabsTrigger><TabsTrigger value="student">Student preview</TabsTrigger><TabsTrigger value="raw">Raw diagnostic</TabsTrigger><TabsTrigger value="normalised">Normalised evidence</TabsTrigger></TabsList><TabsContent value="submission" className="mt-5"><div className="space-y-5"><TextPanel label="Scenario" value={selected.submission.scenarioText} /><TextPanel label="Requirement" value={selected.submission.requirementText} /><TextPanel label="Permitted marking context" value={selected.submission.permittedMarkingContext ?? "None supplied."} /><TextPanel label="Student answer" value={selected.submission.answerText} /></div></TabsContent><TabsContent value="handoff" className="mt-5">{manualHandoffAvailable ? <><div className="rounded-xl border bg-muted/30 p-5"><h3 className="font-semibold">1. Export for a separate Codex task</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">The packet contains the submission and only the approved v0.2 schema, taxonomy, paper rules, credit-ledger, safeguards and uncertainty context. Identity is omitted.</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled={working} onClick={exportPacket}>{working ? <LoaderCircle className="animate-spin" /> : <Clipboard />} Build packet</Button><Button variant="outline" disabled={!prompt} onClick={() => void copy(prompt, "Codex prompt")}><Clipboard /> Copy Codex prompt</Button><Button variant="outline" disabled={!packet} onClick={() => void copy(packet, "Packet JSON")}><Clipboard /> Copy packet JSON</Button><Button variant="outline" disabled={!prompt} onClick={download}><Download /> Download prompt</Button></div>{prompt && <Textarea value={prompt} readOnly className="mt-4 min-h-40 font-mono text-xs" />}</div><div className="mt-5 rounded-xl border bg-muted/30 p-5"><h3 className="font-semibold">2. Import the returned diagnostic JSON</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Invalid JSON, schema violations, packet mismatches and duplicate imports fail closed. A valid import is normalised and processed by the Python Weakness Engine before preview.</p><Textarea value={diagnosticText} onChange={(event) => setDiagnosticText(event.target.value)} className="mt-4 min-h-72 font-mono text-xs" placeholder="Paste only the diagnostic JSON returned by Codex…" /><Button className="mt-4" disabled={working || diagnosticText.trim().length < 2 || selected.imported} onClick={() => void importDiagnostic()}>{working ? <LoaderCircle className="animate-spin" /> : <Upload />} {selected.imported ? "Diagnostic already imported" : "Validate & process import"}</Button></div></> : <EmptyPanel>This is a synthetic fixture result. Manual Codex export and import are available only for manual submissions.</EmptyPanel>}</TabsContent><TabsContent value="student" className="mt-5">{selected.studentPayload?.student_view ? <JsonPanel value={selected.studentPayload.student_view} /> : <EmptyPanel>Import a validated diagnostic to preview the student result.</EmptyPanel>}</TabsContent><TabsContent value="raw" className="mt-5">{selected.rawDiagnostic ? <JsonPanel value={selected.rawDiagnostic} /> : <EmptyPanel>No raw diagnostic has been imported.</EmptyPanel>}</TabsContent><TabsContent value="normalised" className="mt-5">{selected.normalisedEvidence ? <JsonPanel value={selected.normalisedEvidence} /> : <EmptyPanel>No normalised evidence is available.</EmptyPanel>}</TabsContent></Tabs>{selected.fixture && selected.questionLabel.startsWith("Live identity verification — ") && <div className="mt-7 border-t pt-6"><div className="rounded-xl border border-red-200 bg-red-50 p-5"><h3 className="font-semibold text-red-950">Verification data cleanup</h3><p className="mt-2 text-sm leading-6 text-red-900">Permanently delete every fixture-labelled live-verification attempt and its complete diagnostic graph. Unrelated attempts are not selected.</p><AlertDialog><AlertDialogTrigger asChild><Button className="mt-4" variant="destructive" disabled={working}><Trash2 /> Delete verification records</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete all verification records?</AlertDialogTitle><AlertDialogDescription>This permanently removes only fixture-labelled live identity verification attempts and their question, answer, consent, diagnostic, review and feedback records. It cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void cleanupVerification()}>Delete verification records</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>}{selected.reviewStatus === "PENDING" && <div className="mt-7 border-t pt-6"><label className="text-sm font-semibold">Reviewer note <span className="font-normal text-muted-foreground">(optional)</span></label><Textarea className="mt-2 min-h-24" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record why you approved, flagged or rejected this output…" /><div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy || !selected.studentPayload} onClick={() => decide("APPROVE")}><Check /> Approve & release</Button><Button disabled={busy} variant="outline" onClick={() => decide("FLAG")}><CircleAlert /> Flag & hold</Button><Button disabled={busy} variant="destructive" onClick={() => decide("REJECT")}><X /> Reject</Button></div>{!selected.studentPayload && <p className="mt-3 text-xs text-muted-foreground">Approval stays disabled until a validated diagnostic has been imported. Flag and reject remain available.</p>}</div>}</section>;
}

function TextPanel({ label, value }: { label: string; value: string }) { return <section><p className="eyebrow">{label}</p><div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border bg-background p-4 text-sm leading-6">{value}</div></section>; }
function EmptyPanel({ children }: { children: React.ReactNode }) { return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>; }

function JsonPanel({ value }: { value: unknown }) { return <pre className="max-h-[560px] overflow-auto rounded-xl bg-[#0e1d2f] p-5 text-xs leading-6 text-slate-100">{JSON.stringify(value, null, 2)}</pre>; }

function AnalyticsView({ analytics }: { analytics: Analytics | null }) {
  if (!analytics) return <InternalEmpty title="Analytics unavailable" description="Local beta telemetry could not be loaded." action="Reload" onAction={() => window.location.reload()} />;
  const usefulnessTotal = analytics.usefulness.yes + analytics.usefulness.partly + analytics.usefulness.no;
  const reportedUsefulness = usefulnessTotal ? `${Math.round(analytics.reportedUsefulResponses / usefulnessTotal * 100)}%` : "—";
  const exportEvidence = (format: "json" | "markdown") => {
    const generatedAt = new Date().toISOString();
    const aggregate = {
      generatedAt, scope: "AFM/SBR private beta", excludesSyntheticFixtures: true,
      studentsInvited: analytics.studentsInvited, studentsEnrolled: analytics.studentsEnrolled,
      firstSubmissions: analytics.firstSubmissions, completedDiagnostics: analytics.completedDiagnostics,
      feedbackRatings: analytics.usefulness, studentsReturningForSecondAttempt: analytics.studentsReturningForSecondAttempt,
      reportedUsefulResponses: analytics.reportedUsefulResponses, feedbackResponses: analytics.feedbackResponses,
      usabilityIssueReports: analytics.usabilityIssueReports, commonUsabilityProblems: analytics.usabilityThemes,
      changesFollowingFeedback: analytics.changesFollowingFeedback,
    };
    const content = format === "json" ? `${JSON.stringify(aggregate, null, 2)}\n` : buildPortfolioCaseStudy(analytics, generatedAt);
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/markdown" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `acca-performance-engine-evidence.${format === "json" ? "json" : "md"}`; anchor.click(); URL.revokeObjectURL(url);
  };
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Owner-only portfolio evidence</p><h1 className="page-title">Pilot evidence, without surveillance.</h1><p className="page-lede">First-party aggregate measures from managed D1. Synthetic fixtures are excluded and no student identities or answers are exported.</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => exportEvidence("json")}><Download /> Export metrics</Button><Button variant="outline" onClick={() => exportEvidence("markdown")}><Download /> Export case study</Button></div></div>{!analytics.readiness.canAcceptRealSubmissions && <div className="mt-7 border-l-2 border-amber-500 bg-amber-50 px-5 py-4 text-sm text-amber-950"><strong>Release gate closed.</strong> Real submissions remain disabled until every authentication and isolation check passes.</div>}<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Students invited" value={`${analytics.studentsInvited}/5`} /><Metric label="Students enrolled" value={`${analytics.studentsEnrolled}/5`} /><Metric label="First submissions" value={String(analytics.firstSubmissions)} /><Metric label="Completed diagnostics" value={String(analytics.completedDiagnostics)} /><Metric label="Feedback ratings" value={String(analytics.feedbackResponses)} /><Metric label="Returned for attempt two" value={String(analytics.studentsReturningForSecondAttempt)} /><Metric label="Reported useful" value={reportedUsefulness} /><Metric label="Usability reports" value={String(analytics.usabilityIssueReports)} /></div><div className="mt-8 grid gap-6 lg:grid-cols-2"><AnalyticsPanel title="Review outcomes"><Bar label="Approved" value={analytics.review.approved} total={analytics.attemptsSubmitted} /><Bar label="Pending" value={analytics.review.pending} total={analytics.attemptsSubmitted} /><Bar label="Flagged" value={analytics.review.flagged} total={analytics.attemptsSubmitted} /><Bar label="Rejected" value={analytics.review.rejected} total={analytics.attemptsSubmitted} />{!analytics.attemptsSubmitted && <p className="mt-4 text-sm text-muted-foreground">No genuine submissions yet.</p>}</AnalyticsPanel><AnalyticsPanel title="Feedback ratings"><Bar label="Yes" value={analytics.usefulness.yes} total={usefulnessTotal} /><Bar label="Partly" value={analytics.usefulness.partly} total={usefulnessTotal} /><Bar label="No" value={analytics.usefulness.no} total={usefulnessTotal} />{!usefulnessTotal && <p className="mt-4 text-sm text-muted-foreground">No genuine feedback submitted yet.</p>}</AnalyticsPanel><AnalyticsPanel title="Common usability problems">{analytics.usabilityThemes.map((item) => <Bar key={item.theme} label={item.theme} value={item.count} total={analytics.usabilityIssueReports} />)}{!analytics.usabilityThemes.length && <p className="text-sm text-muted-foreground">No usability problems have been reported yet. Free-text issue reports are classified into fixed themes without exporting the text.</p>}</AnalyticsPanel><AnalyticsPanel title="Changes following feedback">{analytics.changesFollowingFeedback.map((item) => <div key={`${item.date}-${item.change}`} className="border-l-2 border-accent pl-4"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm">{dateLabel(item.date)}</strong><Badge variant="outline">{readable(item.status)}</Badge></div><p className="mt-2 text-sm leading-6">{item.change}</p><p className="mt-1 text-xs text-muted-foreground">{item.source}</p></div>)}</AnalyticsPanel><AnalyticsPanel title="Paper coverage"><Bar label="AFM" value={analytics.papers.AFM} total={analytics.attemptsSubmitted} /><Bar label="SBR" value={analytics.papers.SBR} total={analytics.attemptsSubmitted} /></AnalyticsPanel><AnalyticsPanel title="Diagnostic confidence"><Bar label="High" value={analytics.confidence.HIGH} total={analytics.attemptsSubmitted} /><Bar label="Medium" value={analytics.confidence.MEDIUM} total={analytics.attemptsSubmitted} /><Bar label="Low" value={analytics.confidence.LOW} total={analytics.attemptsSubmitted} /></AnalyticsPanel></div></main>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-t bg-card/50 p-6"><p className="font-serif text-4xl">{value}</p><p className="mt-2 text-sm text-muted-foreground">{label}</p></div>; }
function AnalyticsPanel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border-t bg-card/50 p-6 sm:p-8"><h2 className="font-serif text-2xl">{title}</h2><div className="mt-6 space-y-4">{children}</div></section>; }
function Bar({ label, value, total }: { label: string; value: number; total: number }) { const width = total ? Math.max(value / total * 100, value ? 4 : 0) : 0; return <div><div className="mb-2 flex justify-between text-sm"><span>{label}</span><strong>{value}</strong></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} /></div></div>; }
function InternalEmpty({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) { return <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-5 py-16 text-center"><div><RefreshCw className="mx-auto size-7 text-primary" /><h1 className="mt-5 font-serif text-4xl">{title}</h1><p className="mt-3 text-muted-foreground">{description}</p><Button className="mt-7" onClick={onAction}>{action}</Button></div></main>; }
