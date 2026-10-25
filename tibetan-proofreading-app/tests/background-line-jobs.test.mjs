import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('const geminiJobStorageKey');
const end = source.indexOf('async function reRecognizeGeminiRowLegacy', start);
let busy = false, writes = 0, posts = 0, resolvePost;
const original = {text:'accepted human text', compare:{llm:{lines:[{text:'old candidate',model:'gemini-3.1-flash-lite'}]}, sharedErrors:[]}};
const state = {cacheKey:'book1', pageNum:3, ocrResults:new Map([[3,original]])};
const context = vm.createContext({
  state, cloudLibrary:{actor:'alice'}, pageReviewPending:false,
  FormData, Blob, URL, AbortSignal, crypto:{randomUUID:()=> 'abcdefab-cdef-abcd-efab-cdefabcdefab'},
  location:{href:'https://example.test/'},
  sessionStorage:{setItem:()=>{}},
  getAiVisionLineReviewEndpoint:()=>'/api/line-review',
  getOcrSourceCompare:r=>r?.compare, getSourceLineForRow:s=>s, normalizeBbox:b=>b,
  setBusy:v=>{busy=v;}, setStatus:()=>{}, getCurrentPageImageBlob:async()=>new Blob(['original']),
  normalizeOcrTextSpacing:s=>s, validateIndependentReviewText:s=>s,
  normalizeSharedErrorMarks:m=>m, joinActiveOcrLines:lines=>lines.map(l=>l.text).join('\n'),
  countNonEmptyOcrLines:lines=>lines.length, pendingGeminiRowModels:new Map(), updateOcrPanelForPage:()=>{},
  saveCachedResults:()=>{writes++;return Promise.resolve();},
  fetch:async(url,options)=>{
    if(options.method === 'POST') {
      posts++;
      assert.equal(busy,false,'Page must be unlocked before upload/model wait');
      assert.equal(await options.body.get('file').text(),'original');
      return new Promise(resolve=>{resolvePost=resolve;});
    }
    return {ok:true,status:200,json:async()=>({status:'running'})};
  },
  parseOcrResponse:async r=>{const raw=await r.json();return {raw,error:raw.error || raw.detail};},
});
vm.runInContext(source.slice(start,end),context);
const actualPoll = context.pollGeminiJobs;
vm.runInContext('renderGeminiJobs = () => {}; pollGeminiJobs = async () => {};',context);
const pending = context.reRecognizeGeminiRow(0,{value:'gemini-3.8-flash'},{bbox:{x:0,y:0,width:1,height:1}},{});
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(busy,false);
assert.equal(posts,1);
await context.reRecognizeGeminiRow(0,{value:'gemini-3.8-flash'},{bbox:{}},{});
assert.equal(posts,1,'Same line cannot submit twice');
resolvePost({ok:true,status:202,json:async()=>({status:'queued'})});
await pending;
const job = vm.runInContext('geminiBackgroundJobs[0]',context);
context.fetch = async()=>({ok:true,status:200,json:async()=>({status:'completed',result:{text:'new model candidate',model:'gemini-3.8-flash'}})});
await actualPoll();
assert.equal(job.status,'completed');
assert.equal(writes,0,'Polling must not overwrite proofreading');
state.pageNum=4;
assert.equal(context.geminiJobCanApply(job),false,'Wrong page must not be changed');
state.pageNum=3;
original.compare.llm.lines[0].text='new human edit';
await context.applyGeminiJob(job);
assert.equal(writes,0,'Concurrent edits must prevent application');
assert.equal(original.compare.llm.lines[0].text,'new human edit');
original.compare.llm.lines[0].text='old candidate';
await context.applyGeminiJob(job);
assert.equal(original.compare.llm.lines[0].text,'new model candidate');
assert.equal(original.text,'accepted human text','Adopted proofreading must be preserved');
assert.equal(writes,1);
assert.equal(job.status,'applied');
console.log('Background submission unlocks page, blocks duplicates and protects page/row edits and adopted text.');

const records = JSON.stringify([job]);
context.sessionStorage.getItem = () => records;
context.window = {setInterval:()=>0};
context.initializeGeminiJobs();
assert.equal(vm.runInContext('geminiBackgroundJobs[0].result.text', context),'new model candidate','Refresh restores saved candidate');
console.log('Polling only retrieves results; refresh restores task records.');

// Cloud PDFs submit only a source reference; the server uses the same DPI/PNG.
vm.runInContext('geminiBackgroundJobs = [];',context);
state.remoteServerPdf=true; state.remoteBookId='c'.repeat(32);
context.els={dpiInput:{value:'260'}};
context.getCurrentPageImageBlob=async()=>{throw new Error('must not download/re-upload cloud original');};
context.fetch=async(url,options)=>{
  assert.equal(options.body.has('file'),false);
  assert.equal(options.body.get('book_id'),state.remoteBookId);
  assert.equal(options.body.get('page_num'),'3');
  assert.equal(options.body.get('dpi'),'260');
  return {ok:true,status:202,json:async()=>({status:'queued'})};
};
await context.reRecognizeGeminiRow(0,{value:'gemini-3.8-flash'},{bbox:{}},{});
assert.equal(vm.runInContext('geminiBackgroundJobs[0].status',context),'queued');
console.log('Cloud original reference avoids image transfer and preserves DPI.');
