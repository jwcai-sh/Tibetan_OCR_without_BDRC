import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function setup() {
  const storage = new Map();
  const document = {
    querySelector: () => null,
    createElement: () => ({
      dataset: {}, handlers: {},
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, handler) { this.handlers[name] = handler; },
    }),
  };
  const ctx = vm.createContext({console, document, window: {
    addEventListener() {},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
  }});
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`
    state.cacheKey = 'model-controls'; state.pageNum = 1; state.pageCount = 2;
    state.ocrResults.set(1, {source:'proofread', text:'ཀྱི', lines:[], compare:{
      bdrc:{text:'ཀྱི',lines:[{text:'ཀྱི'}]}, llm:{text:'མི',lines:[{text:'མི'}]},
      sharedErrors:[], qwenReviews:[{index:0,text:'བོད',errorRanges:[{start:0,end:2}]}],
      openaiReviews:[{index:0,text:'ཆོ',errorRanges:[{start:0,end:2}]}],
    }});
    renderCurrentOcrView = updateOcrPanelForPage = renderHomeDashboard = scheduleRemoteStateSave = () => {};
    updateSummary = updateTranslationSummary = () => {};
    setStatus = message => { window.lastStatus = message; };
  `, ctx);
  return ctx;
}

test('each model has an independent collapse control that survives rerender', () => {
  const ctx = setup();
  const result = vm.runInContext(`(() => {
    const bdrc = {hidden:false}; const gemini = {hidden:false};
    const bdrcButton = makeProofreadModelToggle(0, 'bdrc', bdrc);
    const geminiButton = makeProofreadModelToggle(0, 'llm', gemini);
    bdrcButton.handlers.click({stopPropagation(){}});
    const reopened = {hidden:false};
    makeProofreadModelToggle(0, 'bdrc', reopened);
    return {bdrc:bdrc.hidden,gemini:gemini.hidden,reopened:reopened.hidden,
      expanded:bdrcButton['aria-expanded']};
  })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {bdrc:true,gemini:false,reopened:true,expanded:'false'});
});

test('clear-error action is labeled 撤销 and follows the model selector', () => {
  const ctx = setup();
  const button = vm.runInContext("renderClearSharedErrorButton(0, {}, 'qwen')", ctx);
  assert.match(button.innerHTML, /撤销<\/span>/);
  assert.doesNotMatch(button.innerHTML, /撤销标错/);
  assert.equal(button['aria-label'], '千问撤销');

  const result = vm.runInContext(`(() => {
    const items = ['review button', 'model selector'];
    const selector = {insertAdjacentElement(position, action) {
      if (position !== 'afterend') throw new Error('actions must follow the selector');
      items.splice(items.indexOf('model selector') + 1, 0, action);
    }};
    const controls = {querySelector: () => selector, append: action => items.push(action)};
    appendProofreadErrorActionsAfterModelSelector(controls, 'undo and mark');
    return items;
  })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), ['review button', 'model selector', 'undo and mark']);
});

test('error actions remain available in headings without a model selector', () => {
  const ctx = setup();
  const result = vm.runInContext(`(() => {
    const items = ['heading', 'metadata'];
    const title = {insertAdjacentElement(position, action) {
      if (position !== 'afterend') throw new Error('actions must follow the heading title');
      items.splice(items.indexOf('heading') + 1, 0, action);
    }};
    const header = {querySelector: () => title};
    const controls = {querySelector: () => null, append: action => items.push(action)};
    appendProofreadErrorActionsAfterModelSelector(controls, 'undo and mark', header);
    return items;
  })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), ['heading', 'undo and mark', 'metadata']);
});

test('model collapse controls align to the right edge of every section header', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.proofread-model-toggle\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(css, /\.proofread-model-section\s+\.proofread-inline-action-group\s*\{[^}]*margin-left:\s*0/s);
});

test('a model mark button rejects a selection from another model', () => {
  const ctx = setup();
  vm.runInContext(`
    getSelectedProofreadRange = () => ({side:'llm',index:0,start:0,end:2});
    markSelectedSharedError(0, {}, 'bdrc');
  `, ctx);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors.length', ctx), 0);
  assert.match(ctx.window.lastStatus, /BDRC/);
});

test('clearing one model without a selection leaves other model errors intact', () => {
  const ctx = setup();
  vm.runInContext(`
    const c = state.ocrResults.get(1).compare;
    c.sharedErrors = [
      {blockIndex:0,bdrcRanges:[{start:0,end:2}],llmRanges:[]},
      {blockIndex:0,bdrcRanges:[],llmRanges:[{start:0,end:2}]},
    ];
    getSelectedProofreadRange = () => null;
    clearSharedErrorMark(0, {}, 'qwen');
  `, ctx);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].errorRanges.length', ctx), 0);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.openaiReviews[0].errorRanges.length', ctx), 1);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors.length', ctx), 2);
  vm.runInContext("clearSharedErrorMark(0, {}, 'bdrc')", ctx);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors.length', ctx), 1);
  assert.equal(vm.runInContext('state.ocrResults.get(1).compare.sharedErrors[0].llmRanges.length', ctx), 1);
});

test('marking and clearing errors refresh only the affected block without rerendering the OCR panel', () => {
  const ctx = setup();
  vm.runInContext(`
    window.fullRenders = 0;
    window.errorMarkRefreshes = [];
    renderCurrentOcrView = updateOcrPanelForPage = () => { window.fullRenders += 1; };
    refreshProofreadErrorMarkDisplay = (index, provider = "") => window.errorMarkRefreshes.push([index, provider]);
    getSelectedProofreadRange = () => ({side:'bdrc',index:0,start:0,end:1});
    markSelectedSharedError(0, {});
    getSelectedProofreadRange = () => null;
    clearSharedErrorMark(0, {}, 'bdrc');
  `, ctx);
  assert.equal(ctx.window.fullRenders, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.errorMarkRefreshes)), [[0, ''], [0, '']]);
});

test('independent candidate mark and clear refresh only that candidate', () => {
  const ctx = setup();
  vm.runInContext(`
    window.fullRenders = 0;
    window.errorMarkRefreshes = [];
    renderCurrentOcrView = updateOcrPanelForPage = () => { window.fullRenders += 1; };
    refreshProofreadErrorMarkDisplay = (index, provider = "") => window.errorMarkRefreshes.push([index, provider]);
    getSelectedProofreadRange = () => ({index:0,reviewProvider:'qwen',sourceText:'བོད',start:0,end:1});
    markSelectedSharedError(0, {});
    clearSharedErrorMark(0, {});
  `, ctx);
  assert.equal(ctx.window.fullRenders, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.window.errorMarkRefreshes)), [[0, 'qwen'], [0, 'qwen']]);
});
