import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("Markdown export includes every page, each saved model candidate, empty results and matching error statistics", async () => {
  const window = { addEventListener() {} };
  const context = vm.createContext({
    Blob,
    console,
    document: { querySelector: () => null },
    window,
  });
  vm.runInContext(readFileSync(new URL("../app.js", import.meta.url), "utf8"), context);
  vm.runInContext(`
    state.sourceName = '三页经书.pdf';
    state.pageCount = 3;
    state.ocrResults.set(1, {
      source: 'proofread', text: 'ཀ་བ་', lines: [{ text: 'ཀ་བ་' }],
      compare: {
        bdrc: { text: 'ཀ་བ་', lines: [{ text: 'ཀ་བ་', manualErrorChars: 1 }] },
        llm: { text: 'ཀ་མ་', lines: [{ text: 'ཀ་མ་' }] },
        qwenReviews: [{ index: 0, text: 'ཀ་བ་', model: 'qwen-test', errorRanges: [{ start: 0, end: 1 }] }],
        openaiReviews: [{ index: 0, text: '', model: 'openai-test' }],
      },
    });
    state.ocrResults.set(2, {
      source: 'bdrc', text: 'ག་', lines: [{ text: 'ག་' }],
      compare: { bdrc: { text: 'ག་', lines: [{ text: 'ག་' }] }, llm: {
        text: '', lines: [{ text: 'Gemini Vision 未返回 block 01 的识别结果', diagnostic: true }],
      } },
    });
    downloadBlob = (blob, name) => { window.exported = { blob, name }; };
    setStatus = (message) => { window.status = message; };
    downloadAllOcrText();
  `, context);

  const markdown = await window.exported.blob.text();
  assert.equal(window.exported.name, "三页经书_藏文OCR校对结果.md");
  assert.match(window.status, /共 3 页/);
  for (const page of [1, 2, 3]) {
    const section = markdown.split(`## 第 ${page} 页`)[1]?.split(`## 第 ${page + 1} 页`)[0]
      || markdown.split(`## 第 ${page} 页`)[1];
    assert.ok(section, `page ${page} exists`);
    for (const model of ["BDRC", "Gemini Vision", "千问", "OpenAI"]) {
      assert.match(section, new RegExp(`### ${model}\\n`), `page ${page} contains ${model}`);
    }
  }
  assert.match(markdown, /识别模型：qwen-test/);
  assert.match(markdown, /ཀ་མ་/);
  assert.match(markdown, /\| BDRC \| 4 \| 1 \| 25\.0% \|/);
  assert.match(markdown, /\| 千问 \| 4 \| 1 \| 25\.0% \|/);
  assert.match(markdown, /\| OpenAI \| 0 \| 0 \| — \|/);
  assert.doesNotMatch(markdown, /Gemini Vision 未返回 block 01 的识别结果/);
  assert.match(markdown, /#### block 01\n\n识别模型：openai-test\n\n共 0 字 · 错误 0 字 · 错误率 —\n\n（空）/);
  assert.match(markdown, /## 第 3 页[\s\S]*?### 当前采用的校对文本\n\n（空）/);
});
