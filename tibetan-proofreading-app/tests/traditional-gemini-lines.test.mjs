import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const ctx=vm.createContext({console,window:{addEventListener(){}},document:{querySelector:()=>null}});
vm.runInContext(source,ctx);
vm.runInContext(`
state.pageNum=1; state.cacheKey='gemini-center';
const box=(y)=>({x:.2,y,width:.6,height:.1});
state.ocrResults.set(1,{source:'bdrc',text:'original',lines:[
  {text:'old1',bbox:box(.2),regionId:'center'},
  {text:'old2',bbox:box(.4),regionId:'center'}],
  compare:{bdrc:{text:'original',lines:[
    {text:'old1',bbox:box(.2),regionId:'center'},
    {text:'old2',bbox:box(.4),regionId:'center'}]},
    llm:{text:'old gemini',lines:[{text:'previous',bbox:box(.2)}]},
    qwenReviews:[{index:0,text:'saved qwen'}]}});
getOcrSourceCompare=result=>result?.compare;
getEffectiveOcrSideLines=side=>side?.lines||[];
requestWholePageReview=async(endpoint,blob,rows,model)=>{
  if(endpoint!=='http://localhost/gemini-page-review'||rows.length!==2||model!=='gemini-2.5-flash') throw Error('wrong page route');
  if(blob!=='original-page') throw Error('source image changed');
  return {recognition_scope:'whole-page',model:'gemini:gemini-2.5-flash',lines:[
    {index:1,text:'གཉིས་'},{index:0,text:'༄༅། གཅིག་'}]};
};
saveCachedResults=async()=>{}; updateOcrPanelForPage=updateSummary=setStatus=()=>{};
`,ctx);
await vm.runInContext("runTraditionalGeminiLines('http://localhost/ocr','original-page','gemini-2.5-flash')",ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).text',ctx),'original');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.bdrc.lines[0].text',ctx),'old1');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.qwenReviews[0].text',ctx),'saved qwen');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].text',ctx),'༄༅། གཅིག་');
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[1].text',ctx),'གཉིས་');
console.log('Gemini whole-page result updates only its center rows and keeps BDRC/Qwen');

const oldText=vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].text',ctx);
vm.runInContext(`requestWholePageReview=async()=>({recognition_scope:'whole-page',model:'gemini:gemini-2.5-flash',lines:[{index:0,text:'ཀ་'}]});`,ctx);
await assert.rejects(vm.runInContext("runTraditionalGeminiLines('http://localhost/ocr','original-page','gemini-2.5-flash')",ctx));
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.llm.lines[0].text',ctx),oldText);
console.log('Incomplete Gemini page result does not overwrite previous output');
