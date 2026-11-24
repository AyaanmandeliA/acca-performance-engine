"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BarChart3, BookOpen, CheckCircle2,
  CircleAlert, Clock3, History, Home, Info,
  Lightbulb, LoaderCircle, LockKeyhole, Menu, MessageSquareText, RefreshCw,
  SearchCheck, ShieldCheck, Sparkles, Target, Trash2, TrendingUp, X,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DiagnosticSection, EvidenceCard } from "@/components/diagnostic-presentation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { DocumentInput, emptyDocumentReview, type DocumentReviewState } from "@/components/document-input";
import { extractionNeedsConfirmation, type ExtractionKind } from "@/lib/client-document-extraction";
import type { AnalyseInput, AnalysisPackage, BetaBackendPayload, Paper, SafePerformanceProfile, StudentAttemptSummary, StudentView } from "@/lib/domain";

type View = "landing" | "analyse" | "result" | "history" | "profile";

const EMPTY_INPUT: AnalyseInput = {
  paper: "AFM", questionLabel: "", scenarioText: "", requirementText: "", answerText: "",
  questionSourceType: "PASTED_TEXT", answerSourceType: "PASTED_TEXT",
  consent: { privacyNoticeVersion: "pilot-consent-v0.1.0", experimentalAiAnalysis: true, humanReview: true, consentedAt: new Date(0).toISOString() },
};

const NAV: Array<{ view: View; label: string; icon: typeof Home }> = [
  { view: "landing", label: "Home", icon: Home },
  { view: "analyse", label: "Analyse", icon: SearchCheck },
  { view: "history", label: "History", icon: History },
  { view: "profile", label: "Progress", icon: TrendingUp },
];

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

function StudentStatusBadge({ attempt }: { attempt: StudentAttemptSummary }) {
  const ready = attempt.releaseStatus === "RELEASED";
  const notReleased = attempt.releaseStatus === "REJECTED";
  const label = ready ? "Ready" : notReleased ? "Not released" : "Being reviewed";
  const tone = ready ? "bg-emerald-50 text-emerald-800 border-emerald-200" : notReleased ? "bg-red-50 text-red-800 border-red-200" : "bg-amber-50 text-amber-900 border-amber-200";
  return <Badge variant="outline" className={tone}>{label}</Badge>;
}

