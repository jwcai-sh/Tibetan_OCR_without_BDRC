import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const testFile = fileURLToPath(import.meta.url);
const appPath = new URL("../app.js", import.meta.url);
const source = readFileSync(appPath, "utf8");

const ocrFlowStart = source.indexOf("async function runOcrForCurrentPage(");
const ocrFlowEnd = source.indexOf("async function runTraditionalGeminiLines(", ocrFlowStart);
const ocrFlow = source.slice(ocrFlowStart, ocrFlowEnd);
const persistResult = ocrFlow.indexOf("saveOcrResultFromParsed(");

assert.notEqual(ocrFlowStart, -1, "current-page OCR flow must exist");
assert.notEqual(persistResult, -1, "OCR results must be persisted as soon as recognition completes");
assert.match(
  ocrFlow,
  /model: getSelectedGeminiModel\(\)/,
  "whole-page OCR must use the selected shared Gemini model"
);
assert.match(source, /runTraditionalGeminiLines\(endpoint, blob, getSelectedGeminiModel\(\)\)/,
  "the separate whole-page review action must use the same selected model");
assert.match(
  source,
  /pdfPageRenderCache/,
  "server-rendered PDF page images must be cached per page and dpi to avoid repeated slow uploads"
);

const replaceDecisionStart = source.indexOf("function shouldReplaceExistingWithPdfText");
const replaceDecisionEnd = source.indexOf("function discardCurrentBadPdfTextResult", replaceDecisionStart);
const replaceDecision = source.slice(replaceDecisionStart, replaceDecisionEnd);

assert.notEqual(replaceDecisionStart, -1, "PDF text-layer replacement guard must exist");
assert.match(
  replaceDecision,
  /if \(!existingText\) return true;/,
  "PDF text extraction must populate an empty page"
);
assert.doesNotMatch(
  replaceDecision,
  /return !isDirectTextSource\(/,
  "PDF text extraction must not overwrite persisted BDRC/AI OCR results"
);

const pdfTextGuardStart = source.indexOf("function isUsablePdfDirectText");
const pdfTextGuardEnd = source.indexOf("function groupPdfTextItemsIntoLines", pdfTextGuardStart);
const pdfTextGuard = source.slice(pdfTextGuardStart, pdfTextGuardEnd);

assert.notEqual(pdfTextGuardStart, -1, "PDF text-layer quality guard must exist");
assert.match(
  pdfTextGuard,
  /tibetanRatio >= 0\.65/,
  "Tibetan PDF text layers must be Tibetan-dominant before they are treated as usable text"
);
assert.match(
  pdfTextGuard,
  /latinExtendedCount >= 4/,
  "Latin-extended mojibake must cause a Tibetan PDF text layer to be rejected"
);
assert.match(
  pdfTextGuard,
  /latinExtendedRatio/,
  "Tibetan PDF text layers must reject mixed Latin-extended font-encoding mojibake by ratio, not only by absolute count"
);

console.log("current OCR persistence and missing-line review regression check passed");
