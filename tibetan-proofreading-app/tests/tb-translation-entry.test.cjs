const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../tb-translation-entry.js'), 'utf8');
const bookId = '1de68f20c97f46a6a645c6a8f05cbc7f';

function start(search = `?workflow=translation&book_id=${bookId}`) {
  let current = new URL(`https://example.test/tibetan-proofreading-app/${search}`);
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
  const link = {
    addEventListener: (name, callback) => { routeEvents[name] = callback; },
    setAttribute: (name, value) => attributes.set(name, value),
  };
  const workbench = { hidden: false };
  const tbView = { hidden: true };
  const frame = {
    getAttribute: (name) => attributes.get(`frame:${name}`),
    setAttribute: (name, value) => attributes.set(`frame:${name}`, value),
  };
  const elements = { tbTranslationLink: link, workbenchView: workbench, tbTranslationView: tbView, tbTranslationFrame: frame };
  const location = {
    get href() { return current.href; },
    get search() { return current.search; },
    get pathname() { return current.pathname; },
    get hash() { return current.hash; },
  };
  const history = {
    state: null,
    pushState(_state, _title, next) { current = new URL(next, current); },
    replaceState(_state, _title, next) { current = new URL(next, current); },
  };
  const context = {
    URL,
    URLSearchParams,
    location,
    history,
    document: { querySelector: () => shell, getElementById: (id) => elements[id] },
    window: { addEventListener: (name, callback) => { routeEvents[name] = callback; } },
    MutationObserver: class { constructor(callback) { mutationCallback = callback; } observe() {} },
  };
  vm.runInNewContext(script, context);
  return {
    shell, classes, link, workbench, tbView, frame, attributes, location,
    click() { routeEvents.click({ preventDefault() {} }); },
    popstate() { routeEvents.popstate(); },
    mutate() { mutationCallback(); },
  };
}

test('TB comparison opens inside the translation workbench and preserves its book ID', () => {
  const page = start();
  assert.equal(page.tbView.hidden, true);
  page.click();
  assert.equal(page.location.search.includes('view=tb'), true);
  assert.equal(page.workbench.hidden, true);
  assert.equal(page.tbView.hidden, false);
  assert.equal(page.frame.getAttribute('src'), `/tibetan-proofreading-app/tb-translation.html?book_id=${bookId}&embedded=1`);
  assert.equal(page.link.textContent, '返回逐页翻译');
  assert.equal(page.attributes.get('aria-expanded'), 'true');
  page.workbench.hidden = false;
  page.mutate();
  assert.equal(page.workbench.hidden, true);
  page.click();
  assert.equal(page.location.search.includes('view=tb'), false);
  assert.equal(page.workbench.hidden, false);
  assert.equal(page.tbView.hidden, true);
  assert.equal(page.frame.getAttribute('src').includes(bookId), true);
});

test('a direct TB view route opens embedded and going home clears the TB route', () => {
  const page = start(`?workflow=translation&book_id=${bookId}&view=tb`);
  assert.equal(page.tbView.hidden, false);
  page.classes.delete('translation-workflow');
  page.classes.add('home-mode');
  page.mutate();
  assert.equal(page.tbView.hidden, true);
  assert.equal(page.location.search.includes('view=tb'), false);
});
