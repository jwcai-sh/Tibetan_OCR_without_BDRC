import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup() {
  const storage = new Map();
  const context = vm.createContext({
    console,
    document: { querySelector: () => null },
    window: {
      addEventListener() {},
      localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
    },
  });
  vm.runInContext(readFileSync(new URL("../app.js", import.meta.url), "utf8"), context);
  vm.runInContext(`
    state.cacheKey = 'auto-save-check'; state.pageNum = 1; state.pageCount = 2;
    els.ocrText = { value: 'བོད་' };
    renderHomeDashboard = updateAiOcrPanelMeta = updateSummary = updateTranslationSummary = () => {};
    scheduleRemoteStateSave = () => {};
    state.ocrResults.set(1, {
      source:'proofread', text:'བོད་', lines:[{text:'བོད་', adoptedProvider:'bdrc'}],
      compare:{
        bdrc:{text:'བོད་', lines:[{text:'བོད་'}]},
        llm:{text:'མི་', model:'gemini', provider:'gemini', lines:[{text:'མི་'}]},
        qwenReviews:[{index:0,text:'ཆོས་'}], sharedErrors:[],
      },
    });
  `, context);
  return { context, storage };
}

test("editing the adopted BDRC line immediately saves the model and final page text", () => {
  const { context, storage } = setup();
  vm.runInContext(`updateProofreadCompareLine('bdrc', 0, 'བོན་', {text:'བོད་'}, null)`, context);
  const saved = JSON.parse(storage.get("auto-save-check")).ocrResults["1"];
  assert.equal(saved.compare.bdrc.lines[0].text, "བོན་");
  assert.equal(saved.lines[0].text, "བོན་");
  assert.equal(saved.text, "བོན་");
  assert.equal(saved.compare.llm.lines[0].text, "མི་");
  assert.equal(vm.runInContext("state.ocrResults.clear(); restoreCachedResults()", context), true);
  assert.equal(vm.runInContext("state.ocrResults.get(1).text", context), "བོན་");
});

test("editing another model saves its candidate without replacing the adopted text", () => {
  const { context, storage } = setup();
  vm.runInContext(`updateProofreadCompareLine('llm', 0, 'མང་', {text:'མི་'}, null)`, context);
  const saved = JSON.parse(storage.get("auto-save-check")).ocrResults["1"];
  assert.equal(saved.compare.llm.lines[0].text, "མང་");
  assert.equal(saved.lines[0].text, "བོད་");
  assert.equal(saved.text, "བོད་");
});

test("editing an adopted Qwen candidate immediately updates saved final text", () => {
  const { context, storage } = setup();
  vm.runInContext(`
    const result = state.ocrResults.get(1);
    result.lines[0] = {text:'ཆོས་', adoptedProvider:'qwen'};
    result.text = 'ཆོས་';
    updateIndependentReviewText('qwen', 0, 'ཆོས་ལྡན་');
  `, context);
  const saved = JSON.parse(storage.get("auto-save-check")).ocrResults["1"];
  assert.equal(saved.compare.qwenReviews[0].text, "ཆོས་ལྡན་");
  assert.equal(saved.lines[0].text, "ཆོས་ལྡན་");
  assert.equal(saved.text, "ཆོས་ལྡན་");
  assert.equal(saved.compare.bdrc.lines[0].text, "བོད་");
});

test("Gemini error marks save immediately with updated quality stats", () => {
  const { context, storage } = setup();
  vm.runInContext(`
    getSelectedProofreadRange = () => ({side:'llm',index:0,start:0,end:1});
    refreshProofreadErrorMarkDisplay = setStatus = () => {};
    markSelectedSharedError(0, {}, 'llm');
  `, context);
  const saved = JSON.parse(storage.get("auto-save-check"));
  assert.equal(saved.ocrResults["1"].compare.sharedErrors.length, 1);
  assert.equal(saved.ocrQualityReviews[0].errorChars, 1);
});

