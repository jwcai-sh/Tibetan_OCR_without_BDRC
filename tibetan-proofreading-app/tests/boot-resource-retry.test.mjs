import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0]?.[1];
assert.match(inline, /window\.setTimeout\(window\.__tibetanWorkbenchBootFailure, 90000\)/,
  'slow cross-region asset loads must not be treated as failed after 30 seconds');

function boot(store = new Map()) {
  const nodes = Object.fromEntries(['collaborationActorLabel', 'cloudLibraryAuthTitle', 'cloudLibraryAuthHint', 'collaborationRetryButton'].map(id => [id, { textContent: '', hidden: true }]));
  const callbacks = [];
  const events = new Map();
  let reloads = 0;
  const window = {
    sessionStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    location: { reload: () => { reloads += 1; } },
    setTimeout: callback => { callbacks.push(callback); },
  };
  const document = { getElementById: id => nodes[id], addEventListener: (name, callback) => events.set(name, callback) };
  vm.runInNewContext(inline, { window, document });
  return { window, document, nodes, callbacks, events, store, get reloads() { return reloads; } };
}

test('failed boot automatically reloads once, then exposes manual retry without a reload loop', () => {
  const page = boot();
  page.window.__tibetanWorkbenchBootFailure();
  assert.equal(page.nodes.collaborationRetryButton.hidden, false);
  assert.match(page.nodes.collaborationActorLabel.textContent, /加载失败/);
  page.callbacks.at(-1)();
  assert.equal(page.reloads, 1);
  const retriedPage = boot(page.store);
  retriedPage.window.__tibetanWorkbenchBootFailure();
  retriedPage.callbacks.at(-1)();
  assert.equal(retriedPage.reloads, 0);
  assert.equal(retriedPage.nodes.collaborationRetryButton.hidden, false);
});

test('stylesheet failure before the body exists still shows the retry control after DOM readiness', () => {
  const page = boot();
  const get = page.document.getElementById;
  page.document.getElementById = () => null;
  page.window.__tibetanWorkbenchBootFailure();
  page.document.getElementById = get;
  page.events.get('DOMContentLoaded')();
  assert.equal(page.nodes.collaborationRetryButton.hidden, false);
  assert.match(page.nodes.cloudLibraryAuthTitle.textContent, /页面资源加载失败/);
});

test('successful boot resets the retry budget for a later visit', () => {
  const page = boot();
  page.window.__tibetanWorkbenchBootFailure();
  page.callbacks.at(-1)();
  const retriedPage = boot(page.store);
  retriedPage.window.__tibetanWorkbenchBootReady = true;
  retriedPage.window.__tibetanWorkbenchBootSuccess();
  assert.equal(page.store.size, 0);
});
