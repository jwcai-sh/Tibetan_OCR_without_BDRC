import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const handlers={};const elements={};
for(const name of ['ocrFirstPageButton','ocrPrevPageButton','ocrNextPageButton','ocrLastPageButton','ocrPageInput','viewerPageInput','pageInput','ocrPageTotal','renderMeta','pageTotal']){
 elements[name]={value:'',addEventListener:(event,fn)=>{handlers[name+':'+event]=fn;}};
}
const calls=[];
const state={pageNum:2,pageCount:24,batchOcr:{running:false}};
const ctx=vm.createContext({els:elements,state,goToPage:p=>calls.push(p)});
vm.runInContext(app.slice(app.indexOf('  els.ocrFirstPageButton.addEventListener'),app.indexOf('  els.viewerZoomOutButton.addEventListener')),ctx);
vm.runInContext(app.slice(app.indexOf('function syncPageControls('),app.indexOf('function setBusy(')),ctx);
ctx.syncPageControls();
assert.equal(elements.ocrPageInput.value,'2');assert.equal(elements.viewerPageInput.value,'2');assert.equal(elements.ocrPageTotal.textContent,'/ 24');
handlers['ocrNextPageButton:click']();handlers['ocrLastPageButton:click']();
elements.ocrPageInput.value='7';handlers['ocrPageInput:keydown']({key:'Enter'});
assert.deepEqual(calls,[3,24,7]);
state.batchOcr.running=true;ctx.syncPageControls();assert.equal(elements.ocrPageInput.disabled,true);
console.log('Right-pane navigation uses the existing page scheduler and remains synchronized while source pane is hidden.');
