import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const inputRule = styles.match(/\.viewer-page-input\s*\{([\s\S]*?)\n\}/)?.[1] || "";

assert.match(inputRule, /font-size:\s*14px/, "current page input must use the compact pagination font size");
assert.match(inputRule, /width:\s*68px/, "page input width must remain stable");
assert.match(inputRule, /height:\s*30px/, "page input height must remain stable");

console.log("page control style regression check passed");
