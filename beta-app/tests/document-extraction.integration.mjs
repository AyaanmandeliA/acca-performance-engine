// Part of ../../PROJECT.md — real PDF.js and Tesseract.js extraction checks using synthetic files only.
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createWorker, OEM, PSM } from "tesseract.js";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { assessExtraction, normaliseExtractedText, reconstructPdfPage } from "../lib/client-document-extraction.ts";

function escapePdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function makePdf(pages) {
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const commands = ["BT", "/F1 13 Tf", ...lines.map((line, lineIndex) => `1 0 0 1 50 ${780 - lineIndex * 28} Tm (${escapePdfText(line)}) Tj`), "ET"].join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(commands)} >>\nstream\n${commands}\nendstream`;
  });

  let pdf = "%PDF-1.4\n% synthetic\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}

async function readPdf(data) {
  const loading = getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  try {
    const document = await loading.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(reconstructPdfPage(content.items.flatMap((item) => "str" in item && "transform" in item ? [{ str: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0, width: item.width ?? 0, height: item.height || 13, hasEOL: item.hasEOL }] : [])));
      page.cleanup();
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

function svg(lines, { foreground = "#111111", background = "#ffffff", fontSize = 42 } = {}) {
  const text = lines.map((line, index) => `<text x="55" y="${85 + index * 62}" font-family="Arial, sans-serif" font-size="${fontSize}" fill="${foreground}">${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text>`).join("");
  return `<svg width="1500" height="${Math.max(300, 130 + lines.length * 62)}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${background}"/>${text}</svg>`;
}

async function png(lines, options) {
  return sharp(Buffer.from(svg(lines, options))).png().toBuffer();
}

const normalPages = await readPdf(makePdf([["1 (a) Evaluate the proposal", "Revenue is 125.5 million.", "Year     Cash flow ($m)", "1        125.5", "NPV = 1,250 - 900 = 350"]]));
assert.equal(normalPages.length, 1);
assert.match(normalPages[0], /1 \(a\) Evaluate the proposal/);
assert.match(normalPages[0], /NPV = 1,250 - 900 = 350/);
assert.match(normalPages[0], /Cash flow \(\$m\)/);

const multiplePages = await readPdf(makePdf([["Page one paragraph about investment appraisal."], ["Page two requirement: recommend a course of action."], ["Page three table and conclusion."]]));
assert.equal(multiplePages.length, 3);
assert.match(multiplePages.join("\n\n"), /Page one[\s\S]*Page two[\s\S]*Page three/);

const emptyPages = await readPdf(makePdf([[]]));
assert.equal(normaliseExtractedText(emptyPages.join("\n")), "");
assert.equal(assessExtraction("", null, 1).low, true);

const work = join(tmpdir(), `acca-upload-test-${process.pid}-${Date.now()}`);
await mkdir(work, { recursive: true });
const languagePath = resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int");
const worker = await createWorker("eng", OEM.LSTM_ONLY, { langPath: languagePath, cacheMethod: "none" });
try {
  await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: PSM.AUTO });
  const paragraph = await png(["The investment creates shareholder value.", "Management should review the downside risk.", "A clear recommendation is required."]);
  const paragraphResult = await worker.recognize(paragraph);
  assert.match(paragraphResult.data.text, /investment creates shareholder value/i);
  assert.match(paragraphResult.data.text, /downside risk/i);

  const calculation = await png(["NPV = 1250 - 900 = 350", "Year 1 cash flow = 125.5"]);
  const calculationResult = await worker.recognize(calculation);
  assert.match(calculationResult.data.text, /NPV/i);
  assert.match(calculationResult.data.text, /350/);
  assert.match(calculationResult.data.text, /125\.5/);

  const first = await worker.recognize(await png(["Screenshot one: revenue increases."]));
  const second = await worker.recognize(await png(["Screenshot two: recommend acceptance."]));
  const combined = normaliseExtractedText(`${first.data.text}\n\n${second.data.text}`);
  assert.match(combined, /Screenshot one/i);
  assert.match(combined, /Screenshot two/i);

  const poor = await sharp(await png(["Unreadable calculation 1250 minus 900"], { foreground: "#dedede", background: "#eeeeee", fontSize: 18 })).blur(4).resize(300).png().toBuffer();
  const poorResult = await worker.recognize(poor);
  assert.equal(assessExtraction(normaliseExtractedText(poorResult.data.text), poorResult.data.confidence, 0).low, true);
} finally {
  await worker.terminate();
  await rm(work, { recursive: true, force: true });
}

process.stdout.write("Document extraction integration passed: selectable and multi-page PDFs, tables/math, paragraph and calculation OCR, multiple screenshots, and unreadable inputs.\n");
