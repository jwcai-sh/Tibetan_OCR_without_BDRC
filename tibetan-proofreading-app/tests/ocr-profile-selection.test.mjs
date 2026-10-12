import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../../Dockerfile.zeabur", import.meta.url), "utf8");

for (const value of ["handwritten", "traditional", "modern"]) {
  assert.match(html, new RegExp(`value=\\"${value}\\"`), `${value} profile must be selectable`);
}
assert.match(html, /value="traditional" selected/, "traditional scripture layout must be the safe default for the attached source");
assert.match(app, /model: "Ume_Petsuk"/, "handwritten OCR must use the Ume_Petsuk model");
assert.match(app, /model: "Woodblock-Stacks"/, "traditional scripture OCR must use the Woodblock-Stacks model");
assert.match(app, /model: "Modern"/, "modern print OCR must use the Modern model");
assert.match(app, /ocr_profile: profile\.id/, "the selected profile must be sent to the OCR endpoint");
assert.match(app, /prompt: buildAiOcrPrompt\("", profile\.id\)/, "the selected profile must guide AI Vision");
assert.doesNotMatch(dockerfile, /bdrc_ocr_server\.py/, "the server image must exclude the BDRC runtime");
assert.match(app, /fetchOcrWithTransientRetry\(endpoint, formData, fields\.engine === "ai_vision"\)/, "AI Vision requests must use transient retry handling");
assert.match(app, /const maxRetries = retryTransient \? 3 : 0/, "transient retry handling must be limited to AI Vision");
assert.match(app, /message\.includes\("failed to fetch"\)/, "connection failures must be recognized as retryable");
assert.match(app, /CANONICAL_REGION_ORDER = Object\.freeze\(\["left", "center", "right"\]\)/, "the frontend must define the canonical region order");
assert.match(app, /canonicalRegions = CANONICAL_REGION_ORDER\.map/, "the frontend must restore missing or shuffled regions");
assert.match(app, /regionLineCount/, "the frontend must show the line count inside each semantic region");
assert.match(app, /function normalizeOcrRegions\(regions\)/, "the frontend must preserve structured OCR regions");

console.log("OCR profile selection regression check passed");
