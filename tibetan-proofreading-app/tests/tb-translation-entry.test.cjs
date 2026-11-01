const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../tb-translation-entry.js'), 'utf8');
const bookId = '1de68f20c97f46a6a645c6a8f05cbc7f';

function start(search = `?workflow=translation&book_id=${bookId}`) {
  const current = new URL(`https://example.test/tibetan-proofreading-app/${search}`);
  const routeEvents = {};
  const attributes = new Map();
  const classes = new Set(['workbench-mode', 'translation-workflow']);
  let mutationCallback;
  const shell = {
    classList: {
      contains: (value) => classes.has(value),
      toggle: (value, force) => {
        if (force) classes.add(value);
        else classes.delete(value);
      },
    },
  };
  const workbench = { hidden: false };
  const tbView = { hidden: true };
  const frame = {
    getAttribute: (name) => attributes.get(`frame:${name}`),
    setAttribute: (name, value) => attributes.set(`frame:${name}`, value),
  };
  const elements = { workbenchView: workbench, tbTranslationView: tbView, tbTranslationFrame: frame };
  const location = {
    get href() { return current.href; },
    get search() { return current.search; },
    get pathname() { return current.pathname; },
    get hash() { return current.hash; },
  };
  const context = {
    URL,
    URLSearchParams,
    location,
    document: { querySelector: () => shell, getElementById: (id) => elements[id] },
    window: { addEventListener: (name, callback) => { routeEvents[name] = callback; } },
    MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} },
  };
  vm.runInNewContext(script, context);
  return {
    shell, classes, workbench, tbView, frame, location,
    popstate() { routeEvents.popstate(); },
    mutate() { mutationCallback(); },
  };
}

test('translation workflow opens TB comparison directly and preserves its book ID', () => {
  const page = start();
  assert.equal(page.workbench.hidden, true);
  assert.equal(page.tbView.hidden, false);
  assert.equal(page.frame.getAttribute('src'), `/tibetan-proofreading-app/tb-translation.html?book_id=${bookId}&embedded=1`);
  page.workbench.hidden = false;
  page.mutate();
  assert.equal(page.workbench.hidden, true);
});

test('older view=tb links still open TB and OCR keeps its own workbench', () => {
  const page = start(`?workflow=translation&book_id=${bookId}&view=tb`);
  assert.equal(page.tbView.hidden, false);
  page.classes.delete('translation-workflow');
  page.mutate();
  assert.equal(page.tbView.hidden, true);
  assert.equal(page.workbench.hidden, false);
});

test('the TB comparison retains the Gemini model selector', () => {
  const html = fs.readFileSync(path.join(__dirname, '../tb-translation.html'), 'utf8');
  assert.match(html, /<select id="modelAInput" aria-label="Gemini 翻译模型">/);
  assert.match(html, /<option value="gemini:gemini-3\.8-flash">/);
});
