import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ console, window: { addEventListener() {} } });
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
assert.equal(vm.runInContext('getBatchPdfRenderDpi(752,3939,260)',ctx),76);
assert.equal(vm.runInContext('getBatchPdfRenderDpi(595,842,260)',ctx),260);
assert.equal(vm.runInContext("hasValidPageOcr({source:'pdf-text',text:'Editable PDF text'})",ctx),true);
vm.runInContext(`
  state.sourceType='pdf'; state.cacheKey='book'; state.pageCount=4; state.pageNum=1;
  state.ocrResults.set(1,{text:'བོད་',lines:[{text:'བོད་'}]});
  var visited=[], saved=[];
  setBusy=(busy)=>{state.isOcrBusy=busy;};
  refreshControls=updateBatchOcrProgress=setStatus=()=>{};
  goToPage=async(page)=>{state.pageNum=page;};
  saveCachedResults=()=>saved.push(state.pageNum);
  runOcrForCurrentPage=async(options)=>{
    if(options.mode!=='ai'||!options.skipPageSync||!options.skipBusy) throw Error('wrong route');
    visited.push(state.pageNum);
    if(state.pageNum===3) throw Error('offline');
    state.ocrResults.set(state.pageNum,{text:'བོད་',lines:[{text:'བོད་'}]});
  };
`, ctx);
await vm.runInContext('runOcrForRemainingPages()', ctx);
assert.deepEqual(Array.from(vm.runInContext('visited',ctx)),[2,3,4]);
assert.deepEqual(Array.from(vm.runInContext('saved',ctx)),[2,4]);
assert.equal(vm.runInContext('state.pageNum',ctx),1);
assert.equal(vm.runInContext('state.batchOcr.failed[0].page',ctx),3);
assert.equal(vm.runInContext('state.batchOcr.running || state.isOcrBusy',ctx),false);
vm.runInContext('visited=[]; saved=[];',ctx);
await vm.runInContext('runOcrForRemainingPages()',ctx);
assert.deepEqual(Array.from(vm.runInContext('visited',ctx)),[3]);
assert.equal(vm.runInContext("hasValidPageOcr({text:'〔红字待人工转录〕',lines:[{text:'〔红字待人工转录〕'}]})",ctx),false);
vm.runInContext(`
  state.ocrResults.delete(2); state.ocrResults.delete(4); visited=[];
  runOcrForCurrentPage=async()=>{
    visited.push(state.pageNum);
    state.ocrResults.set(state.pageNum,{text:'བོད་'});
    state.batchOcr.cancelled=true;
  };
`,ctx);
await vm.runInContext('runOcrForRemainingPages()',ctx);
assert.deepEqual(Array.from(vm.runInContext('visited',ctx)),[2]);
assert.equal(vm.runInContext('state.pageNum',ctx),1);
console.log('Batch skips cached pages, saves each success, resumes failures, stops safely and restores page');

const storage = new Map();
const progressCtx = vm.createContext({ console, window: { addEventListener() {}, localStorage: {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key,value) => storage.set(key,value),
} } });
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), progressCtx);
vm.runInContext(`
  state.cacheKey='book'; state.sourceType='pdf'; state.pageCount=4;
  els.batchOcrProgress={}; els.cancelBatchOcrButton={}; els.batchOcrButton={};
  state.batchOcr={running:true,cancelled:false,currentPage:3,total:4,pages:[2,3,4],skipped:1,success:[2],failed:[]};
  updateBatchOcrProgress(); state.batchOcr=null; updateBatchOcrProgress();
`, progressCtx);
assert.equal(vm.runInContext('state.batchOcr.running', progressCtx),false);
assert.equal(vm.runInContext('state.batchOcr.cancelled', progressCtx),true);
assert.match(vm.runInContext('els.batchOcrProgress.textContent', progressCtx),/剩余 2 页/);
console.log('Interrupted batch progress restores as stopped without changing OCR result schema');

const requests = [];
const cleared = [];
const remoteCtx = vm.createContext({ console, fetch: async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) }); return { ok:true };
}, window: { location:{origin:'https://app.test'}, addEventListener() {}, setTimeout: () => 7, clearTimeout: (id) => cleared.push(id) } });
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), remoteCtx);
vm.runInContext("isCloudDeployment=()=>true; state.remoteBookId='book'; scheduleRemoteStateSave({ocrResults:{1:{text:'བོད་'}},translationResults:{}})", remoteCtx);
assert.equal(requests.length,0);
await vm.runInContext("scheduleRemoteStateSave({ocrResults:{1:{text:'བོད་'}},translationResults:{}},true)", remoteCtx);
assert.deepEqual(cleared,[7]);
assert.equal(requests.length,1);
assert.equal(requests[0].url,'https://app.test/api/books/book/state');
assert.equal(requests[0].body.ocr_results[1].text,'བོད་');
console.log('Immediate per-page remote save cancels debounce and preserves the existing API payload');
