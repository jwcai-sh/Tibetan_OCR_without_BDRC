import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const c=vm.createContext({console,window:{addEventListener(){}},document:{querySelector(){return null}}});
vm.runInContext(readFileSync(new URL('../app.js',import.meta.url),'utf8'),c);
function ranges(before,after){c.before=before;c.after=after;return JSON.parse(vm.runInContext('JSON.stringify(getChangedTextRanges(before,after))',c));}
test('separated edits do not highlight unchanged middle text',()=>{
 assert.deepEqual(ranges('abcdefghi','aXcdefgYi'),[{start:1,end:2},{start:7,end:8}]);
});
test('insertions and deletions preserve matching text',()=>{
 assert.deepEqual(ranges('abc def ghi','aXbc def gYi'),[{start:1,end:2},{start:10,end:11}]);
 assert.deepEqual(ranges('abc','ac'),[]);
 assert.deepEqual(ranges('abc','abc'),[]);
});
test('Tibetan changed clusters stay whole and unchanged syllables stay unmarked',()=>{
 const before='ཀི་མི་བོ་',after='ཀུ་མི་བུ་';
 const changed=ranges(before,after).map(r=>after.slice(r.start,r.end));
 assert.deepEqual(changed,['ཀུ','བུ']);
});
test('legacy broad ranges are recomputed from the retained baseline on rerender',()=>{
 const result=vm.runInContext(`JSON.stringify(getManualEditRanges({text:'aXcdefgYi',manualBaselineText:'abcdefghi',manuallyEdited:true,manualEditRanges:[{start:1,end:8}]}))`,c);
 assert.deepEqual(JSON.parse(result),[{start:1,end:2},{start:7,end:8}]);
});
