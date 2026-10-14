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