export function BetaApp({ userId = "student-a" }: { userId?: string }) {
  const [view, setView] = useState<View>("landing");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [attempts, setAttempts] = useState<StudentAttemptSummary[]>([]);
  const [profile, setProfile] = useState<SafePerformanceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAttempt, setSelectedAttempt] = useState<StudentAttemptSummary | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisPackage | null>(null);
  const [savedAttemptId, setSavedAttemptId] = useState<string | null>(null);
  const [input, setInput] = useState<AnalyseInput>(EMPTY_INPUT);
  const [manualMode, setManualMode] = useState(false);

  const refresh = useCallback(async (selectedUser: string) => {
    const [historyResult, profileResult] = await Promise.all([
      api<{ attempts: StudentAttemptSummary[] }>(`/api/attempts?userId=${encodeURIComponent(selectedUser)}`),
      api<{ profile: SafePerformanceProfile }>(`/api/profile?userId=${encodeURIComponent(selectedUser)}`),
    ]);
    setAttempts(historyResult.attempts); setProfile(profileResult.profile);
  }, []);

  useEffect(() => {
    const seed = process.env.NODE_ENV !== "production" ? api(`/api/demo?userId=${encodeURIComponent(userId)}`, { method: "POST" }) : Promise.resolve();
    seed
      .then(async () => {
        const pilot = await api<{ canAcceptRealSubmissions: boolean }>(`/api/pilot-readiness?userId=${encodeURIComponent(userId)}`);
        setManualMode(pilot.canAcceptRealSubmissions);
        await refresh(userId);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [refresh, userId]);

  useEffect(() => {
    type ModelContext = { registerTool: (tool: Record<string, unknown>, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Record<string, unknown>) => {
      try { void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined); }
      catch { /* Unsupported preview implementations fail closed. */ }
    };
    register({
      name: "start_answer_analysis", title: "Start answer analysis",
      description: "Open the visible analysis flow for an AFM or SBR practice answer. This stages the flow but does not submit or save an attempt.",
      inputSchema: { type: "object", properties: { paper: { type: "string", enum: ["AFM", "SBR"] } }, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(raw: unknown) {
        const candidate = raw && typeof raw === "object" ? (raw as { paper?: unknown }).paper : undefined;
        if (candidate !== undefined && candidate !== "AFM" && candidate !== "SBR") throw new Error("paper must be AFM or SBR");
        const paper = (candidate ?? "AFM") as Paper;
        setInput({ ...EMPTY_INPUT, paper }); setAnalysis(null); setSelectedAttempt(null); setSavedAttemptId(null); setView("analyse");
        return { view: "analyse", paper, staged: true };
      },
    });
    register({
      name: "view_performance_profile", title: "View performance profile",
      description: "Open the student's visible progress view without changing stored data.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { setView("profile"); return { view: "profile", userId }; },
    });
    return () => lifecycle.abort();
  }, [userId]);

  const navigate = (next: View) => { setView(next); setMobileOpen(false); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const startAnalysis = () => { setInput(EMPTY_INPUT); setAnalysis(null); setSavedAttemptId(null); setSelectedAttempt(null); navigate("analyse"); };
  const openAttempt = (attempt: StudentAttemptSummary) => { if (!attempt.studentPayload) return; setSelectedAttempt(attempt); setAnalysis(null); setSavedAttemptId(attempt.id); navigate("result"); };
  const activePayload = selectedAttempt?.studentPayload ?? analysis?.studentPayload ?? null;
  const activeView = activePayload?.student_view ?? null;

  if (loading) return <LoadingScreen />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8">
          <button onClick={() => navigate("landing")} className="flex items-center gap-3 text-left" aria-label="Performance Engine home">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">P</span>
            <span><span className="block font-semibold tracking-[-0.02em]">Performance Engine</span><span className="block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Private Beta</span></span>
          </button>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            {NAV.map((item) => <NavButton key={item.view} {...item} active={view === item.view} onClick={() => navigate(item.view)} />)}
          </nav>
          <div className="hidden md:block"><PrivacyDialog /></div>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen((open) => !open)} aria-label="Toggle menu"><Menu /></Button>
        </div>
        {mobileOpen && <div className="border-t bg-card px-5 py-4 lg:hidden"><div className="grid gap-1">{NAV.map((item) => <NavButton key={item.view} {...item} active={view === item.view} onClick={() => navigate(item.view)} />)}</div><div className="mt-4 border-t pt-4"><PrivacyDialog /></div></div>}
      </header>

      {error && <div role="alert" className="mx-auto mt-5 flex max-w-3xl items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X className="size-4" /></button></div>}

      {view === "landing" && <Landing onAnalyse={startAnalysis} onProgress={() => navigate("profile")} attempts={attempts} />}
      {view === "analyse" && <AnalysisWizard input={input} setInput={setInput} userId={userId} manualMode={manualMode} onCancel={() => navigate("landing")} onQueued={async () => { await refresh(userId); navigate("history"); }} onComplete={(result) => { setAnalysis(result); setSelectedAttempt(null); setSavedAttemptId(null); navigate("result"); }} onError={setError} />}
      {view === "result" && <ResultView payload={activePayload} studentView={activeView} attempt={selectedAttempt} analysis={analysis} input={input} userId={userId} savedAttemptId={savedAttemptId} setSavedAttemptId={setSavedAttemptId} onSaved={() => refresh(userId)} onHistory={() => navigate("history")} onNew={startAnalysis} onError={setError} />}
      {view === "history" && <HistoryView attempts={attempts} userId={userId} onOpen={openAttempt} onDeleted={() => refresh(userId)} onAnalyse={startAnalysis} onError={setError} />}
      {view === "profile" && <ProfileView profile={profile} onAnalyse={startAnalysis} />}

      <footer className="border-t bg-card px-5 py-8 text-sm text-muted-foreground"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 sm:flex-row"><span>Performance Engine · Private Beta</span><span>Experimental diagnostic feedback · Not official ACCA marking{process.env.NODE_ENV !== "production" ? " · Local development" : ""}</span></div></footer>
    </div>
  );
}

function NavButton({ label, icon: Icon, active, onClick }: { view: View; label: string; icon: typeof Home; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={`flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Icon className="size-4" />{label}</button>;
}

function PrivacyDialog() {
  return <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm"><LockKeyhole /> Privacy</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Your practice data is private</DialogTitle><DialogDescription>This supervised beta uses experimental AI analysis followed by human review. It does not call a paid or external AI API.</DialogDescription></DialogHeader><div className="space-y-3 text-sm leading-6 text-muted-foreground"><p>PDF text extraction and screenshot OCR run in your browser. Original files are not uploaded or retained; only the text you review and confirm can be submitted.</p><p>Question and answer text are separated from diagnostic outputs and assigned a 30-day retention date.</p><p>An authorised reviewer may inspect your answer and diagnostic before any result is released. Do not include unnecessary personal, confidential, or third-party information.</p><p>You can permanently delete an attempt from History. This is not official ACCA marking.</p></div></DialogContent></Dialog>;
}

function LoadingScreen() {
  return <main className="grid min-h-screen place-items-center bg-background"><div className="text-center"><LoaderCircle className="mx-auto mb-4 size-8 animate-spin text-primary" /><p className="font-semibold">Preparing the private beta…</p><p className="mt-1 text-sm text-muted-foreground">Loading your practice history</p></div></main>;
}

function Landing({ onAnalyse, onProgress, attempts }: { onAnalyse: () => void; onProgress: () => void; attempts: StudentAttemptSummary[] }) {
  return <main>
    <section className="mx-auto grid min-h-[calc(100vh-74px)] max-w-7xl items-center gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
      <div className="max-w-3xl"><p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-accent-foreground">AFM + SBR · Diagnostic feedback</p><h1 className="max-w-4xl font-serif text-[clamp(3rem,7vw,6.25rem)] leading-[0.94] tracking-[-0.052em]">Understand why you&apos;re losing marks.</h1><p className="mt-8 max-w-2xl text-lg leading-8 text-muted-foreground">Analyse an ACCA practice answer, spot recurring weaknesses, and leave with a clear idea of what to practise next.</p><div className="mt-10 flex flex-col gap-3 sm:flex-row"><Button size="lg" className="h-12 rounded-full px-6 text-base" onClick={onAnalyse}>Analyse an answer</Button><Button variant="outline" size="lg" className="h-12 rounded-full px-6 text-base" onClick={onProgress}><BarChart3 /> View my progress</Button></div><p className="mt-8 max-w-xl border-l-2 border-accent pl-4 text-sm leading-6 text-muted-foreground">Experimental diagnostic feedback, reviewed during the private beta. This is not official ACCA marking.</p></div>
      <aside className="report-sheet relative overflow-hidden rounded-2xl border bg-card p-7 shadow-[0_22px_55px_rgba(14,29,47,.09)] sm:p-10"><div className="mb-10 flex items-start justify-between border-b pb-6"><div><p className="eyebrow">Attempt brief</p><p className="mt-2 text-2xl font-semibold tracking-tight">Decision analysis</p></div><span className="rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent-foreground">AFM</span></div><p className="font-serif text-3xl leading-tight tracking-[-0.025em]">Strong workings. The next gain is turning results into a clear decision.</p><div className="mt-10 grid gap-6 border-t pt-7 sm:grid-cols-2"><div><p className="eyebrow">Working well</p><p className="mt-2 leading-6">Accurate calculation method</p></div><div><p className="eyebrow">Practise next</p><p className="mt-2 leading-6">Interpret the result in context</p></div></div><div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-emerald-700" /> Human-reviewed beta output</div></aside>
    </section>
    <section className="border-t bg-primary text-primary-foreground"><div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:px-8 md:grid-cols-3"><Stat value="3 steps" label="Add a question and answer, check the extracted text, review the diagnosis." /><Stat value={String(attempts.length)} label="Practice attempts currently saved in your history." /><Stat value="2 papers" label="AFM and SBR are supported in this private beta." /></div></section>
  </main>;
}

function Stat({ value, label }: { value: string; label: string }) { return <div><p className="font-serif text-4xl">{value}</p><p className="mt-2 max-w-xs text-sm leading-6 text-primary-foreground/70">{label}</p></div>; }

function AnalysisWizard({ input, setInput, userId, manualMode, onCancel, onQueued, onComplete, onError }: { input: AnalyseInput; setInput: (input: AnalyseInput) => void; userId: string; manualMode: boolean; onCancel: () => void; onQueued: () => Promise<void>; onComplete: (result: AnalysisPackage) => void; onError: (message: string) => void }) {
  type InputSource = ExtractionKind | "PASTED_TEXT";
  const startingQuestionSource: InputSource = input.questionSourceType === "PDF_TEXT" || input.questionSourceType === "IMAGE_OCR" ? input.questionSourceType : "PASTED_TEXT";
  const [step, setStep] = useState(1); const [processing, setProcessing] = useState(12); const [busy, setBusy] = useState(false); const [consentGiven, setConsentGiven] = useState(false);
  const [scenarioReview, setScenarioReview] = useState<DocumentReviewState>(emptyDocumentReview);
  const [requirementReview, setRequirementReview] = useState<DocumentReviewState>(emptyDocumentReview);
  const [answerReview, setAnswerReview] = useState<DocumentReviewState>(emptyDocumentReview);
  const [scenarioSource, setScenarioSource] = useState<InputSource>(startingQuestionSource);
  const [requirementSource, setRequirementSource] = useState<InputSource>(startingQuestionSource);
  const combineQuestionSources = (scenario: InputSource, requirement: InputSource): AnalyseInput["questionSourceType"] => scenario === requirement ? scenario : "MIXED_INPUT";
  const reviewSettled = (review: DocumentReviewState) => review.status !== "EXTRACTING" && review.status !== "FAILED";
  const scenarioReady = reviewSettled(scenarioReview) && input.scenarioText.trim().length >= 20 && input.scenarioText.length <= 50000 && !extractionNeedsConfirmation(scenarioReview.result, input.scenarioText, scenarioReview.confirmedText);
  const requirementReady = reviewSettled(requirementReview) && input.requirementText.trim().length >= 8 && input.requirementText.length <= 10000 && !extractionNeedsConfirmation(requirementReview.result, input.requirementText, requirementReview.confirmedText);
  const answerReady = reviewSettled(answerReview) && input.answerText.trim().length >= 20 && input.answerText.length <= 80000 && !extractionNeedsConfirmation(answerReview.result, input.answerText, answerReview.confirmedText);
  const canContinue = step === 1 || (step === 2 && scenarioReady && requirementReady && (!manualMode || Boolean(input.marksAvailable))) || (step === 3 && answerReady && consentGiven);
  const update = (changes: Partial<AnalyseInput>) => setInput({ ...input, ...changes });
  const analyse = async () => {
    if (!scenarioReady || !requirementReady) {
      setStep(2);
      onError("Review and confirm all extracted question text before submission.");
      return;
    }
    if (!answerReady || !consentGiven) {
      setStep(3);
      onError("Review and confirm the extracted answer text and consent before submission.");
      return;
    }
    const preparedInput = { ...input, questionLabel: input.questionLabel.trim() || `${input.paper} practice`, consent: { ...input.consent, consentedAt: new Date().toISOString() } };
    setInput(preparedInput);
    setBusy(true); setStep(4); setProcessing(20);
    const timer = window.setInterval(() => setProcessing((value) => Math.min(value + 14, 88)), 320);
    try {
      if (manualMode) {
        await api(`/api/attempts/manual?userId=${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify(preparedInput) });
        setProcessing(100);
        await onQueued();
      } else {
        const response = await api<{ result: AnalysisPackage }>(`/api/analyse?userId=${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify(preparedInput) });
        setProcessing(100); window.setTimeout(() => onComplete(response.result), 350);
      }
    }
    catch (reason) { setStep(3); onError(reason instanceof Error ? reason.message : "Analysis failed safely"); }
    finally { window.clearInterval(timer); setBusy(false); }
  };
  return <main className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
    <button className="mb-8 text-sm font-medium text-muted-foreground hover:text-foreground" onClick={onCancel}>Back to home</button>
    <div className="mb-10"><div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><span>{step < 4 ? `Step ${step} of 3` : "Building your diagnosis"}</span><span>{step < 4 ? `${Math.round(step / 3 * 100)}%` : `${processing}%`}</span></div><Progress value={step < 4 ? step / 3 * 100 : processing} /></div>
    {step === 1 && <section><p className="eyebrow">Choose your paper</p><h1 className="page-title">What are you practising?</h1><p className="page-lede">The beta currently supports Advanced Financial Management and Strategic Business Reporting.</p><RadioGroup value={input.paper} onValueChange={(value) => update({ paper: value as Paper })} className="mt-10 grid gap-4 md:grid-cols-2"><PaperOption value="AFM" title="Advanced Financial Management" description="Evaluation, interpretation, risk and recommendation." selected={input.paper === "AFM"} /><PaperOption value="SBR" title="Strategic Business Reporting" description="Technical knowledge, scenario application and explanation." selected={input.paper === "SBR"} /></RadioGroup><div className="mt-5 grid gap-3 sm:grid-cols-2"><UnavailablePaper code="AAA" /><UnavailablePaper code="APM" /></div></section>}
    {step === 2 && <section><p className="eyebrow">The question</p><h1 className="page-title">Give the answer its context.</h1><p className="page-lede">Upload a PDF or screenshots, or paste the relevant text. Use only content you are permitted to share and leave out personal information.</p><div className="mt-9 space-y-6 rounded-2xl border bg-card p-4 sm:p-8"><div className="grid gap-5 sm:grid-cols-[1fr_180px]"><Field label="Question label" hint="Optional — used in history"><Input value={input.questionLabel} maxLength={120} placeholder="e.g. Acquisition evaluation" onChange={(event) => update({ questionLabel: event.target.value })} /></Field><Field label="Marks available" hint={manualMode ? "Required" : "Optional"}><Input type="number" min={1} max={100} value={input.marksAvailable ?? ""} placeholder="e.g. 20" onChange={(event) => update({ marksAvailable: event.target.value ? Number(event.target.value) : undefined })} /></Field></div><DocumentInput label="Question or scenario" description="Add the facts, figures and any exhibits your answer uses." placeholder="Paste the relevant question facts and figures…" value={input.scenarioText} minLength={20} maxLength={50000} review={scenarioReview} onReviewChange={setScenarioReview} onValueChange={(value, source) => { setScenarioSource(source); update({ scenarioText: value, questionSourceType: combineQuestionSources(source, requirementSource) }); }} /><DocumentInput label="Requirement" description="Add the exact instruction you answered, including its parts and marks where shown." placeholder="e.g. Evaluate the proposal and recommend a course of action…" value={input.requirementText} minLength={8} maxLength={10000} review={requirementReview} onReviewChange={setRequirementReview} onValueChange={(value, source) => { setRequirementSource(source); update({ requirementText: value, questionSourceType: combineQuestionSources(scenarioSource, source) }); }} /><Field label="Permitted marking context" hint="Optional — never invent or paste benchmark ground truth"><Textarea value={input.permittedMarkingContext ?? ""} className="min-h-24" placeholder="Paste only guidance you are permitted to use, or leave blank." onChange={(event) => update({ permittedMarkingContext: event.target.value || undefined })} /></Field></div></section>}
    {step === 3 && <section><p className="eyebrow">Your answer</p><h1 className="page-title">Show us your reasoning.</h1><p className="page-lede">Upload your answer as a PDF or screenshots, or paste it. You will check and correct extracted text before anything is submitted. A reviewer prepares and checks each diagnostic manually, so feedback will not appear instantly.</p><div className="mt-9 space-y-6 rounded-2xl border bg-card p-4 sm:p-8"><DocumentInput label="Practice answer" description="Keep your original headings, paragraphs, workings and conclusion." placeholder="Paste exactly what you wrote for this requirement…" value={input.answerText} minLength={20} maxLength={80000} review={answerReview} onReviewChange={setAnswerReview} onValueChange={(value, source) => update({ answerText: value, answerSourceType: source })} /><label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/40 p-4 text-sm leading-6"><Checkbox checked={consentGiven} onCheckedChange={(value) => setConsentGiven(value === true)} className="mt-1" /><span><strong className="block text-foreground">I consent to experimental AI analysis and human review.</strong><span className="text-muted-foreground">An authorised reviewer may inspect this submission and the diagnostic before release. I can delete the attempt from History.</span></span></label><div className="flex gap-3 rounded-xl bg-muted p-4 text-sm leading-6 text-muted-foreground"><LockKeyhole className="mt-1 size-4 shrink-0 text-primary" /><p>PDF and screenshot extraction happens on this device. Original files are not uploaded or stored. Only the text you review and confirm is submitted with your recorded consent.</p></div></div></section>}
    {step === 4 && <Processing progress={processing} />}
    {step < 4 && <div className="mt-10 flex items-center justify-between"><Button variant="ghost" onClick={() => step === 1 ? onCancel() : setStep(step - 1)}>Back</Button><Button disabled={!canContinue || busy} onClick={() => step === 3 ? analyse() : setStep(step + 1)}>{step === 3 ? manualMode ? "Submit for review" : "Analyse answer" : "Continue"}</Button></div>}
  </main>;
}

function PaperOption({ value, title, description, selected }: { value: string; title: string; description: string; selected: boolean }) { return <label className={`flex cursor-pointer gap-4 rounded-2xl border bg-card p-6 transition ${selected ? "border-primary ring-2 ring-primary/10" : "hover:border-primary/40"}`}><RadioGroupItem value={value} className="mt-1" /><span><strong className="block text-xl">{value}</strong><span className="mt-1 block font-medium">{title}</span><span className="mt-3 block text-sm leading-6 text-muted-foreground">{description}</span></span></label>; }
function UnavailablePaper({ code }: { code: string }) { return <div className="flex items-center justify-between rounded-xl border border-dashed bg-muted/40 px-5 py-4 text-muted-foreground"><span className="font-semibold">{code}</span><Badge variant="outline">Coming later</Badge></div>; }
function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold"><span>{label}</span><span className="text-xs font-normal text-muted-foreground">{hint}</span></span>{children}</label>; }
function Processing({ progress }: { progress: number }) { const stage = progress < 45 ? "Reading the answer" : progress < 75 ? "Finding evidence" : progress < 100 ? "Building development priorities" : "Diagnosis ready"; return <section className="mx-auto max-w-2xl py-16 text-center"><span className="mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground"><Sparkles className="size-8" /></span><h1 className="mt-8 font-serif text-5xl tracking-tight">Turning your answer into a plan.</h1><p className="mt-5 text-lg text-muted-foreground">{stage}</p><div className="mx-auto mt-10 max-w-md"><Progress value={progress} /></div><div className="mt-9 grid gap-3 text-left sm:grid-cols-3">{["Answer read", "Evidence checked", "Priorities ordered"].map((label, index) => <div key={label} className="border-t p-4 text-sm"><CheckCircle2 className={`mb-2 size-5 ${progress > (index + 1) * 25 ? "text-emerald-700" : "text-muted-foreground"}`} />{label}</div>)}</div>{process.env.NODE_ENV !== "production" && <p className="mt-8 text-xs text-muted-foreground">Local development preview</p>}</section>; }

function ResultView({ payload, studentView, attempt, analysis, input, userId, savedAttemptId, setSavedAttemptId, onSaved, onHistory, onNew, onError }: { payload: BetaBackendPayload | null; studentView: StudentView | null; attempt: StudentAttemptSummary | null; analysis: AnalysisPackage | null; input: AnalyseInput; userId: string; savedAttemptId: string | null; setSavedAttemptId: (id: string) => void; onSaved: () => void; onHistory: () => void; onNew: () => void; onError: (message: string) => void }) {
  const [saving, setSaving] = useState(false); const [feedbackOpen, setFeedbackOpen] = useState(false);
  if (!payload || !studentView) return <EmptyState title="No diagnosis selected" description="Analyse an answer or open a ready attempt from history." action="Analyse an answer" onAction={onNew} />;
  const save = async () => { if (!analysis) return; setSaving(true); try { const result = await api<{ attemptId: string }>(`/api/attempts?userId=${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify({ userId, input, analysis }) }); setSavedAttemptId(result.attemptId); onSaved(); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not save attempt"); } finally { setSaving(false); } };
  const isReleased = attempt?.releaseStatus === "RELEASED";
  return <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-16">
    <div className="mb-7 flex flex-wrap items-center justify-between gap-4"><button onClick={onHistory} className="text-sm font-medium text-muted-foreground hover:text-foreground">Attempt history</button><div className="flex items-center gap-2"><Badge variant="outline">{payload.paper}</Badge>{attempt && <StudentStatusBadge attempt={attempt} />}</div></div>
    {!isReleased && <div className="mb-9 flex gap-3 border-l-2 border-amber-500 bg-amber-50/70 px-4 py-3 text-sm leading-6 text-amber-950"><CircleAlert className="mt-0.5 size-5 shrink-0" /><div><strong>Experimental diagnostic feedback — not official ACCA marking.</strong><p>{savedAttemptId ? "This attempt is being reviewed and will appear as Ready after approval." : "Save this attempt if you want it reviewed and added to your history."}</p></div></div>}
    <section className="border-b pb-10"><p className="eyebrow">Diagnostic summary</p><h1 className="mt-3 font-serif text-[clamp(2.6rem,6vw,4.75rem)] leading-none tracking-[-0.045em]">Your answer, clearly diagnosed.</h1><p className="mt-7 max-w-4xl font-serif text-2xl leading-9 tracking-[-0.02em] text-foreground/85 sm:text-3xl sm:leading-10">{studentView.diagnostic_summary}</p><div className="mt-9 grid gap-5 border-t pt-6 sm:grid-cols-3"><Meta label="Paper" value={payload.paper} /><Meta label="Confidence" value={readable(studentView.major_weaknesses[0]?.confidence ?? "LOW")} /><Meta label="Status" value={isReleased ? "Ready" : savedAttemptId ? "Being reviewed" : "Not saved"} /></div></section>
    <div className="mt-10 grid gap-10 lg:grid-cols-2"><DiagnosticSection tone="positive" title="What you did well" icon={CheckCircle2}>{studentView.major_strengths.map((item) => <EvidenceCard key={item.strength_reference} title={readable(item.dimension)} explanation={item.explanation} evidence={item.evidence} />)}</DiagnosticSection><DiagnosticSection tone="attention" title="Where you’re losing marks" icon={Target}>{studentView.major_weaknesses.map((item) => <EvidenceCard key={item.weakness_reference} title={readable(item.dimension)} explanation={item.explanation} evidence={item.evidence} tag={readable(item.category)} />)}</DiagnosticSection></div>
    <section className="mt-12 border-y bg-card/55 py-9"><div className="flex items-start gap-3 px-1"><Lightbulb className="mt-1 size-6 text-accent-foreground" /><div><p className="eyebrow">What to practise next</p><h2 className="mt-2 font-serif text-3xl">Make the next answer visibly better.</h2></div></div><div className="mt-8 grid gap-4 md:grid-cols-3">{studentView.skill_recommendations.slice(0, 3).map((item) => <article key={item.rank} className="rounded-xl border bg-card p-5"><span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{item.rank}</span><h3 className="mt-4 font-semibold">{item.skill}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.practice_action ?? "Practise this skill in your next timed answer."}</p>{item.success_check && <p className="mt-3 border-t pt-3 text-xs leading-5 text-muted-foreground"><strong className="text-foreground">Success check:</strong> {item.success_check}</p>}</article>)}</div></section>
    <section className="mt-12 grid gap-10 lg:grid-cols-[.9fr_1.1fr]"><div><p className="eyebrow">Knowledge vs exam technique</p><div className="mt-5 space-y-5">{["TECHNICAL_KNOWLEDGE", "EXAM_TECHNIQUE"].map((category) => { const items = studentView.major_weaknesses.filter((item) => item.category === category); return <div key={category} className="border-t pt-5"><h3 className="font-semibold">{readable(category)}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{items.length ? items.map((item) => readable(item.dimension)).join(", ") : "No priority weakness identified here."}</p></div>; })}</div></div><div><p className="eyebrow">Detailed breakdown</p><Accordion type="single" collapsible className="mt-2 border-t">{studentView.dimension_assessments.map((item) => <AccordionItem key={item.dimension} value={item.dimension}><AccordionTrigger><span className="flex flex-1 items-center justify-between gap-3 pr-2"><span>{readable(item.dimension)}</span><Badge variant="outline">{readable(item.assessment)}</Badge></span></AccordionTrigger><AccordionContent><p className="leading-6 text-muted-foreground">{item.rationale}</p>{item.evidence.length > 0 && <p className="mt-3 text-xs leading-5 text-muted-foreground">Supported by evidence from {item.evidence.map((evidence) => evidence.answer_location).join(", ")}.</p>}</AccordionContent></AccordionItem>)}</Accordion></div></section>
    {!!studentView.uncertainty_notices.length && <div className="mt-10 border-l-2 border-border px-5 py-2 text-sm leading-6 text-muted-foreground"><div className="mb-2 flex items-center gap-2 font-semibold text-foreground"><Info className="size-4" /> What to treat cautiously</div>{studentView.uncertainty_notices.map((notice) => <p key={notice}>{notice}</p>)}</div>}
    <div className="mt-10 flex flex-wrap justify-end gap-3 border-t pt-8">{isReleased && <Button variant="outline" onClick={() => setFeedbackOpen(true)}><MessageSquareText /> Give feedback</Button>}{!savedAttemptId && analysis && <Button disabled={saving} onClick={save}>{saving ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />} Save attempt</Button>}{savedAttemptId && !isReleased && <Button variant="outline" onClick={onHistory}><Clock3 /> View status</Button>}<Button onClick={onNew}>Analyse another</Button></div>
    {feedbackOpen && attempt && <FeedbackDialog attemptId={attempt.id} userId={userId} open={feedbackOpen} onOpenChange={setFeedbackOpen} onError={onError} />}
  </main>;
}

function Meta({ label, value }: { label: string; value: string }) { return <div><p className="eyebrow">{label}</p><p className="mt-2 font-semibold">{value}</p></div>; }

function HistoryView({ attempts, userId, onOpen, onDeleted, onAnalyse, onError }: { attempts: StudentAttemptSummary[]; userId: string; onOpen: (attempt: StudentAttemptSummary) => void; onDeleted: () => Promise<void>; onAnalyse: () => void; onError: (message: string) => void }) {
  const remove = async (attemptId: string) => { try { await api(`/api/attempts/${encodeURIComponent(attemptId)}?userId=${encodeURIComponent(userId)}`, { method: "DELETE" }); await onDeleted(); } catch (reason) { onError(reason instanceof Error ? reason.message : "Attempt could not be deleted"); } };
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow">Practice record</p><h1 className="page-title">Attempt history</h1><p className="page-lede">Track what you practised and return to feedback when it is ready. Diagnostics are manually reviewed and will not appear instantly.</p></div><Button onClick={onAnalyse}>New analysis</Button></div>{!attempts.length ? <EmptyState title="No attempts yet" description="Your saved analyses will appear here." action="Analyse an answer" onAction={onAnalyse} /> : <div className="mt-10 overflow-hidden rounded-2xl border bg-card">{attempts.map((attempt) => { const released = attempt.releaseStatus === "RELEASED" && attempt.studentPayload; const strength = released ? attempt.studentPayload?.student_view?.major_strengths[0]?.dimension : undefined; const weakness = released ? attempt.studentPayload?.student_view?.major_weaknesses[0]?.dimension : undefined; const unavailableLabel = attempt.releaseStatus === "REJECTED" ? "Not released" : "Being reviewed"; return <div key={attempt.id} className="grid gap-4 border-b p-5 last:border-0 sm:grid-cols-[110px_1fr_1fr_1fr_auto] sm:items-center"><div><Badge variant="outline">{attempt.paper}</Badge><p className="mt-2 text-xs text-muted-foreground">{dateLabel(attempt.createdAt)}</p></div><div><p className="eyebrow">Question</p><p className="mt-1 font-semibold">{attempt.questionLabel}</p></div><div><p className="eyebrow">Working well</p><p className="mt-1 text-sm">{strength ? readable(strength) : unavailableLabel}</p></div><div><p className="eyebrow">Practise next</p><p className="mt-1 text-sm">{weakness ? readable(weakness) : unavailableLabel}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><StudentStatusBadge attempt={attempt} />{released && <Button size="sm" variant="outline" onClick={() => onOpen(attempt)}>Open</Button>}<AlertDialog><AlertDialogTrigger asChild><Button size="icon" variant="ghost" aria-label={`Delete ${attempt.questionLabel}`}><Trash2 /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this attempt?</AlertDialogTitle><AlertDialogDescription>This permanently removes the question, answer, consent, diagnostic, review history and feedback for this attempt. It cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove(attempt.id)}>Delete attempt</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></div>; })}</div>}</main>;
}

function ProfileView({ profile, onAnalyse }: { profile: SafePerformanceProfile | null; onAnalyse: () => void }) {
  if (!profile) return <EmptyState title="Profile unavailable" description="We could not load this practice profile." action="Try an analysis" onAction={onAnalyse} />;
  return <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16"><div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr]"><section><p className="eyebrow">Progress</p><h1 className="page-title">Patterns across your practice.</h1><p className="page-lede">A conservative view built only from reviewed attempts.</p><p className="mt-5 max-w-lg border-l-2 border-accent pl-4 text-sm leading-6 text-muted-foreground">Patterns appear only after the same issue shows up across multiple reviewed attempts.</p><div className="mt-8 border-y py-6"><p className="font-serif text-5xl">{profile.attemptCount}</p><p className="mt-2 text-sm text-muted-foreground">reviewed attempts contributing evidence</p></div></section><section>{!profile.ready ? <div className="border-t bg-card/50 p-8"><BookOpen className="size-7 text-accent-foreground" /><h2 className="mt-5 font-serif text-3xl">Too early for a trend.</h2><p className="mt-3 leading-7 text-muted-foreground">{profile.message}</p><Button className="mt-7" onClick={onAnalyse}>Add another attempt</Button></div> : <div className="space-y-5"><ProfileGroup title="Recurring development areas" description="Appeared as a weakness in at least two reviewed attempts." items={profile.recurringAreas} icon={Target} /><ProfileGroup title="Improving areas" description="Only shown after three attempts with consistently reducing severity." items={profile.improvingAreas} icon={TrendingUp} /><ProfileGroup title="Consistent strengths" description="Supported by at least two reviewed attempts." items={profile.consistentStrengths} icon={CheckCircle2} /></div>}</section></div></main>;
}
function ProfileGroup({ title, description, items, icon: Icon }: { title: string; description: string; items: Array<{ dimension: string; summary: string; evidenceCount: number }>; icon: typeof Target }) { return <section className="border-t bg-card/50 p-6 sm:p-8"><div className="flex gap-3"><Icon className="mt-1 size-5 text-primary" /><div><h2 className="font-serif text-2xl">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div><div className="mt-6 space-y-3">{items.length ? items.map((item) => <div key={item.dimension} className="border-l-2 border-border px-4 py-2"><div className="flex items-center justify-between gap-4"><strong>{readable(item.dimension)}</strong><span className="text-xs text-muted-foreground">{item.evidenceCount} attempts</span></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{item.summary}</p></div>) : <p className="border border-dashed p-4 text-sm text-muted-foreground">No pattern has enough evidence yet.</p>}</div></section>; }

function FeedbackDialog({ attemptId, userId, open, onOpenChange, onError }: { attemptId: string; userId: string; open: boolean; onOpenChange: (open: boolean) => void; onError: (message: string) => void }) {
  const [usefulness, setUsefulness] = useState<"YES" | "PARTLY" | "NO">("YES"); const [accurateText, setAccurateText] = useState(""); const [confusingText, setConfusingText] = useState(""); const [nextWishText, setNextWishText] = useState(""); const [reuseIntent, setReuseIntent] = useState<"YES" | "MAYBE" | "NO">("YES"); const [saved, setSaved] = useState(false);
  const submit = async () => { try { await api(`/api/feedback?userId=${encodeURIComponent(userId)}`, { method: "POST", body: JSON.stringify({ attemptId, userId, usefulness, accurateText, confusingText, nextWishText, reuseIntent }) }); setSaved(true); } catch (reason) { onError(reason instanceof Error ? reason.message : "Feedback could not be saved"); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{saved ? "Thank you — feedback saved." : "Was this feedback useful?"}</DialogTitle><DialogDescription>{saved ? "Your response is stored locally with this attempt." : "Two quick answers are enough. Add detail only if you want to."}</DialogDescription></DialogHeader>{saved ? <div className="py-6 text-center"><CheckCircle2 className="mx-auto size-10 text-emerald-700" /><Button className="mt-6" onClick={() => onOpenChange(false)}>Done</Button></div> : <div className="space-y-5"><Field label="Useful?" hint="Required"><div className="flex flex-wrap gap-2">{(["YES", "PARTLY", "NO"] as const).map((value) => <Button key={value} type="button" variant={usefulness === value ? "default" : "outline"} onClick={() => setUsefulness(value)}>{readable(value)}</Button>)}</div></Field><Field label="Would you use this again?" hint="Required"><div className="flex flex-wrap gap-2">{(["YES", "MAYBE", "NO"] as const).map((value) => <Button key={value} type="button" variant={reuseIntent === value ? "default" : "outline"} onClick={() => setReuseIntent(value)}>{readable(value)}</Button>)}</div></Field><details className="border-y py-4"><summary className="cursor-pointer text-sm font-semibold">Add detail <span className="font-normal text-muted-foreground">(optional)</span></summary><div className="mt-5 space-y-4"><Field label="What felt accurate?" hint="Optional"><Textarea className="min-h-20" value={accurateText} onChange={(event) => setAccurateText(event.target.value)} /></Field><Field label="What felt wrong or confusing?" hint="Optional"><Textarea className="min-h-20" value={confusingText} onChange={(event) => setConfusingText(event.target.value)} /></Field><Field label="What should it help with next?" hint="Optional"><Textarea className="min-h-20" value={nextWishText} onChange={(event) => setNextWishText(event.target.value)} /></Field></div></details><Button onClick={submit}>Save feedback</Button></div>}</DialogContent></Dialog>;
}
function EmptyState({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) { return <main className="mx-auto grid min-h-[60vh] max-w-xl place-items-center px-5 py-16 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-full bg-muted"><RefreshCw className="size-6" /></span><h1 className="mt-5 font-serif text-4xl">{title}</h1><p className="mt-3 text-muted-foreground">{description}</p><Button className="mt-7" onClick={onAction}>{action}</Button></div></main>; }
