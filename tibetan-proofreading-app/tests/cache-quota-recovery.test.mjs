import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function setup() {
 const c = vm.createContext({console:{warn(){}}, window:{indexedDB:{},addEventListener(){},localStorage:{getItem(){return null},setItem(){throw new Error('QuotaExceededError')}}},document:{querySelector(){return null}}});
 vm.runInContext(code,c);
 vm.runInContext(`state.cacheKey='quota-book';state.pageCount=1;state.ocrResults.set(1,{text:'校对内容',compare:{qwenReviews:[{index:0,text:'千问候选'}]}}); els.homeView={hidden:true};isCloudDeployment=()=>false;setStatus=()=>{};`,c);
 return c;
}
test('quota exhaustion saves full proofreading payload to durable fallback without cloud',async()=>{
 const c=setup();
 vm.runInContext(`writeProofreadFallback=async(key,raw)=>{globalThis.disk={key,raw}}`,c);
 assert.equal(await vm.runInContext('saveCachedResults()',c),true);
 assert.equal(c.disk.key,'quota-book');
 const saved=JSON.parse(c.disk.raw);
 assert.equal(saved.ocrResults['1'].text,'校对内容');
 assert.equal(saved.ocrResults['1'].compare.qwenReviews[0].text,'千问候选');
});
test('fallback failure reports unsuccessful save rather than success',async()=>{
 const c=setup();
 vm.runInContext(`writeProofreadFallback=async()=>{throw new Error('disk full')}`,c);
 assert.equal(await vm.runInContext('saveCachedResults()',c),false);
});
test('reload reads newer durable fallback instead of stale localStorage',()=>{
 const c=setup();
 const fresh={updatedAt:'2026-10-26T01:00:00Z',pageCount:1,ocrResults:{1:{text:'最新校对'}}};
 c.fresh=JSON.stringify(fresh);
 vm.runInContext(`proofreadFallbackRecords.set('quota-book', fresh);window.localStorage.getItem=()=>JSON.stringify({updatedAt:'2026-10-25T01:00:00Z',ocrResults:{1:{text:'旧'}}});updateSummary=updateTranslationSummary=()=>{};`,c);
 assert.equal(vm.runInContext('restoreCachedResults()',c),true);
 assert.equal(vm.runInContext('state.ocrResults.get(1).text',c),'最新校对');
});
test('a newer successful localStorage save wins over an older fallback',()=>{
 const c=setup();
 vm.runInContext(`proofreadFallbackRecords.set('quota-book', JSON.stringify({updatedAt:'2026-10-25T01:00:00Z'}));window.localStorage.getItem=()=>JSON.stringify({updatedAt:'2026-10-26T01:00:00Z',text:'新'});`,c);
 assert.equal(JSON.parse(vm.runInContext("readProofreadCache('quota-book')",c)).text,'新');
});
test('fallback is pending until durable write completes',async()=>{
 const c=setup();
 let finish;
 c.diskWrite=new Promise(resolve=>{finish=resolve});
 vm.runInContext('writeProofreadFallback=()=>diskWrite',c);
 const result=vm.runInContext('saveCachedResults()',c);
 assert.equal(vm.runInContext('state.localProofreadSavePending',c),true);
 finish();assert.equal(await result,true);
 assert.equal(vm.runInContext('state.localProofreadSavePending',c),false);
});

// Exercise the production IndexedDB transaction code with a controllable browser API.
function transactionHarness(c) {
 const transactions=[];let closed=0;
 c.window.indexedDB.open=()=>{
  const req={};queueMicrotask(()=>{
   req.result={close(){closed++},transaction(){
    const tx={objectStore(){return {put(raw,key){tx.value={raw,key}},delete(key){tx.value={key,deleted:true}}}}};
    transactions.push(tx);return tx;
   }};req.onsuccess();
  });return req;
 };
 return {transactions,closed:()=>closed};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('late fallback completion never uploads an obsolete edit after a newer save',async()=>{
 const c=setup();let finish;
 c.diskWrite=new Promise(resolve=>{finish=resolve});
 vm.runInContext(`writeProofreadFallback=()=>diskWrite;globalThis.uploaded=[];scheduleRemoteStateSave=p=>{uploaded.push(p.ocrResults['1'].text)}`,c);
 const older=vm.runInContext('saveCachedResults()',c);
 vm.runInContext(`window.localStorage.setItem=()=>{};state.ocrResults.get(1).text='后续校对';saveCachedResults()`,c);
 finish();await older;
 assert.deepEqual(Array.from(c.uploaded),['后续校对']);
});
test('IndexedDB request success does not acknowledge save before transaction commit',async()=>{
 const c=setup(),h=transactionHarness(c);
 const saving=vm.runInContext("writeProofreadFallback('quota-book', 'saved bytes')",c);
 await tick();
 assert.equal(vm.runInContext("proofreadFallbackRecords.has('quota-book')",c),false);
 assert.equal(h.transactions[0].value.raw,'saved bytes');
 h.transactions[0].oncomplete();await saving;
 assert.equal(vm.runInContext("proofreadFallbackRecords.get('quota-book')",c),'saved bytes');
 assert.equal(h.closed(),1);
});
test('aborted IndexedDB write preserves previous confirmed data and a retry can commit',async()=>{
 const c=setup(),h=transactionHarness(c);
 vm.runInContext("proofreadFallbackRecords.set('quota-book','previous bytes')",c);
 const failed=vm.runInContext("writeProofreadFallback('quota-book','failed bytes')",c);
 const rejection=assert.rejects(failed,/abort/);
 await tick();h.transactions[0].error=new Error('abort');h.transactions[0].onabort();await rejection;
 assert.equal(vm.runInContext("proofreadFallbackRecords.get('quota-book')",c),'previous bytes');
 const retry=vm.runInContext("writeProofreadFallback('quota-book','retry bytes')",c);
 await tick();h.transactions[1].oncomplete();await retry;
 assert.equal(vm.runInContext("proofreadFallbackRecords.get('quota-book')",c),'retry bytes');
 assert.equal(h.closed(),2);
});
test('queued IndexedDB writes commit in edit order',async()=>{
 const c=setup(),h=transactionHarness(c);
 const first=vm.runInContext("writeProofreadFallback('quota-book','first')",c);
 const second=vm.runInContext("writeProofreadFallback('quota-book','second')",c);
 await tick();assert.equal(h.transactions.length,1);
 h.transactions[0].oncomplete();await first;await tick();
 assert.equal(h.transactions.length,2);h.transactions[1].oncomplete();await second;
 assert.equal(vm.runInContext("proofreadFallbackRecords.get('quota-book')",c),'second');
});
test('an unreadable fallback record does not hide a valid legacy backup',()=>{
 const c=setup();
 vm.runInContext(`proofreadFallbackRecords.set('quota-book','broken-json');window.localStorage.getItem=()=>JSON.stringify({updatedAt:'2026-10-26T01:00:00Z',text:'有效备份'});`,c);
 assert.equal(JSON.parse(vm.runInContext("readProofreadCache('quota-book')",c)).text,'有效备份');
});
