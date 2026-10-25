import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let requests = 0;
let timers = new Set();
const context = vm.createContext({
  FormData, Blob, AbortController,
  state: {pageNum:3, sourceName:'sample'}, makePageImageName: ()=>'page.png',
  fetch: async (_url, options) => { requests++; assert.equal(options.method, 'POST'); return {ok:false,status:502}; },
  parseOcrResponse: async ()=>({error:'upstream timed out'}), assertSupportedAiVisionResponse:()=>{},
  window: {setTimeout: (fn, ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id;},clearTimeout:(id)=>{clearTimeout(id);timers.delete(id);}},
  waitForOcrRetry: async()=>{}, isTransientOcrNetworkError:()=>false,
});
vm.runInContext(extract('async function fetchOcrWithTransientRetry(', '\nfunction isTransientOcrNetworkError'), context);
vm.runInContext(extract('async function callAiVisionLineReviewEndpoint(', '\nfunction mergeSourceCoordinates'), context);
await assert.rejects(context.callAiVisionLineReviewEndpoint('/api/line-review',new Blob(['image']),{},'', 'gemini-3.8-flash'), /upstream timed out/);
assert.equal(requests,1,'A failed paid line review must not silently run four times');
assert.equal(timers.size,0,'request timers must be cleared on failure');
console.log('line review sends one request and cleans up its timer');
context.fetch = async (_url, {signal}) => {
  requests++;
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
};
context.window.setTimeout = (fn,ms) => {assert.equal(ms,75000);const id=setTimeout(fn,1);timers.add(id);return id;};
await assert.rejects(context.callAiVisionLineReviewEndpoint('/api/line-review',new Blob(['image']),{}), /75 秒.*原结果保留/);
assert.equal(requests,2);
assert.equal(timers.size,0);
context.fetch = async()=>({ok:true,status:200});
context.parseOcrResponse = async()=>({text:'sample'});
assert.equal((await context.callAiVisionLineReviewEndpoint('/api/line-review',new Blob(['image']),{})).text,'sample');
assert.equal(timers.size,0);
console.log('timeout releases request; success returns transcription; no timers leak');
