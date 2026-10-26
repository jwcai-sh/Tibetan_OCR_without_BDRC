import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const mergeSource = app.slice(app.indexOf("function mergeNewerLocalCloudState("), app.indexOf("function requestCollaborationLogin("));
const fingerprintSource = app.slice(app.indexOf("function remotePageFingerprint("), app.indexOf("function serializeResultMap("));
const merge = new Function("OCR_PROFILES", "console", `${fingerprintSource}\n${mergeSource}\nreturn mergeNewerLocalCloudState;`)({ traditional: {} }, console);

const cloud = {
  remoteBookId: "book-1", pageCount: 24, updatedAt: "2026-10-26T10:00:00Z",
  ocrProfile: "traditional", translationResults: {}, ocrQualityReviews: [],
  ocrResults: { 6: {
    text: "同一段文字", updatedAt: "2026-10-26T10:00:00Z",
    lines: [{ text: "同一段文字", manuallyEdited: false, manualErrorChars: 0 }],
    compare: { sharedErrors: [] },
  } },
};
const local = structuredClone(cloud);
local.updatedAt = "2026-10-26T10:05:00Z";
local.ocrResults[6].updatedAt = local.updatedAt;
local.ocrResults[6].lines[0].manuallyEdited = true;
local.ocrResults[6].lines[0].manualErrorChars = 1;
local.ocrResults[6].compare.sharedErrors = [{ blockIndex: 0, llmRanges: [{ start: 0, end: 1 }] }];

const merged = merge(cloud, JSON.stringify(local), "book-1");
assert.deepEqual(merged.pendingPages, ["6"], "marks and manual edit metadata must be recognized as unsynced work");
assert.deepEqual(merged.payload.ocrResults[6], local.ocrResults[6], "restore every local mark without changing the text");
assert.match(app, /collabRetrySync\.hidden = !pendingPages\.length/, "offer an explicit sync action for restored local work");
assert.match(app, /const conflicts = changed\.filter/, "check page revisions before sending local work");

console.log("Local annotation-only corrections survive restore and can be synchronized safely");
