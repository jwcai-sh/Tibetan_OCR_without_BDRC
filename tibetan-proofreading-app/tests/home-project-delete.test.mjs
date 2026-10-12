import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

assert.match(appSource, /home-project-title-row/, "project titles must have a dedicated action row");
assert.match(appSource, /home-project-delete/, "each project must render a delete action");
assert.match(appSource, /确认删除/, "delete action must require explicit confirmation");
assert.match(appSource, /state\.pendingHomeProjectDeletionId/, "confirmation state must be tracked per project");
assert.match(appSource, /删除此浏览器项目/, "cancelable confirmation text must be shown");
assert.match(appSource, /removeStoredSourceFile/, "confirmed deletion must remove the cached source file");
assert.match(appSource, /localStorage\.removeItem\(project\.cacheKey\)/, "confirmed deletion must remove the project cache");
assert.match(stylesSource, /\.home-project-delete-confirm/, "confirmation controls must have dedicated layout styles");

console.log("home project delete regression check passed");
