import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const restore = app.slice(app.indexOf("async function resumeRemoteProject("), app.indexOf("async function findCachedRemoteSource("));

assert.ok(restore.indexOf("await loadFile(sourceFile") < restore.indexOf("await statePromise"),
  "load the source document before waiting for collaborative state");
assert.match(restore, /协作数据库暂时不可用|云端校对状态暂时无法加载/,
  "show a clear degraded-state message without discarding the loaded source");
assert.doesNotMatch(html, /collabFirstAssignee|collabSecondAssignee|保存分工|一校|二校/);
assert.match(html, /id="collabShowHistory"[^>]*>查看本页修改历史/);

console.log("Cloud source preview survives delayed collaboration state and assignment controls are removed");
