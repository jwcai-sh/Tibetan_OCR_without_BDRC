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

test('no-cache PDF metadata does not start the full-page image before OCR state', async () => {
  const c = setup();
  const result = await Promise.race([
    vm.runInContext("loadRemotePdfWithServerPages('book',1)", c),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 50)),
  ]);
  assert.equal(result, true);
  assert.equal(vm.runInContext('state.remoteInitialPreviewStarted', c), false);
});

test('full-page image starts once after right-column OCR panels have loaded', async () => {
  const c = setup();
  await vm.runInContext("loadRemotePdfWithServerPages('book',1)", c);
  vm.runInContext(`
    var renderCalls = 0;
    var scheduledPreview;
    renderCurrentPage = () => { renderCalls += 1; return Promise.resolve(); };
    window.setTimeout = (callback) => { scheduledPreview = callback; return 1; };
    startRemotePdfInitialPreview(1);
    startRemotePdfInitialPreview(1);
  `, c);
  assert.equal(vm.runInContext('renderCalls', c), 0);
  assert.equal(vm.runInContext('state.remoteInitialPreviewStarted', c), true);
  vm.runInContext('scheduledPreview()', c);
  assert.equal(vm.runInContext('renderCalls', c), 1);
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
