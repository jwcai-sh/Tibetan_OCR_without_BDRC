import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const storage=new Map();
const ctx=vm.createContext({console,window:{addEventListener(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}},document:{querySelector:()=>null}});
vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),ctx);
vm.runInContext(`
state.cacheKey='retention';state.pageCount=1;state.pageNum=1;
updateThumbnailState=renderHomeDashboard=scheduleRemoteStateSave=updateOcrPanelForPage=updateSummary=updateTranslationSummary=setStatus=setOcrView=()=>{};
els.ocrText={value:''};
const box={x:.2,y:.3,width:.6,height:.08};
state.ocrResults.set(1,{text:'༄ old',source:'bdrc',lines:[{text:'༄ old',bbox:box}],compare:{
 bdrc:{text:'༄ old',lines:[{text:'༄ old',bbox:box}]},
 llm:{text:'Gemini saved',lines:[{text:'Gemini saved',bbox:box}]},
 qwenReviews:[{index:0,text:'Qwen edited',bbox:box,errorRanges:[{start:0,end:2}],manuallyEdited:true}],
 openaiReviews:[{index:0,text:'OpenAI saved',bbox:box}]}});
saveOcrResultFromParsed({text:'BDRC new',lines:[{text:'BDRC new',bbox:box}],raw:{}},'bdrc','done');
saveCachedResults();state.ocrResults.clear();restoreCachedResults();
`,ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0]?.text',ctx),'Qwen edited');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0]?.text',ctx),'Gemini saved');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.openaiReviews[0]?.text',ctx),'OpenAI saved');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0]?.errorRanges[0].end',ctx),2);
// New leading row changes indices; retained candidates follow their source region.
vm.runInContext(`saveOcrResultFromParsed({text:'new row\\nGemini new',lines:[{text:'new row',bbox:{x:.2,y:.1,width:.6,height:.05}},{text:'Gemini new',bbox:box}],raw:{}},'ai-vision','done');saveCachedResults();restoreCachedResults()`,ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].index',ctx),1);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.bdrc.lines[1].text',ctx),'BDRC new');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[1].text',ctx),'Gemini new');
// A failed new response must not destroy the previous successful transcription.
vm.runInContext(`saveOcrResultFromParsed({text:'failure',lines:[{text:'failure',bbox:box,error:true,missing:true}],raw:{}},'ai-vision','failed');saveCachedResults();restoreCachedResults()`,ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].text',ctx),'Gemini new');
console.log('Independent model results, edits, alignment and failure retention survive reload');
vm.runInContext(`saveProofreadBlockChoice(0,'qwen',null); saveCachedResults();restoreCachedResults()`,ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].text',ctx),'Gemini new','Adopting Qwen must not overwrite Gemini');
assert.equal(vm.runInContext('state.ocrResults.get(1).lines[0].text',ctx),'Qwen edited');
assert.equal(vm.runInContext('getProofreadDefaultChoice(state.ocrResults.get(1).lines[0],null,null)',ctx),'qwen');
