import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(
  source,
  /els\.ocrButton\.addEventListener\("click", runOcrForCurrentPage\)/,
  "the OCR button must recognize only the current page"
);
assert.match(source, /function getAiOnlyDisplayCompare\(compare\)/, "AI-only display must have an isolated compare adapter");
const proofreadStart = source.indexOf("function renderProofreadMergedView(");
const proofreadEnd = source.indexOf("function renderProofreadBlockCard(", proofreadStart);
assert.notEqual(proofreadStart, -1, "proofread view must be rendered from the current OCR result");
assert.match(
  source.slice(proofreadStart, proofreadEnd),
  /const compare = ensured\.compare;/,
  "proofread view must keep BDRC rows instead of replacing them with the AI-only display adapter"
);
assert.match(source, /bdrc: normalizeOcrCompareSide\(\{ label: "BDRC", text: "", lines: \[\] \}\)/, "AI-only display must not show BDRC diagnostics");
assert.match(source, /function getAiVisionDiagnosticText\(compare, index\)/, "AI-only failures must have a dedicated diagnostic formatter");
assert.match(source, /Gemini Vision 未返回文本；请重新识别当前页/, "AI-only failures must identify the AI Vision result as the failing side");
assert.match(source, /const sourceCompare = getAiOnlyDisplayCompare\(getOcrSourceCompare\(result\)\);/, "the top OCR status must use the AI-only compare adapter");
assert.doesNotMatch(source, /const hasBdrcError = Boolean\(sourceCompare\?\.bdrc\?\.error/, "BDRC diagnostics must not mark the AI-only panel as failed");
assert.match(source, /makeEstimatedSourceLineForRow\(index, rowCount\)/, "missing OCR coordinates must fall back to an estimated source row");
assert.match(source, /sourceLine\?\.estimated/, "source preview must distinguish estimated rows from real coordinates");
assert.match(source, /暂无可靠定位坐标/, "estimated rows must explain that the source preview is not precisely aligned");
assert.match(source, /预览（合并定位）/, "grouped layout coordinates must be identified in the source preview");
assert.match(source, /Array\.isArray\(parsed\?\.lines\)/, "OCR parsing must preserve normalized top-level lines with bbox data");
assert.match(source, /targetHeight = clamp\(96 \+ \(rotated \? rawWidth : rawHeight\) \* 0\.35, 112, 180\) \* previewScale/, "source previews must scale from the detected height after orientation");
assert.doesNotMatch(source, /getSingleLinePreviewCrop\(source, sx, sy, sw, sh\)/, "source previews must not split Tibetan stacked glyphs with an unreliable pixel crop");
assert.match(source, /APP_BUILD_ID = "[^"]+"/, "the app must expose a build identifier for diagnosing stale browser assets");
assert.match(html, /app\.js\?v=[^" ]+/, "the browser must request a versioned app script");
assert.match(source, /SOURCE_LAYOUT_VERSION = 4/, "cached source coordinates must have an explicit layout version");
assert.match(source, /layoutVersion: SOURCE_LAYOUT_VERSION/, "new OCR results must record the source layout version");
assert.match(source, /function hydrateCurrentPageSourceCoordinates\(\)/, "existing OCR rows without coordinates must be hydrated on page load");
assert.match(source, /formData\.append\("line_count", String\(existingLines\.length\)\)/, "layout hydration must preserve the existing OCR row count");
assert.match(source, /bbox: normalizeBbox\(line\?\.bbox\) \|\| normalizeBbox\(layoutLine\?\.bbox\)/, "layout hydration must not replace existing source coordinates");
assert.match(styles, /\.proofread-source-preview[\s\S]*overflow-x: auto/, "wide source previews must allow horizontal scrolling");
assert.doesNotMatch(source, /if \(sourceLine\?\.estimated\) return null;/, "source preview rendering should remain explicit rather than silently disappearing");

console.log("current-page OCR regression check passed");
