import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({
  console,
  window: {addEventListener() {}},
  document: {querySelector: () => null},
});
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);

test('one marked Tibetan stacked glyph counts as one error', () => {
  const stats = vm.runInContext(`getLineQualityStats(
    {text:'ཀྱིམ'},
    {sharedErrors:[{blockIndex:0,llmRanges:[{start:0,end:3}]}]},
    'llm', 0
  )`, context);
  assert.equal(stats.totalChars, 2);
  assert.equal(stats.errorChars, 1);
  assert.equal(stats.errorRate, 0.5);
});

test('overlapping marks on one glyph do not double count, adjacent glyphs do', () => {
  assert.equal(vm.runInContext("countErrorRanges('ཀྱིམ',[{start:0,end:2},{start:1,end:3}])", context), 1);
  assert.equal(vm.runInContext("countErrorRanges('ཀྱིམ',[{start:0,end:4}])", context), 2);
});

test('saved OCR quality uses the same visible character units as the line header', () => {
  const saved = vm.runInContext(`(() => {
    const compare = {llm:{model:'test',provider:'gemini'},sharedErrors:[
      {blockIndex:0,llmRanges:[{start:0,end:3}]}
    ]};
    state.ocrQualityReviews = [];
    saveOcrQualityReview({result:{},compare,pageNum:1,blockIndex:0,text:'ཀྱིམ'});
    return state.ocrQualityReviews[0];
  })()`, context);
  assert.equal(saved.reviewedChars, 2);
  assert.equal(saved.errorChars, 1);
});

test('changing one stacked glyph counts as one manual edit', () => {
  const edited = vm.runInContext(`updateManualEditTracking({}, 'ཀྱེམ', 'ཀྱིམ')`, context);
  assert.equal(edited.manualErrorChars, 1);
});

test('manual edit ranges use UTF-16 offsets and cover the complete Tibetan cluster', () => {
  const range = vm.runInContext("getChangedTextRange('ཀྱིམ', 'གྱིམ')", context);
  assert.deepEqual({ start: range.start, end: range.end }, { start: 0, end: 3 });
});

test('manual edit ranges stay aligned after an earlier multi-codepoint Tibetan cluster', () => {
  const range = vm.runInContext("getChangedTextRange('ཀྱིམགྱི', 'ཀྱིམངྱི')", context);
  assert.deepEqual({ start: range.start, end: range.end }, { start: 4, end: 7 });
});

test('legacy cached manual ranges expand to the full Tibetan cluster when rendered', () => {
  const ranges = vm.runInContext(`getManualEditRanges({
    text:'གྱིམ', manuallyEdited:true, manualEditRanges:[{start:0,end:1}]
  })`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(ranges)), [{ start: 0, end: 3 }]);
});

test('Gemini error highlight paints the whole Tibetan letter when selection hits only its combining mark', () => {
  const markedText = vm.runInContext(`(() => {
    document.createTextNode = (value) => ({ textContent: value, className: '' });
    document.createElement = () => ({ textContent: '', className: '', title: '' });
    const container = { textContent: '', nodes: [], appendChild(node) { this.nodes.push(node); } };
    renderOcrLineMarkup(container, 'ཀྱིམ', { sharedErrorRanges: [{ start: 1, end: 2 }] });
    return container.nodes.filter((node) => node.className.includes('ocr-shared-error-inline'))
      .map((node) => node.textContent).join('');
  })()`, context);
  assert.equal(markedText, 'ཀྱི');
});

test('manual edit ranges are recalculated from the saved baseline when cached offsets are stale', () => {
  const ranges = vm.runInContext(`getManualEditRanges({
    text:'གྱིམ', manualBaselineText:'ཀྱིམ', manuallyEdited:true,
    manualEditRanges:[{start:3,end:4}]
  })`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(ranges)), [{ start: 0, end: 3 }]);
});
