import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const helperStart=app.indexOf('function joinActiveOcrLines(');
const helperEnd=app.indexOf('function renderDeletedProofreadBlockCard(',helperStart);
assert.notEqual(helperStart,-1,'block deletion helpers must exist');
assert.notEqual(helperEnd,-1,'deleted block view renderer must exist');

const persisted={
 text:'错误候选\n正确候选',
 lines:[{text:'错误候选',index:0},{text:'正确候选',index:1}],
 compare:{
  bdrc:{text:'BDRC错\nBDRC正',lines:[{text:'BDRC错',index:0},{text:'BDRC正',index:1}]},
  llm:{text:'Gemini错\nGemini正',lines:[{text:'Gemini错',index:0},{text:'Gemini正',index:1}]},
  qwenReviews:[{index:0,text:'千问错'}],
  openaiReviews:[{index:1,text:'OpenAI正'}],
  sharedErrors:[{blockIndex:0,text:'错',bdrcRanges:[{start:0,end:1}],llmRanges:[]}],
 },
};
let saves=0;
const context=vm.createContext({
 state:{pageNum:2,ocrResults:new Map([[2,persisted]])},
 getOcrSourceCompare:result=>result.compare,
 saveCachedResults:()=>{saves+=1;},
 updateOcrPanelForPage:()=>{},updateSummary:()=>{},updateThumbnailState:()=>{},
 setStatus:()=>{},
});
vm.runInContext(app.slice(helperStart,helperEnd),context);

assert.equal(context.joinActiveOcrLines([{text:'错块',deleted:true},{text:'保留'}]),'保留');
assert.equal(context.setProofreadBlockDeleted(0,true),true);
assert.equal(persisted.lines[0].deleted,true);
assert.equal(persisted.compare.bdrc.lines[0].deleted,true);
assert.equal(persisted.compare.llm.lines[0].deleted,true);
assert.equal(persisted.text,'正确候选');
assert.equal(persisted.compare.bdrc.text,'BDRC正');
assert.equal(persisted.compare.llm.text,'Gemini正');
assert.equal(saves,1);

assert.equal(context.setProofreadBlockDeleted(0,false),true);
assert.equal(persisted.lines[0].deleted,false);
assert.equal(persisted.text,'错误候选\n正确候选');
assert.equal(persisted.compare.llm.text,'Gemini错\nGemini正');
assert.equal(saves,2);

console.log('Deleting a wrong OCR block hides it from page text and candidates; undo restores all saved results.');
