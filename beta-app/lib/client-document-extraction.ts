// Part of ../../PROJECT.md — private, browser-side PDF and screenshot text extraction.
export type ExtractionKind = "PDF_TEXT" | "IMAGE_OCR";
export type ExtractionReliability = "REVIEW_REQUIRED" | "LOW";

export type ExtractionProgress = {
  label: string;
  progress: number;
};

export type ExtractedDocument = {
  text: string;
  kind: ExtractionKind;
  reliability: ExtractionReliability;
  warnings: string[];
  fileNames: string[];
  pageCount: number;
  confidence: number | null;
};

export type PositionedPdfText = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL?: boolean;
};

export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExtractionError";
  }
}

const visibleCharacterCount = (value: string) => value.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

export function normaliseExtractedText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function reconstructPdfPage(items: PositionedPdfText[]): string {
  const meaningful = items.filter((item) => item.str.trim() || item.hasEOL);
  if (!meaningful.length) return "";

  const rows: Array<{ y: number; height: number; items: PositionedPdfText[] }> = [];
  for (const item of [...meaningful].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tolerance = Math.max(2.25, Math.min(6, item.height * 0.45));
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
      row.height = Math.max(row.height, item.height);
    } else {
      rows.push({ y: item.y, height: Math.max(item.height, 8), items: [item] });
    }
  }

  rows.sort((a, b) => b.y - a.y);
  const output: string[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const ordered = row.items.sort((a, b) => a.x - b.x);
    let line = "";
    let previousEnd: number | null = null;
    let previousCharacterWidth = 4;
    for (const item of ordered) {
      const value = item.str.replace(/\s+/g, " ");
      if (!value) continue;
      if (previousEnd !== null) {
        const gap = item.x - previousEnd;
        if (gap > previousCharacterWidth * 4) line += "\t";
        else if (gap > previousCharacterWidth * 0.35 && !line.endsWith(" ")) line += " ";
      }
      line += value;
      previousCharacterWidth = Math.max(2, item.width / Math.max(value.length, 1));
      previousEnd = item.x + item.width;
    }
    if (line.trim()) output.push(line.trimEnd());

    const next = rows[rowIndex + 1];
    if (next) {
      const verticalGap = row.y - next.y;
      const typicalHeight = Math.max(row.height, next.height, 8);
      if (verticalGap > typicalHeight * 1.7) output.push("");
    }
  }
  return normaliseExtractedText(output.join("\n"));
}

export function assessExtraction(text: string, confidence: number | null, unreadableUnits: number) {
  const visible = visibleCharacterCount(text);
  const unusual = (text.match(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
  const low = unreadableUnits > 0 || visible < 40 || unusual > Math.max(2, visible * 0.02) || (confidence !== null && confidence < 65);
  return { visible, low };
}

export function extractionNeedsConfirmation(result: ExtractedDocument | null, currentText: string, confirmedText: string | null): boolean {
  if (!result) return false;
  return confirmedText !== currentText || visibleCharacterCount(currentText) < 8;
}

export async function extractPdfFile(file: File, onProgress?: (progress: ExtractionProgress) => void): Promise<ExtractedDocument> {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new DocumentExtractionError("Choose a PDF file.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new DocumentExtractionError("This PDF is larger than 20 MB. Use a smaller PDF or paste the relevant text.");
  }

  onProgress?.({ label: "Opening PDF on this device", progress: 5 });
  const [pdfjs, workerModule] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    const pages: string[] = [];
    const unreadablePages: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress?.({ label: `Reading PDF page ${pageNumber} of ${document.numPages}`, progress: 10 + Math.round(pageNumber / document.numPages * 82) });
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
      const positioned = content.items.flatMap((item) => {
        if (!("str" in item) || !("transform" in item)) return [];
        return [{
          str: item.str,
          x: item.transform[4] ?? 0,
          y: item.transform[5] ?? 0,
          width: item.width ?? 0,
          height: item.height || Math.abs(item.transform[3] ?? 0) || 10,
          hasEOL: item.hasEOL,
        } satisfies PositionedPdfText];
      });
      const text = reconstructPdfPage(positioned);
      pages.push(text);
      if (visibleCharacterCount(text) < 8) unreadablePages.push(pageNumber);
      page.cleanup();
    }

    const text = normaliseExtractedText(pages.filter(Boolean).join("\n\n"));
    if (visibleCharacterCount(text) < 8) {
      throw new DocumentExtractionError("No usable selectable text was found. This may be a scanned PDF. Paste the text manually or upload clear screenshots for on-device OCR.");
    }
    const assessment = assessExtraction(text, null, unreadablePages.length);
    const warnings = ["Check figures, formulas, tables and page order carefully before confirming."];
    if (unreadablePages.length) warnings.unshift(`Little or no selectable text was found on page${unreadablePages.length === 1 ? "" : "s"} ${unreadablePages.join(", ")}. Nothing from those pages has been assumed.`);
    if (assessment.visible < 40) warnings.unshift("Only a small amount of selectable text was found. Check that the complete content is present.");
    onProgress?.({ label: "PDF text ready to review", progress: 100 });
    return { text, kind: "PDF_TEXT", reliability: assessment.low ? "LOW" : "REVIEW_REQUIRED", warnings, fileNames: [file.name], pageCount: document.numPages, confidence: null };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("The PDF could not be read safely. Try another copy or paste the relevant text.");
  } finally {
    await loadingTask.destroy();
  }
}

