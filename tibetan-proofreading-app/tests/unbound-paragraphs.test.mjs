import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function getUnboundSavedParagraphs('),source.indexOf('function renderProofreadMergedView(')),context);
const get=r=>Array.from(context.getUnboundSavedParagraphs(r));
const original={text:'edited first\nsecond\nthird\nfourth',lines:[{text:'edited first',manuallyEdited:true,manualEditRanges:[{start:0,end:2}]}]};
const snapshot=JSON.stringify(original);
assert.deepEqual(get(original),['second','third','fourth']);
assert.equal(JSON.stringify(original),snapshot);
assert.deepEqual(get({text:'a\nb',lines:[{text:'different'}]}),[]);
assert.deepEqual(get({text:'a\nb',lines:[{text:'a',deleted:true}]}),[]);
assert.deepEqual(get({text:'a\nb',lines:[{text:'a'},{text:'b'}]}),[]);
console.log('Unbound saved paragraphs: passed (read-only, exact prefix, no deleted-row resurrection)');

const dedup=source.slice(source.indexOf('function mergeDuplicateSourcePreviews('),source.indexOf('function createSourceBlockPreviewCanvas('));
vm.runInContext(dedup,context);
const cards=[];
const previews=[0,1,2,3].map(index=>{
 const card={hidden:false,classList:{remove(name){if(name==='is-duplicate-source')card.hidden=false;},toggle(){card.hidden=true;}}}; cards.push(card);
 const note={}; const strip={style:{}};
 return {dataset:{physicalRowKey:'same-position',blockIndex:String(index),previewHeight:'100px'},style:{},querySelector(selector){return selector==='[data-crop-strip]'?strip:note;},closest(){return card;}};
});
context.mergeDuplicateSourcePreviews({querySelectorAll:()=>previews});
assert.ok(cards.every(card=>!card.hidden),'Overlapping crop positions must not hide any OCR editor');
console.log('Duplicate source positions preserve all proofreading cards');
