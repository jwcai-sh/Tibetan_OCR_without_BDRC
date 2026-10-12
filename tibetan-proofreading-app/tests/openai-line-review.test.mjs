import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const storage=new Map(); const elements=[];
const ctx=vm.createContext({console,FormData,Blob,window:{addEventListener(){},localStorage:{
  getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}},document:{querySelector:()=>null,
  createTextNode:text=>({textContent:text}),createElement(){const node={children:[],isConnected:true,handlers:{},append(...v){this.children.push(...v)},setAttribute(){},addEventListener(k,v){this.handlers[k]=v}};elements.push(node);return node;}}});
vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),ctx);
vm.runInContext(`
state.pageNum=1;state.pageCount=2;state.cacheKey='openai-center';state.sourceName='sample.png';
state.ocrResults.set(1,{text:'original',source:'bdrc',lines:[{text:'original',bbox:{x:.2,y:.2,width:.6,height:.1},regionId:'center'}],
 compare:{bdrc:{text:'BDRC',lines:[{text:'BDRC',bbox:{x:.2,y:.2,width:.6,height:.1},regionId:'center'}]},
 llm:{text:'Gemini',lines:[{text:'Gemini'}]},qwenReviews:[{index:0,text:'Qwen'}],
 openaiReviews:[{index:2,text:'older saved'}]}});
getAiVisionLineReviewEndpoint=()=> 'http://localhost/line-review';
getCurrentPageImageBlob=async()=>new Blob(['original-page']);
getCachedLineCrop=saveModelInputCrop=()=>{throw Error('preview must not feed OpenAI')};
fetch=async(endpoint,request)=>{
 if(endpoint!=='http://localhost/openai-page-review') throw Error('wrong route');
 if(await request.body.get('file').text()!=='original-page') throw Error('source image changed');
 const rows=JSON.parse(request.body.get('rows'));
 if(rows.length!==1||rows[0].index!==0||request.body.has('review_image')) throw Error('wrong rows');
 return {ok:true,json:async()=>({recognition_scope:'whole-page',model:'test-openai',lines:[{index:0,text:'བོད་'}]})};
};
renderHomeDashboard=scheduleRemoteStateSave=updateOcrPanelForPage=()=>{};
updateSummary=updateTranslationSummary=setStatus=()=>{};
renderOpenAiLineReview(0,{bbox:{x:.2,y:.2,width:.6,height:.1}},null,null);
`,ctx);
await elements.find(node=>node.textContent==='OpenAI整页复核').handlers.click({stopPropagation(){}});
const saved=JSON.parse(storage.get('openai-center')).ocrResults['1'];
assert.equal(saved.text,'original');
assert.equal(saved.compare.bdrc.text,'BDRC');
assert.equal(saved.compare.llm.text,'Gemini');
assert.equal(saved.compare.qwenReviews[0].text,'Qwen');
assert.equal(saved.compare.openaiReviews.find(x=>x.index===0).text,'བོད་');
assert.equal(saved.compare.openaiReviews.find(x=>x.index===2).text,'older saved');
vm.runInContext('state.ocrResults.clear();restoreCachedResults()',ctx);
assert.equal(vm.runInContext('state.ocrResults.get(1).compare.openaiReviews.find(x=>x.index===0).text',ctx),'བོད་');
console.log('OpenAI whole-page review keeps other model results and persists its candidate');
