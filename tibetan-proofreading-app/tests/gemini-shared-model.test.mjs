import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const bridge = readFileSync(new URL("../../tibetan_ocr_bridge.py", import.meta.url), "utf8");
const api = readFileSync(new URL("../../zeabur_app/main.py", import.meta.url), "utf8");
const server = readFileSync(new URL("../../tibetan-ocr-core/ai_vision_ocr_server.py", import.meta.url), "utf8");

assert.match(html, /id="ocrButton"[\s\S]*id="geminiPageReviewButton"[\s\S]*id="geminiModelSelect"/, "OCR, full-page review, and one model selector must share the toolbar row");
assert.match(app, /model: getSelectedGeminiModel\(\)/, "current-page OCR must use the shared model selection");
assert.match(app, /runTraditionalGeminiLines\(endpoint, blob, getSelectedGeminiModel\(\)\)/, "full-page review must use the same selected model");
assert.match(app, /tibetan-proofreading-app:gemini-model/, "the model choice must persist across page reloads");
assert.match(bridge, /call_vision_model\(image, filename, prompt or module\.default_prompt\(draft\), model=model\)/, "the bridge must forward the selected model");
assert.match(api, /model: str = Form\(""\)/, "the OCR API must accept an optional model selection");
assert.match(server, /model not in GEMINI_REVIEW_MODELS/, "OCR must only accept models exposed in the Gemini catalog");
assert.match(server, /model_override=f"gemini:\{model\}"/, "aggregator OCR calls must route to the selected Gemini model");

console.log("shared Gemini model selector regression check passed");
