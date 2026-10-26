import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function fetchCloudBookState("), app.indexOf("function mergeNewerLocalCloudState("));

function makeLoader(responses) {
  const feedback = [];
  let calls = 0;
  const fetch = async () => {
    const item = responses[calls++];
    if (item instanceof Error) throw item;
    return { ok: item.status === 200, status: item.status, json: async () => item.body };
  };
  const load = new Function("fetch", "window", "AbortController", "setCollaborationFeedback",
    `${source}\nreturn fetchCloudBookState;`)(fetch, globalThis, AbortController, (message) => feedback.push(message));
  return { load, calls: () => calls, feedback };
}

const expected = { ocr_results: { "1": { text: "སྐུ་" } }, translation_results: {} };
const intermittent = makeLoader([{ status: 503, body: { detail: "暂时不可用" } }, { status: 200, body: expected }]);
assert.deepEqual(await intermittent.load("/api/books/book-1/state"), expected);
assert.equal(intermittent.calls(), 2, "retry a temporary state failure without reloading the PDF");
assert.equal(intermittent.feedback.length, 1);

const unauthorized = makeLoader([{ status: 401, body: { detail: "请登录" } }, { status: 200, body: expected }]);
await assert.rejects(unauthorized.load("/api/books/book-1/state"), /请登录/);
assert.equal(unauthorized.calls(), 1, "do not retry an expired collaboration session");

const truncated = makeLoader([{ status: 200, body: {} }, { status: 200, body: expected }]);
assert.deepEqual(await truncated.load("/api/books/book-1/state"), expected);
assert.equal(truncated.calls(), 2, "never accept an empty successful response as saved state");

const slow = makeLoader([
  new Error("network stalled"),
  { status: 503, body: { detail: "暂时不可用" } },
  { status: 200, body: expected },
]);
assert.deepEqual(await slow.load("/api/books/book-1/state", {}, 5), expected);
assert.equal(slow.calls(), 3, "a new collaborator can recover from two transient failures without reopening the book");

console.log("Cloud state loading retries transient failures and rejects incomplete data");
