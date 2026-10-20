import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const restore = app.slice(app.indexOf("async function resumeRemoteProject("), app.indexOf("async function findCachedRemoteSource("));
const rangedLoader = app.slice(app.indexOf("async function loadRemotePdfWithRanges("), app.indexOf("async function findCachedRemoteSource("));

assert.ok(restore.indexOf("await loadFile(sourceFile") < restore.indexOf("await statePromise"),
  "load the source document before waiting for collaborative state");
assert.match(restore, /协作数据库暂时不可用|云端校对状态暂时无法加载/,
  "show a clear degraded-state message without discarding the loaded source");
assert.match(restore, /AbortSignal\.timeout\(45000\)/,
  "allow enough time for the cross-region collaboration database to return cloud state");
const remoteSave = app.slice(app.indexOf("function scheduleRemoteStateSave("), app.indexOf("function remotePageFingerprint("));
assert.match(remoteSave, /response\.ok[\s\S]*?state\.remotePageRevisions\s*=[\s\S]*?setStatus\("云端校对状态已同步。", "ok"\)/,
  "clear an old synchronization warning after a confirmed remote save");
assert.match(restore, /mergeNewerLocalCloudState\(/,
  "compare saved local proofreading results before replacing the cloud cache");
assert.match(restore, /localPending[\s\S]*?saveCachedResults\(\{ immediateRemote: true \}\)/,
  "sync newer local proofreading results only after cloud page revisions are restored");
const mergeSource = app.slice(app.indexOf("function mergeNewerLocalCloudState("), app.indexOf("function requestCollaborationLogin("));
const merge = new Function("OCR_PROFILES", "console", `${mergeSource}\nreturn mergeNewerLocalCloudState;`)({ traditional: {} }, console);
const cloud = { remoteBookId: "book-1", pageCount: 24, updatedAt: "2026-10-20T11:00:00Z", ocrProfile: "traditional", ocrResults: { 1: { text: "cloud" } }, translationResults: {}, ocrQualityReviews: [] };
const local = { remoteBookId: "book-1", pageCount: 24, updatedAt: "2026-10-20T11:01:00Z", ocrProfile: "traditional", ocrResults: { 1: { text: "local edit" }, 2: { text: "local page" } }, translationResults: {}, ocrQualityReviews: [] };
assert.equal(merge(cloud, JSON.stringify(local), "book-1").localPending, true);
assert.deepEqual(merge(cloud, JSON.stringify(local), "book-1").payload.ocrResults, local.ocrResults,
  "a newer local correction and an unsynced page survive cloud restoration");
assert.equal(merge(cloud, JSON.stringify({ ...local, updatedAt: "2026-10-20T10:59:00Z" }), "book-1").localPending, false,
  "older local state does not replace newer cloud work");
assert.equal(merge(cloud, JSON.stringify({ ...local, remoteBookId: "another-book" }), "book-1").localPending, false,
  "another book's local state is never merged");
assert.match(restore, /loadRemotePdfWithRanges/, "uncached cloud PDFs should use PDF.js range loading");
assert.match(app, /disableStream:\s*Boolean\(options\.useRangeRequests\)/);
assert.match(app, /disableAutoFetch:\s*Boolean\(options\.useRangeRequests\)/);
assert.doesNotMatch(rangedLoader, /saveCachedResults\(/,
  "opening a cloud PDF must not save empty results over its existing cloud state");
assert.match(restore, /sourceSize:\s*sourceFile\?\.size\s*\|\|\s*state\.sourceSize/,
  "range-loaded PDFs should persist metadata without requiring a full File object");
assert.match(restore, /sourceMime:\s*sourceFile\?\.type\s*\|\|\s*state\.sourceMime/);
assert.doesNotMatch(html, /collabFirstAssignee|collabSecondAssignee|保存分工|一校|二校/);
assert.match(html, /id="collabShowHistory"[^>]*>查看本页修改历史/);

console.log("Cloud source preview survives delayed collaboration state and assignment controls are removed");
