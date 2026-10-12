import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(app, /const ACTIVE_PROJECT_KEY = "tibetan-proofreading-app:active-project";/);
assert.match(app, /localStorage\.setItem\(ACTIVE_PROJECT_KEY, state\.cacheKey\)/);
assert.match(app, /async function restoreActiveProjectForRoute\(workflow\)/);
assert.match(app, /await loadFile\(sourceFile\);/);
assert.match(app, /ocrResults: serializeResultMap\(state\.ocrResults\)/);
assert.match(app, /sourceFile cache is lost|源文件缓存已丢失/);

assert.match(app, /const padY = Math\.max\(16, rawHeight \* 0\.75\)/);
assert.match(app, /const targetHeight = clamp\(96 \+ \(rotated \? rawWidth : rawHeight\) \* 0\.35, 112, 180\) \* previewScale/);
assert.match(app, /Number\(state\.sourcePreviewScale\) \|\| 1/);

console.log("OCR persistence and adaptive source-preview scaling regression check passed");
