import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const signatureEnd = app.indexOf(")", start);
  const brace = app.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = brace; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name} has an unclosed function body`);
}

const evaluateRegionRule = new Function(
  `${extractFunction("isPeripheralProofreadRegion")}\nreturn isPeripheralProofreadRegion;`
)();

for (const sideLine of [
  { regionId: "left" },
  { regionLabel: "左侧" },
  { regionId: "right" },
  { regionLabel: "右侧" },
]) assert.equal(evaluateRegionRule(sideLine), true);
assert.equal(evaluateRegionRule({ regionId: "center", regionLabel: "中间" }), false);
assert.equal(evaluateRegionRule({}), false);

const cardStart = app.indexOf("function renderProofreadBlockCard(");
const cardEnd = app.indexOf("function makeProofreadAiLine(", cardStart);
assert.notEqual(cardStart, -1, "proofread result cards must be rendered by a dedicated function");
const cardRenderer = app.slice(cardStart, cardEnd);
assert.match(
  cardRenderer,
  /if \(\[bdrcLine, aiLine, finalLine\]\.some\(isPeripheralProofreadRegion\)\)\s*\{[\s\S]*?renderProofreadSourcePanel\(sourceLine, index\)[\s\S]*?左右栏识别结果暂不显示[\s\S]*?return card;/,
  "peripheral result cards must retain their source preview while hiding model recognition output"
);

function makeElement() {
  const classes = new Set();
  return {
    className: "",
    dataset: {},
    children: [],
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      add(name) { classes.add(name); },
    },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener() {},
    setAttribute() {},
  };
}

const sourcePanel = makeElement();
const renderProofreadBlockCard = new Function(
  "document",
  "state",
  "renderProofreadSourcePanel",
  "renderDeletedProofreadBlockCard",
  `${extractFunction("isPeripheralProofreadRegion")}\n${extractFunction("renderProofreadBlockCard")}\nreturn renderProofreadBlockCard;`
)({createElement: makeElement}, {activeOcrLine: -1}, () => sourcePanel, makeElement);

for (const regionLine of [
  {regionId: "left", regionLabel: "左侧", text: "左栏结果"},
  {regionId: "right", regionLabel: "右侧", text: "右栏结果"},
]) {
  const savedText = JSON.stringify(regionLine);
  const card = renderProofreadBlockCard({
    index: 0,
    bdrcLine: regionLine,
    aiLine: {...regionLine},
    finalLine: {...regionLine},
    sourceLine: {...regionLine},
    compare: {},
  });
  assert.equal(card.children.length, 1, "hidden side results must not create model editors or actions");
  assert.equal(card.children[0], sourcePanel, "the original source panel must remain visible");
  assert.equal(sourcePanel.children.at(-1).textContent, "左右栏识别结果暂不显示");
  assert.equal(JSON.stringify(regionLine), savedText, "hiding results must not mutate OCR data");
  sourcePanel.children = [];
}

console.log("side-region proofread visibility checks passed");
