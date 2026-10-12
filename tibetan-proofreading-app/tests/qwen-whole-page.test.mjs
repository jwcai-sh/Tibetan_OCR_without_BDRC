import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({console,window:{addEventListener(){}},document:{querySelector:()=>null}});
vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),ctx);
vm.runInContext(`
const rows=[{index:0,bbox:{x:.1,y:.1,width:.8,height:.1}},{index:2,bbox:{x:.1,y:.3,width:.8,height:.1}}];
const previous=[{index:0,text:'old',errorRanges:[{start:0,end:1}]},{index:1,text:'keep'}];
const response={recognition_scope:'whole-page',model:'qwen3.8-max',lines:[{index:2,text:'བོད་'},{index:0,text:'༄༅། ཀ་'}]};
`,ctx);
const merged=vm.runInContext('mergeQwenPageReviews(previous,response,rows)',ctx);
assert.equal(merged.find(x=>x.index===0).text,'༄༅། ཀ་');
assert.equal(merged.find(x=>x.index===1).text,'keep');
assert.equal(merged.find(x=>x.index===2).recognitionScope,'whole-page');
assert.equal(merged.find(x=>x.index===0).errorRanges,undefined);
assert.throws(()=>vm.runInContext('mergeQwenPageReviews(previous,{...response,lines:[response.lines[0]]},rows)',ctx));
assert.throws(()=>vm.runInContext('mergeQwenPageReviews(previous,{...response,lines:[response.lines[0],response.lines[0]]},rows)',ctx));
assert.equal(vm.runInContext('previous[0].text',ctx),'old');
console.log('Whole-page Qwen validates row identities before replacing only its own results');
