import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /id="viewerZoomOutButton"/, "the original-page viewer needs a zoom-out control");
assert.match(html, /id="viewerZoomInButton"/, "the original-page viewer needs a zoom-in control");
assert.match(html, /id="viewerZoomLabel"/, "the viewer needs to show the current zoom percentage");
assert.match(app, /function setSourcePageZoom\(zoom/, "source page zoom must update image rendering without rerunning OCR");
assert.match(app, /applySourcePageZoom\(\)/, "rendered PDF images must receive the selected source page zoom");
assert.match(app, /const SOURCE_PAGE_ZOOM_MAX = 4;/, "source page zoom must allow a larger reading scale");
assert.match(app, /sourcePageZoom: 1\.25,/, "source page should open slightly larger than the full-page fit");

console.log("source page zoom regression check passed");
