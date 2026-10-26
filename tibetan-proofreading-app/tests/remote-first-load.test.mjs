import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function setup() {
  const c = vm.createContext({ console, setTimeout, clearTimeout, AbortController,
    document: { querySelector: () => null },
    window: { addEventListener() {}, setTimeout, clearTimeout, location: { origin: 'https://example.test' } },
  });
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), c);
  vm.runInContext(`
    state.documentRequestId = 1;
    els.ocrTitle = {};
    fetchWithCloudTimeout = async () => ({ok:true,json:async()=>({page_count:24})});
    restoreCachedResults = () => false;
    refreshControls = setStatus = scheduleIdleWork = () => {};
    renderCurrentPage = () => new Promise(() => {});
  `, c);
  return c;
}

test('no-cache PDF metadata returns while first preview is still pending', async () => {
  const c = setup();
  const result = await Promise.race([
    vm.runInContext("loadRemotePdfWithServerPages('book',1)", c),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 50)),
  ]);
  assert.equal(result, true, 'cloud state restoration must not wait for the image');
});

test('image decode that never settles has a bounded failure', async () => {
  const c = setup();
  c.testImage = { decode: () => new Promise(() => {}) };
  await assert.rejects(vm.runInContext('decodeSourcePreview(testImage, 5)', c), /图片解码超时/);
});

test('broken images report failure instead of being treated as loaded', async () => {
  const c = setup();
  c.testImage = { decode: async () => { throw new Error('invalid image'); } };
  await assert.rejects(vm.runInContext('decodeSourcePreview(testImage, 50)', c), /invalid image/);
});

test('a cloud response with saved OCR cannot be reported as restored when hydration failed', () => {
  const c = setup();
  c.cloud = {ocrResults:{1:{text:'saved'}},translationResults:{}};
  assert.throws(() => vm.runInContext('requireRestoredCloudResults(cloud, false)', c), /校对内容恢复失败/);
});

test('a stalled cloud state request ends with a timeout even if fetch ignores abort', async () => {
  const c = setup();
  c.fetch = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(vm.runInContext("fetchCloudBookState('/api/books/book/state', {}, 5)", c), /校对状态请求超时/);
  assert.ok(Date.now() - started < 1000);
});
