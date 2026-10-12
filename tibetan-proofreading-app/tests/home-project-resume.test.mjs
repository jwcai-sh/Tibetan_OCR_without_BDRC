import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const resumeStart = appSource.indexOf("async function resumeLocalProject");
const resumeEnd = appSource.indexOf("function requestCachedProjectSource", resumeStart);
const resumeSource = appSource.slice(resumeStart, resumeEnd);

assert.notEqual(resumeStart, -1, "local project resume handler must exist");
assert.match(resumeSource, /showWorkbenchView\(workflow\)/, "missing source must still open the workbench");
assert.match(resumeSource, /请点击[“\"]加载文件[”\"]重新选择原始文件/, "missing source must explain the recovery action in-page");
assert.match(resumeSource, /已有 OCR\/译文记录仍会保留/, "missing source must reassure users that saved work is retained");
assert.doesNotMatch(resumeSource, /els\.fileInput\.click\(\)/, "resume must not trigger a hidden native file picker");
const showWorkbenchIndex = resumeSource.indexOf("showWorkbenchView(workflow)");
const loadFileIndex = resumeSource.indexOf("await loadFile(sourceFile)");
assert.ok(showWorkbenchIndex >= 0 && showWorkbenchIndex < loadFileIndex, "cached project must open the workbench before loading the source");

console.log("home project resume regression check passed");
