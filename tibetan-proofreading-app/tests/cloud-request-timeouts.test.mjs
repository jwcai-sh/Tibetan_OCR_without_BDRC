import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const source = app.slice(app.indexOf("async function fetchWithCloudTimeout("), app.indexOf("async function unlockCloudLibrary("));

function makeRequest(responses) {
  let calls = 0;
  const fetch = async () => {
    const response = responses[calls++];
    return response instanceof Error ? Promise.reject(response) : response;
  };
  const request = new Function("fetch", "window", "AbortController", `${source}\nreturn fetchWithCloudTimeout;`)(
    fetch, { setTimeout, clearTimeout }, AbortController,
  );
  return { request, calls: () => calls };
}

test("safe cloud reads retry a temporary server failure", async () => {
  const client = makeRequest([{ status: 503, body: { cancel: async () => {} } }, { status: 200 }]);
  const response = await client.request("/api/library", {}, 100, 2);
  assert.equal(response.status, 200);
  assert.equal(client.calls(), 2);
});

test("cloud writes are never replayed after an uncertain response", async () => {
  const client = makeRequest([{ status: 503 }, { status: 200 }]);
  const response = await client.request("/api/books/id/state", { method: "PUT" }, 100, 2);
  assert.equal(response.status, 503);
  assert.equal(client.calls(), 1);
});

test("read-only line previews retry only when explicitly enabled", async () => {
  const client = makeRequest([{ status: 503, body: { cancel: async () => {} } }, { status: 200 }]);
  const response = await client.request("/api/line-preview", { method: "POST" }, 100, 2, true);
  assert.equal(response.status, 200);
  assert.equal(client.calls(), 2);
  const ordinaryPost = makeRequest([{ status: 503 }, { status: 200 }]);
  assert.equal((await ordinaryPost.request("/api/save", { method: "POST" }, 100, 2)).status, 503);
  assert.equal(ordinaryPost.calls(), 1);
});

test("a stalled read ends and retries even if fetch ignores abort", async () => {
  const fetch = () => new Promise(() => {});
  const request = new Function("fetch", "window", "AbortController", `${source}\nreturn fetchWithCloudTimeout;`)(
    fetch, { setTimeout, clearTimeout }, AbortController,
  );
  await assert.rejects(request("/api/library", {}, 5, 2), /云端请求超时/);
});
