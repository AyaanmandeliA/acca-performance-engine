// Part of ../../PROJECT.md — accessible upload, extraction review and confirmation UI.
"use client";

import { useId } from "react";
import { CheckCircle2, FileText, Image as ImageIcon, LoaderCircle, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  DocumentExtractionError,
  extractImageFiles,
  extractPdfFile,
  extractionNeedsConfirmation,
  type ExtractedDocument,
  type ExtractionKind,
} from "@/lib/client-document-extraction";

export type DocumentReviewState = {
  status: "IDLE" | "EXTRACTING" | "READY" | "FAILED";
  result: ExtractedDocument | null;
  confirmedText: string | null;
  progress: number;
  progressLabel: string;
  error: string;
};

export const emptyDocumentReview = (): DocumentReviewState => ({
  status: "IDLE",
  result: null,
  confirmedText: null,
  progress: 0,
  progressLabel: "",
  error: "",
});

type Props = {
  label: string;
  description: string;
  placeholder: string;
  value: string;
  minLength: number;
  maxLength: number;
  review: DocumentReviewState;
  onReviewChange: (review: DocumentReviewState) => void;
  onValueChange: (value: string, source: ExtractionKind | "PASTED_TEXT") => void;
};

export function DocumentInput({ label, description, placeholder, value, minLength, maxLength, review, onReviewChange, onValueChange }: Props) {
  const id = useId();
  const extracting = review.status === "EXTRACTING";
  const needsConfirmation = extractionNeedsConfirmation(review.result, value, review.confirmedText);
  const validLength = value.trim().length >= minLength && value.length <= maxLength;

  const begin = () => onReviewChange({ ...emptyDocumentReview(), status: "EXTRACTING", progress: 1, progressLabel: "Preparing on this device" });
  const progress = ({ label: progressLabel, progress: nextProgress }: { label: string; progress: number }) => {
    onReviewChange({ ...emptyDocumentReview(), status: "EXTRACTING", progress: nextProgress, progressLabel });
  };
  const finish = (result: ExtractedDocument) => {
    onValueChange(result.text, result.kind);
    onReviewChange({ status: "READY", result, confirmedText: null, progress: 100, progressLabel: "Text ready to review", error: "" });
  };
  const fail = (error: unknown) => {
    const message = error instanceof DocumentExtractionError ? error.message : "The file could not be read safely. Paste the text manually instead.";
    onReviewChange({ ...emptyDocumentReview(), status: "FAILED", error: message });
  };
  const readPdf = async (file?: File) => {
    if (!file) return;
    begin();
    try { finish(await extractPdfFile(file, progress)); }
    catch (error) { fail(error); }
  };
  const readImages = async (files: File[]) => {
    if (!files.length) return;
    begin();
    try { finish(await extractImageFiles(files, progress)); }
    catch (error) { fail(error); }
  };
  const edit = (nextValue: string) => {
    if (review.result) onReviewChange({ ...review, confirmedText: null });
    else if (review.status === "FAILED") onReviewChange(emptyDocumentReview());
    onValueChange(nextValue, review.result?.kind ?? "PASTED_TEXT");
  };
  const useManual = () => {
    onReviewChange(emptyDocumentReview());
    onValueChange("", "PASTED_TEXT");
  };

  return <section className="rounded-xl border bg-background/70 p-4 sm:p-5" aria-labelledby={`${id}-label`}>
    <div><h2 id={`${id}-label`} className="font-semibold">{label}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <label className={`flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border p-4 transition hover:border-primary/50 hover:bg-muted/50 ${extracting ? "pointer-events-none opacity-50" : ""}`}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">1</span>
        <span><span className="flex items-center gap-2 font-semibold"><FileText className="size-4" /> Upload PDF</span><span className="mt-1 block text-xs text-muted-foreground">Selectable text · up to 20 MB</span></span>
        <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={extracting} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; void readPdf(file); }} />
      </label>
      <label className={`flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border p-4 transition hover:border-primary/50 hover:bg-muted/50 ${extracting ? "pointer-events-none opacity-50" : ""}`}>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">2</span>
        <span><span className="flex items-center gap-2 font-semibold"><ImageIcon className="size-4" /> Upload screenshots</span><span className="mt-1 block text-xs text-muted-foreground">PNG or JPG · up to 10 images</span></span>
        <input type="file" multiple accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="sr-only" disabled={extracting} onChange={(event) => { const files = [...(event.target.files ?? [])]; event.currentTarget.value = ""; void readImages(files); }} />
      </label>
    </div>

    {extracting && <div className="mt-4 rounded-xl bg-muted p-4"><div className="flex items-center gap-3 text-sm font-medium"><LoaderCircle className="size-4 animate-spin text-primary" />{review.progressLabel}</div><Progress value={review.progress} className="mt-3" /><p className="mt-2 text-xs text-muted-foreground">Keep this page open. The file is being processed on this device.</p></div>}
    {review.status === "FAILED" && <div role="alert" className="mt-4 border-l-2 border-red-500 bg-red-50 px-4 py-3 text-sm leading-6 text-red-950"><div className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0" /><div><strong>Extraction did not produce safe text.</strong><p>{review.error}</p></div></div></div>}

    <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>{review.result ? "Review the extracted text" : "3 · Or paste text"}</span><span className="h-px flex-1 bg-border" /></div>
    <div className="flex items-center justify-between gap-3 text-sm"><label htmlFor={`${id}-text`} className="font-semibold">{review.result ? "Extracted text — edit anything that is wrong" : "Text"}</label><span className={`text-xs ${value.length > maxLength ? "text-red-700" : "text-muted-foreground"}`}>{value.length.toLocaleString()} / {maxLength.toLocaleString()}</span></div>
    <Textarea id={`${id}-text`} value={value} maxLength={Math.max(maxLength * 2, maxLength + 5_000)} className="mt-2 min-h-48 font-mono text-sm leading-6 sm:min-h-56" placeholder={placeholder} disabled={extracting} onChange={(event) => edit(event.target.value)} />
    {value.length > maxLength && <p role="alert" className="mt-2 text-sm text-red-700">This text is too long to submit. Remove unrelated pages or content.</p>}

    {review.result && <div className={`mt-4 rounded-xl border p-4 ${review.result.reliability === "LOW" ? "border-amber-300 bg-amber-50" : "bg-muted/45"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" /> Review required</div><span className="text-xs text-muted-foreground">{review.result.pageCount} {review.result.kind === "PDF_TEXT" ? "PDF page" : "screenshot"}{review.result.pageCount === 1 ? "" : "s"}</span></div>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">{review.result.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      <label className={`mt-4 flex cursor-pointer items-start gap-3 border-t pt-4 text-sm leading-6 ${!validLength ? "opacity-50" : ""}`}>
        <Checkbox checked={!needsConfirmation} disabled={!validLength} onCheckedChange={(checked) => onReviewChange({ ...review, confirmedText: checked === true ? value : null })} className="mt-1" />
        <span><strong className="block text-foreground">I checked the extracted text against the original.</strong><span className="text-muted-foreground">I corrected missing or misread words and carefully checked figures, formulas and tables.</span></span>
      </label>
      {!needsConfirmation && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-800"><CheckCircle2 className="size-4" /> Confirmed for submission</p>}
      <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={useManual}><RotateCcw /> Discard extraction and paste instead</Button>
    </div>}
    {!review.result && <p className="mt-3 text-xs leading-5 text-muted-foreground">PDF and screenshot processing happens in this browser. The original file is not uploaded or stored.</p>}
  </section>;
}
