import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(
  app,
  /function flattenTraditionalRegionLines\(regions\)/,
  "traditional OCR regions must be expanded into individually displayable lines"
);
assert.match(
  app,
  /const regionLines = flattenTraditionalRegionLines\(payload\.regions\)/,
  "OCR parsing must use nested left-center-right region lines before region blocks"
);
assert.match(
  app,
  /function formatOcrLineDisplayNumber\(line, index\)/,
  "line rows must identify whether they belong to the left, center, or right region"
);
assert.match(app, /APP_BUILD_ID = "[^"]+"/, "the app must expose a build identifier for diagnosing stale browser assets");
assert.match(html, /app\.js\?v=[^" ]+/, "the browser must request a versioned app script");

function extractFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const brace = app.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name} has an unclosed function body`);
}

const flattenTraditionalRegionLines = new Function(
  "normalizeOcrRegions",
  "normalizeOcrTextSpacing",
  "normalizeBbox",
  `${extractFunction("flattenTraditionalRegionLines")}\nreturn flattenTraditionalRegionLines;`
)(
  (regions) => regions,
  (text) => String(text || ""),
  (bbox) => bbox || null,
);
const flattened = flattenTraditionalRegionLines([
  {
    id: "left",
    label: "左侧",
    lineCount: 1,
    lines: [{ text: "左栏边注", bbox: { x: 0.03, y: 0.3, width: 0.05, height: 0.2 } }],
  },
  {
    id: "center",
    label: "中间",
    lineCount: 2,
    lines: [
      { text: "第一行", bbox: { x: 0.2, y: 0.3, width: 0.4, height: 0.04 } },
      { text: "第二行", bbox: { x: 0.2, y: 0.4, width: 0.4, height: 0.04 } },
    ],
  },
  {
    id: "right",
    label: "右侧",
    lineCount: 1,
    lines: [{ text: "1-689", bbox: { x: 0.8, y: 0.3, width: 0.04, height: 0.2 } }],
  },
]);
assert.deepEqual(
  flattened.map((line) => [line.regionId, line.regionLineIndex, line.text]),
  [["left", 0, "左栏边注"], ["center", 0, "第一行"], ["center", 1, "第二行"], ["right", 0, "1-689"]],
  "left and right side results must display as independent rows without being folded into center text"
);

console.log("traditional region line display regression check passed");