test("manually transcribed failed Gemini line becomes an adoptable saved candidate", () => {
  const { context, storage } = setup();
  vm.runInContext(`
    const result = state.ocrResults.get(1);
    result.compare.llm.lines[0] = {
      text:'〔本行识别失败，待重新识别〕', error:true, missing:true,
      diagnostic:true, recognitionError:'timed out',
    };
    updateProofreadCompareLine('llm', 0, 'མི་རྟག་', {...result.compare.llm.lines[0]}, null);
  `, context);
  const saved = JSON.parse(storage.get("auto-save-check")).ocrResults["1"];
  assert.equal(saved.compare.llm.lines[0].text, "མི་རྟག་");
  assert.equal(saved.compare.llm.lines[0].diagnostic, false);
  assert.equal(saved.compare.llm.lines[0].missing, false);
  assert.equal(saved.compare.llm.lines[0].recognitionError, "");
  assert.equal(saved.text, "བོད་");
});

test("edits to separate blocks and model candidates survive a page reload", () => {
  const { context, storage } = setup();
  vm.runInContext(`
    const result = state.ocrResults.get(1);
    result.lines.push({text:'ཆོས་', adoptedProvider:'bdrc'});
    result.compare.bdrc.lines.push({text:'ཆོས་'});
    result.compare.llm.lines.push({text:'དགེ་'});
    result.compare.qwenReviews.push({index:1,text:'བླ་མ་'});
    updateProofreadCompareLine('bdrc', 0, 'བོན་', {text:'བོད་'}, null);
    updateProofreadCompareLine('llm', 1, 'དག་', {text:'དགེ་'}, null);
    updateIndependentReviewText('qwen', 1, 'བླ་མ་རྣམས་');
    state.ocrResults.clear();
    if (!restoreCachedResults()) throw new Error('saved blocks did not restore');
  `, context);
  const saved = JSON.parse(storage.get("auto-save-check")).ocrResults["1"];
  assert.equal(saved.compare.bdrc.lines[0].text, "བོན་");
  assert.equal(saved.compare.llm.lines[1].text, "དག་");
  assert.equal(saved.compare.qwenReviews[1].text, "བླ་མ་རྣམས་");
  assert.equal(saved.lines[0].text, "བོན་");
  assert.equal(saved.lines[1].text, "ཆོས་");
  assert.equal(vm.runInContext("state.ocrResults.get(1).compare.qwenReviews[1].text", context), "བླ་མ་རྣམས་");
});

test("clearing every line remains cleared after reopening a text project", () => {
  const { context, storage } = setup();
  vm.runInContext(`
    state.ocrResults.set(1, {text:'', lines:[{text:'', index:0}], source:'text-file'});
    saveCachedResults();
    state.ocrResults.clear();
    if (!restoreCachedResults()) throw new Error('empty result did not restore');
  `, context);
  assert.equal(JSON.parse(storage.get("auto-save-check")).ocrResults["1"].text, "");
  assert.equal(vm.runInContext("state.ocrResults.has(1)", context), true);
  assert.equal(vm.runInContext("state.ocrResults.get(1).lines[0].text", context), "");
});

test("editing an adopted block in text view updates only that model candidate", () => {
  const { context, storage } = setup();
  vm.runInContext(`
    const result = state.ocrResults.get(1);
    const previous = result.lines;
    const next = [{...previous[0], text:'བོན་'}];
    result.compare = syncTextViewEditsToAdoptedModels(result, next, ['བོན་']);
    result.lines = next;
    result.text = 'བོན་';
    saveCachedResults();
  `, context);
  const payload = JSON.parse(storage.get("auto-save-check"));
  const saved = payload.ocrResults["1"];
  assert.equal(saved.compare.bdrc.lines[0].text, "བོན་");
  assert.equal(saved.compare.llm.lines[0].text, "མི་");
  assert.equal(saved.lines[0].text, "བོན་");
  assert.equal(payload.ocrQualityReviews[0].blockIndex, 0);
});

test("line editor reports local storage failure instead of claiming saved", () => {
  const { context } = setup();
  context.console = { ...console, warn() {} };
  vm.runInContext(`
    window.localStorage.setItem = () => { throw new Error('quota exceeded'); };
    updateThumbnailState = () => {};
  `, context);
  assert.equal(vm.runInContext("syncLineEditorsToResult([{text:'བོན་'}])", context), false);
});
