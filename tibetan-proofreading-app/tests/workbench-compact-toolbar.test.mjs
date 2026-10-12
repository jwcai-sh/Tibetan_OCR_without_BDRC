import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const toolbarStart = html.indexOf('<div class="ocr-toolbar">');
const toolbarEnd = html.indexOf('<div id="ocrLineCompare"', toolbarStart);
assert.notEqual(toolbarStart, -1, "OCR controls must remain available in the workbench");
assert.notEqual(toolbarEnd, -1, "the compact toolbar must end before its progress message");
const toolbar = html.slice(toolbarStart, toolbarEnd);

assert.match(toolbar, /class="ocr-toolbar-row ocr-toolbar-primary"/, "the first compact toolbar row must be explicit");
assert.match(toolbar, /class="ocr-toolbar-row ocr-toolbar-secondary"/, "the second compact toolbar row must be explicit");
assert.match(toolbar, /<span>类型<\/span>/, "the document profile label must be shortened to 类型");
assert.match(toolbar, /<div id="batchOcrProgress"/, "batch status must stay inside the two-row fixed toolbar");
assert.match(toolbar, /data-collapse-pane="ocr"/, "the OCR pane collapse control must remain available in the compact toolbar");
assert.ok(toolbar.indexOf('id="ocrViewSwitch"') < toolbar.indexOf('id="decreaseOcrFontButton"'), "font zoom controls must follow the view switch");
assert.match(toolbar, /aria-label="缩小右栏识别文字"/, "right-pane text must expose a zoom-out control");
assert.match(toolbar, /aria-label="放大右栏识别文字"/, "right-pane text must expose a zoom-in control");
assert.doesNotMatch(styles, /\.app-shell\.workbench-mode #workbenchView \.font-size-controls\s*\{[^}]*display:\s*none/s, "the workbench must show font zoom controls");
assert.match(styles, /#ocrText\s*\{[^}]*font-size:\s*var\(--ocr-font-size/s, "text view must respond to the OCR font zoom");
assert.match(styles, /\.app-shell\.workbench-mode #workbenchView \.ocr-pane > \.pane-header\s*\{[^}]*display:\s*none/s, "redundant OCR result title and status must not consume a fixed row in workbench mode");
assert.match(styles, /\.app-shell\.workbench-mode #workbenchView \.ocr-profile-control\s*\{[^}]*white-space:\s*nowrap/s, "the compact type label must stay on one line in a narrow OCR pane");
assert.match(styles, /\.app-shell\.workbench-mode #workbenchView \.ocr-engine-control\s*\{[^}]*display:\s*none/s, "the default BDRC engine selector must be hidden in the workbench toolbar");
assert.match(styles, /\.app-shell\.workbench-mode #workbenchView \.ocr-toolbar-row\s*\{/, "workbench controls must use dedicated compact row styling");

console.log("workbench two-row OCR toolbar regression check passed");
