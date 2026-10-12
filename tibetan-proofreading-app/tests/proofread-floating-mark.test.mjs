import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function setup() {
  const ctx = vm.createContext({console, document: {
    querySelector: () => null,
    createElement: () => ({dataset:{}, setAttribute(){}, addEventListener(){}}),
  }, window: {addEventListener(){}, localStorage:{getItem:()=>null,setItem(){}}}});
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('floating mark action resolves the selected Tibetan text to its model and block', () => {
  const ctx = setup();
  const targets = vm.runInContext(`[
    getProofreadFloatingMarkTarget({side:'bdrc',index:2,text:'བོད'}),
    getProofreadFloatingMarkTarget({side:'llm',index:4,text:'བོད'}),
    getProofreadFloatingMarkTarget({side:'llm',reviewProvider:'qwen',index:5,text:'བོད'}),
    getProofreadFloatingMarkTarget({side:'llm',reviewProvider:'openai',index:6,text:'བོད'}),
  ]`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(targets)), [
    {index:2,provider:'bdrc'},
    {index:4,provider:'llm'},
    {index:5,provider:'qwen'},
    {index:6,provider:'openai'},
  ]);
});

test('floating mark action ignores empty, non-Tibetan, or unsupported selections', () => {
  const ctx = setup();
  const targets = vm.runInContext(`[
    getProofreadFloatingMarkTarget(null),
    getProofreadFloatingMarkTarget({side:'bdrc',index:0,text:' '}),
    getProofreadFloatingMarkTarget({side:'bdrc',index:0,text:'English'}),
    getProofreadFloatingMarkTarget({side:'unknown',index:0,text:'བོད'}),
    getProofreadFloatingMarkTarget({side:'bdrc',index:-1,text:'བོད'}),
  ]`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(targets)), [null, null, null, null, null]);
});

test('floating mark action position stays inside the visible viewport', () => {
  const ctx = setup();
  const positions = vm.runInContext(`[
    getProofreadFloatingMarkPosition(100, 100, 64, 34, 800, 600),
    getProofreadFloatingMarkPosition(790, 590, 64, 34, 800, 600),
  ]`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(positions)), [
    {left:112,top:112},
    {left:714,top:544},
  ]);
});

test('floating mark action writes the selected range through the existing model mark flow', () => {
  const ctx = setup();
  vm.runInContext(`
    state.cacheKey = 'floating-mark'; state.pageNum = 1;
    state.ocrResults.set(1, {source:'proofread',text:'ཀྱི',lines:[{text:'ཀྱི'}],compare:{
      bdrc:{text:'ཀྱི',lines:[{text:'ཀྱི'}]},llm:{text:'ཁྱི',lines:[{text:'ཁྱི'}]},sharedErrors:[],
    }});
    getSelectedProofreadRange = () => ({side:'bdrc',index:0,start:0,end:1,text:'ཀ',sourceText:'ཀྱི'});
    saveCachedResults = refreshProofreadErrorMarkDisplay = () => {};
    setStatus = () => {};
  `, ctx);
  const marked = vm.runInContext('markProofreadFloatingSelection({})', ctx);
  assert.equal(marked, true);
  const ranges = vm.runInContext(`({
    bdrc:state.ocrResults.get(1).compare.sharedErrors[0].bdrcRanges,
    llm:state.ocrResults.get(1).compare.sharedErrors[0].llmRanges,
  })`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ranges)), {bdrc:[{start:0,end:1}],llm:[]});
});
