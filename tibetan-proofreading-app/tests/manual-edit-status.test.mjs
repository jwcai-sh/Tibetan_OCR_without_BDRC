import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this._text = '';
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
        return shouldAdd;
      },
      toArray: () => [...classes],
    };
  }

  set className(value) {
    this.classList.toArray().forEach((name) => this.classList.remove(name));
    String(value || '').split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  get className() {
    return this.classList.toArray().join(' ');
  }

  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    return this.children.length ? this.children.map((child) => child.textContent || '').join('') : this._text;
  }

  append(...nodes) {
    nodes.forEach((node) => this.appendChild(node));
  }

  appendChild(node) {
    this._text = '';
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(name, callback) {
    (this.listeners[name] ||= []).push(callback);
  }

  dispatch(name) {
    (this.listeners[name] || []).forEach((callback) => callback({target: this}));
  }
}

function makeContext() {
  const context = vm.createContext({
    console,
    window: {addEventListener() {}},
    document: {
      querySelector: () => null,
      createElement: (tagName) => new FakeElement(tagName),
      createTextNode: (text) => ({textContent: String(text), className: ''}),
    },
  });
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);
  vm.runInContext(`
    saveCachedResults = () => true;
    showProofreadAutoSaveStatus = () => {};
    updateAiOcrPanelMeta = () => {};
    state.pageNum = 1;
    state.ocrQualityReviews = [];
    const compare = {
      bdrc: {text:'བོད་', lines:[{text:'བོད་'}]},
      llm: {text:'བོད་', model:'gemini-test', provider:'gemini', lines:[{text:'བོད་', provider:'gemini'}]},
      sharedErrors: []
    };
    state.ocrResults.set(1, {
      text:'བོད་', lines:[{text:'བོད་', adoptedProvider:'llm'}], compare
    });
    globalThis.compareForTest = compare;
    globalThis.lineForTest = compare.llm.lines[0];
  `, context);
  return context;
}

test('manual OCR edits immediately show a green status and update the displayed error rate', () => {
  const context = makeContext();
  const group = vm.runInContext(`renderProofreadEditorGroup({
    index:0, side:'llm', label:'Gemini 识别', line:lineForTest,
    peerLine:compareForTest.bdrc.lines[0], compare:compareForTest
  })`, context);
  const editor = group.children[1].children[0];
  const status = group.children[0].children[2];
  const quality = group.children[1].children[1];

  editor.textContent = 'བོན་';
  editor.dispatch('input');

  assert.equal(status.hidden, false, 'the edit status should appear before the editor loses focus');
  assert.match(status.textContent, /已人工修改/);
  assert.ok(status.classList.contains('is-manual-edit'), 'the edit status should use the green state');
  assert.match(quality.textContent, /错误 1 字/);
  assert.match(quality.textContent, /错误率 33\.3%/);
});