async function imageForOcr(file: File): Promise<Blob> {
  if (file.size > 12 * 1024 * 1024) throw new DocumentExtractionError(`${file.name} is larger than 12 MB.`);
  let image: ImageBitmap | HTMLImageElement | null = null;
  let release = () => undefined;
  try {
    if ("createImageBitmap" in window) {
      image = await createImageBitmap(file, { imageOrientation: "from-image" });
      release = () => (image as ImageBitmap).close();
    } else {
      const url = URL.createObjectURL(file);
      release = () => URL.revokeObjectURL(url);
      const element = new Image();
      element.src = url;
      await element.decode();
      image = element;
    }
    if (!image) throw new DocumentExtractionError("This image could not be opened for OCR.");
    const width = "naturalWidth" in image ? image.naturalWidth : image.width;
    const height = "naturalHeight" in image ? image.naturalHeight : image.height;
    const scale = Math.min(1, 2400 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new DocumentExtractionError("This browser could not prepare the image for OCR.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new DocumentExtractionError("This image could not be prepared for OCR.");
    return blob;
  } finally {
    release();
  }
}

export async function extractImageFiles(files: File[], onProgress?: (progress: ExtractionProgress) => void): Promise<ExtractedDocument> {
  if (!files.length) throw new DocumentExtractionError("Choose at least one screenshot.");
  if (files.length > 10) throw new DocumentExtractionError("Upload no more than 10 screenshots at a time.");
  if (files.some((file) => !["image/png", "image/jpeg"].includes(file.type) && !/\.(png|jpe?g)$/i.test(file.name))) {
    throw new DocumentExtractionError("Screenshots must be PNG, JPG or JPEG files.");
  }

  onProgress?.({ label: "Loading on-device OCR", progress: 2 });
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  const origin = window.location.origin;
  let activeIndex = 0;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `${origin}/vendor/tesseract/worker.min.js`,
    corePath: `${origin}/vendor/tesseract/core`,
    langPath: `${origin}/vendor/tesseract/lang`,
    workerBlobURL: false,
    cacheMethod: "write",
    logger(message) {
      if (message.status === "recognizing text") {
        const perFile = 85 / files.length;
        onProgress?.({ label: `Reading screenshot ${activeIndex + 1} of ${files.length} on this device`, progress: Math.round(8 + activeIndex * perFile + message.progress * perFile) });
      }
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.AUTO });
    const texts: string[] = [];
    const confidences: number[] = [];
    const unreadable: number[] = [];
    for (let index = 0; index < files.length; index += 1) {
      activeIndex = index;
      const image = await imageForOcr(files[index]);
      const result = await worker.recognize(image);
      const text = normaliseExtractedText(result.data.text);
      texts.push(text);
      confidences.push(result.data.confidence);
      if (visibleCharacterCount(text) < 8) unreadable.push(index + 1);
    }
    const text = normaliseExtractedText(texts.filter(Boolean).join("\n\n"));
    if (visibleCharacterCount(text) < 8) {
      throw new DocumentExtractionError("No usable text could be read from these screenshots. Try clearer images or paste the text manually. Handwriting is not reliably supported.");
    }
    const confidence = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
    const assessment = assessExtraction(text, confidence, unreadable.length);
    const warnings = [
      "OCR can misread words even when extraction succeeds. Check every paragraph before confirming.",
      "Check numerical figures, negative signs, formulas, tables and mathematical notation especially carefully.",
      "Handwriting is not reliably supported.",
    ];
    if (unreadable.length) warnings.unshift(`Screenshot${unreadable.length === 1 ? "" : "s"} ${unreadable.join(", ")} produced little or no usable text. Nothing unreadable has been assumed.`);
    if (confidence < 65) warnings.unshift("The OCR confidence is low. Correct the text manually or paste a clearer version before confirming.");
    onProgress?.({ label: "Screenshot text ready to review", progress: 100 });
    return { text, kind: "IMAGE_OCR", reliability: assessment.low ? "LOW" : "REVIEW_REQUIRED", warnings, fileNames: files.map((file) => file.name), pageCount: files.length, confidence };
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error;
    throw new DocumentExtractionError("On-device OCR could not read these screenshots. Try clearer images or paste the text manually.");
  } finally {
    await worker.terminate();
  }
}
