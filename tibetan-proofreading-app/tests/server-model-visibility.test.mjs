import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function context() {
  const document = {
    querySelector: () => ({classList: {contains: name => name === 'ai-only-mode'}}),
    createElement: () => ({children: [], append(...items) {this.children.push(...items);}, appendChild(item) {this.children.push(item);}, setAttribute() {}}),
  };
  const ctx = vm.createContext({window: {addEventListener() {}}, document, console});
  vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('server display hides BDRC and old Gemini without changing saved candidates', () => {
  const ctx = context();
  const result = vm.runInContext(`(() => {
    const compare = {
      bdrc: {text:'old BDRC',lines:[{text:'old BDRC'}]},
      llm: {text:'old Gemini',model:'gemini:gemini-3.1-flash-lite',lines:[{text:'old Gemini'}]},
      qwenReviews:[{index:0,text:'saved Qwen'}],
    };
    const oldView = getVisibleServerCompare(compare);
    const oldChoice = renderProofreadChoiceSelect(0,'qwen','Gemini Vision',compare,false);
    compare.llm = {text:'new Gemini',model:'gemini:gemini-3.8-flash',lines:[{text:'new Gemini'}]};
    const newView = getVisibleServerCompare(compare);
    const newChoice = renderProofreadChoiceSelect(0,'qwen','Gemini Vision',compare,true);
    return {
      hiddenBdrc:oldView.bdrc.text,
      hiddenGemini:oldView.llm.text,
      savedBdrc:compare.bdrc.text,
      savedQwen:compare.qwenReviews[0].text,
      oldOptions:oldChoice.children[1].children.map(option => option.value),
      newGemini:newView.llm.text,
      newOptions:newChoice.children[1].children.map(option => option.value),
    };
  })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    hiddenBdrc:'', hiddenGemini:'', savedBdrc:'old BDRC', savedQwen:'saved Qwen',
    oldOptions:['qwen'], newGemini:'new Gemini', newOptions:['llm','qwen'],
  });
});

test('Gemini visibility uses provider metadata when a saved page omits the model name', () => {
  const ctx = context();
  const result = vm.runInContext(`(() => {
    const sideProvider = getVisibleServerCompare({
      bdrc:{text:'',lines:[]},
      llm:{text:'Gemini result',provider:'gemini',lines:[{text:'Gemini result'}]},
    });
    const lineProvider = getVisibleServerCompare({
      bdrc:{text:'',lines:[]},
      llm:{text:'Gemini line result',lines:[{text:'Gemini line result',provider:'gemini'}]},
    });
    return {sideProvider:sideProvider.llm.text,lineProvider:lineProvider.llm.text};
  })()`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    sideProvider:'Gemini result',
    lineProvider:'Gemini line result',
  });
});

test('restoring cached comparisons drops only the automatically seeded OpenAI sample', () => {
  const ctx = context();
  const reviews = vm.runInContext(`normalizeOcrCompare({
    bdrc:{text:'',lines:[]}, llm:{text:'',lines:[]},
    qwenReviews:[{index:0,text:'saved Qwen'}],
    openaiReviews:[
      {index:2,text:'old sample',model:'ChatGPT 对话复核'},
      {index:1,text:'real review',model:'gpt-5'},
    ],
  }).openaiReviews.map(({index,model})=>({index,model}))`, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(reviews)), [{index:1,model:'gpt-5'}]);
});
