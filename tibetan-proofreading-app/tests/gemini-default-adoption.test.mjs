import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({console,window:{addEventListener(){},localStorage:{getItem(){return null},setItem(){}}},document:{querySelector(){return null}}});
vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),ctx);
vm.runInContext(`state.pageNum=1;state.pageCount=1;state.cacheKey='test'; updateThumbnailState=renderHomeDashboard=scheduleRemoteStateSave=updateOcrPanelForPage=updateSummary=setStatus=setOcrView=()=>{}; els.ocrText={value:''}; saveOcrResultFromParsed({text:'བོད',lines:[{text:'བོད'}],raw:{}},'ai-vision','ok');`,ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).lines[0].adoptedProvider',ctx),'llm');
assert.equal(vm.runInContext("getProofreadDefaultChoice({text:'old',adoptedProvider:'qwen'},null,{text:'new'})",ctx),'qwen');
console.log('Gemini default and saved choice verified');
