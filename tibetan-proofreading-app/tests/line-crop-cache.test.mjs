import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('const lineCropRequests ='),app.indexOf('function createModelInputPreview('));
const storage=new Map();let calls=0;
const meta={crop_version:24,source_size:{width:100,height:20},source_bbox:{x:0,y:0,width:1,height:1},crop_pixels:{x:0,y:0,width:100,height:20},review_size:{width:500,height:100},tile_ranges:[[0,500]]};
const context={cacheKey:'doc-a',pageNum:1,dpi:260,profile:'traditional',endpoint:'local/line-review'};
const line={bbox:{x:0,y:0,width:1,height:1}};
function boot(){
 const ctx=vm.createContext({Blob,FormData,Date,Error,console,state:{cacheKey:'doc-a',pageNum:1},
 normalizeBbox:b=>b,getCurrentPageImageBlob:async()=>new Blob(['page']),makePageImageName:()=> 'page.png',
 getAiVisionLineReviewEndpoint:()=> 'local/line-review',
 fetch:async()=>{calls++;return{ok:true,json:async()=>({images:['data:image/png;base64,test'],review_image:meta})};}});
 vm.runInContext(source,ctx);
 ctx.accessLineCropCache=async(key,value)=>{if(value)storage.set(key,structuredClone(value));return structuredClone(storage.get(key)||null);};
 return ctx;
}
let ctx=boot();
const first=await ctx.getCachedLineCrop(line,0,null,context);
assert.equal(calls,1);assert.equal(first.modelInput,undefined);
assert.match(ctx.makeLineCropCacheKey(line,0,context),/row-crop-v24/);
ctx=boot(); // A new browser lifetime, same persistent storage.
await ctx.getCachedLineCrop(line,0,null,context);assert.equal(calls,1);
await ctx.saveModelInputCrop(line,0,meta,context,'gemini','test',new Blob(['page']));
const used=await ctx.getCachedLineCrop(line,0,meta,context);
assert.equal(used.modelInput.provider,'gemini');assert.deepEqual(used.modelInput.images,used.payload.images);
await Promise.all([ctx.saveModelInputCrop(line,0,meta,context,'qwen','test-qwen',new Blob(['page']),{local_bbox:{x:1,y:2,width:3,height:4}}), ctx.saveModelInputCrop(line,0,meta,context,'openai','test-openai',new Blob(['page']))]);
const retained=await ctx.getCachedLineCrop(line,0,meta,context);
assert.equal(retained.modelInputs.gemini.model,'test');
assert.equal(retained.modelInputs.qwen.model,'test-qwen');
assert.equal(retained.modelInputs.qwen.reviewContext.local_bbox.y,2);
assert.equal(retained.modelInputs.openai.model,'test-openai');
ctx.state.pageNum=2;await ctx.getCachedLineCrop(line,0,null,{...context,pageNum:2});assert.equal(calls,2);
ctx.state.cacheKey='doc-b';await ctx.getCachedLineCrop(line,0,null,{...context,cacheKey:'doc-b',pageNum:2});assert.equal(calls,3);
await ctx.getCachedLineCrop({...line,bbox:{...line.bbox,x:.01}},0,null,{...context,cacheKey:'doc-b',pageNum:2});assert.equal(calls,4);
console.log('Crop previews survive reload; document/page/coordinate boundaries are isolated; successful model inputs retain matching image snapshots.');
