import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function context() {
  const ctx = vm.createContext({window: {addEventListener() {}}, document: {
    querySelector: () => ({classList: {contains: () => true}}),
  }, console});
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`state.pageNum = 1; state.pageCount = 2;
    state.ocrResults.set(1, {source: 'bdrc', text: 'བོད་\\n〔红字待人工转录〕', lines: [
      {text: 'བོད་', bbox: {x:.2,y:.3,width:.4,height:.05}, regionLabel:'中间'},
      {text: '〔红字待人工转录〕', missing:true, bbox:{x:.4,y:.6,width:.2,height:.04}, regionLabel:'中间'}
    ]});`, ctx);
  return ctx;
}

test('entering proofread retains original BDRC coordinates and text', () => {
  const ctx=context();
  const before=vm.runInContext('JSON.stringify(state.ocrResults.get(1).lines)',ctx);
  const after=vm.runInContext('JSON.stringify(ensureProofreadCompareResult().compare.bdrc.lines.map(({text,bbox,regionLabel})=>({text,bbox,regionLabel})))',ctx);
  const expected=JSON.parse(before).map(({text,bbox,regionLabel})=>({text,bbox,regionLabel}));
  assert.deepEqual(JSON.parse(after),expected);
});

test('single-pane display retains BDRC rows after visiting proofread, even with a partial AI review', () => {
  const ctx=context();
  vm.runInContext(`const c=ensureProofreadCompareResult().compare;
    c.llm.lines=[{text:''},{text:'དམར་',bbox:c.bdrc.lines[1].bbox}]; c.llm.text='དམར་';`,ctx);
  const before=vm.runInContext('JSON.stringify(state.ocrResults.get(1))',ctx);
  const display=JSON.parse(vm.runInContext('JSON.stringify(getPrimaryOcrDisplay(getCurrentOcrCompareOrEmpty()))',ctx));
  assert.equal(display.side.lines[0].text,'བོད་');
  assert.equal(display.side.lines[1].text,'དམར་');
  assert.deepEqual(display.side.lines[1].bbox,{x:.4,y:.6,width:.2,height:.04});
  assert.equal(vm.runInContext('JSON.stringify(state.ocrResults.get(1))',ctx),before,'display must not mutate stored results');
});

test('manual BDRC edits update the displayed line quality count immediately', () => {
  const ctx=context();
  vm.runInContext(`
    state.ocrResults.set(1, {source:'proofread', text:'བོད་', lines:[], compare:{
      bdrc:{text:'བོད་', lines:[{text:'བོད་'}]},
      llm:{text:'', lines:[]}, sharedErrors:[]
    }});
    updateAiOcrPanelMeta = () => {};
    const displayedLine = getEffectiveOcrSideLines(getOcrSourceCompare(state.ocrResults.get(1)).bdrc)[0];
    updateProofreadCompareLine('bdrc', 0, 'བོན་', displayedLine, null);
    globalThis.displayedQuality = getLineQualityStats(displayedLine, getOcrSourceCompare(state.ocrResults.get(1)), 'bdrc', 0);
  `,ctx);
  const quality=JSON.parse(vm.runInContext('JSON.stringify(displayedQuality)',ctx));
  assert.equal(quality.manualChars,1);
  assert.equal(quality.errorChars,1);
  assert.equal(vm.runInContext("getEffectiveOcrSideLines(getOcrSourceCompare(state.ocrResults.get(1)).bdrc)[0].manualErrorChars",ctx),1,
    'manual edit count must survive rebuilding normalized display rows');
});

test('manual edits persist their changed character range and render a green box', () => {
  const ctx=context();
  ctx.document.createElement = () => ({children: [], appendChild(node) { this.children.push(node); }});
  ctx.document.createTextNode = (text) => ({textContent: text});
  vm.runInContext(`
    state.ocrResults.set(1, {source:'proofread', text:'བོད་', lines:[], compare:{
      bdrc:{text:'བོད་', lines:[{text:'བོད་'}]},
      llm:{text:'', lines:[]}, sharedErrors:[]
    }});
    updateAiOcrPanelMeta = () => {};
    const displayedLine = getEffectiveOcrSideLines(getOcrSourceCompare(state.ocrResults.get(1)).bdrc)[0];
    updateProofreadCompareLine('bdrc', 0, 'བོན་', displayedLine, null);
    globalThis.manualRange = getEffectiveOcrSideLines(getOcrSourceCompare(state.ocrResults.get(1)).bdrc)[0].manualEditRanges;
    globalThis.serializedRange = serializeResultMap(state.ocrResults)[1].compare.bdrc.lines[0].manualEditRanges;
    globalThis.legacyRange = getManualEditRanges({manualBaselineText:'བོད་',text:'བོན་',manuallyEdited:true});
    globalThis.legacyMarkup = document.createElement('div');
    renderOcrLineMarkup(legacyMarkup, 'བོན་', {manualEditRanges:legacyRange});
    globalThis.manualMarkup = document.createElement('div');
    renderOcrLineMarkup(manualMarkup, 'བོན་', {
      manualEditRanges: manualRange,
      sharedErrorRanges: [{start:2,end:3}],
    });
  `,ctx);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(manualRange)',ctx)),[{start:2,end:3}],
    'the changed character range must survive rebuilding display rows');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(serializedRange)',ctx)),[{start:2,end:3}],
    'the changed character range must be included in saved OCR results');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(legacyRange)',ctx)),[{start:2,end:3}],
    'older manual edits should derive their range from the stored baseline');
  assert.ok(vm.runInContext('legacyMarkup.children.some(node=>node.className?.includes("ocr-manual-edit-inline"))',ctx),
    'older baseline-only edits should also render with a green box');
  const classes=vm.runInContext('manualMarkup.children.map(node=>node.className || "")',ctx);
  assert.ok(classes.some(value=>value.includes('ocr-manual-edit-inline')),'edited characters should receive the green manual-edit class');
  assert.ok(classes.some(value=>value.includes('ocr-shared-error-inline')),'manual edit highlight must coexist with a red error mark');
});
