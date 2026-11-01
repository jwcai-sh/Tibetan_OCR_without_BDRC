const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../tb-translation-core.js');

test('TB parser preserves numbered paragraphs and rejects ambiguous lines', () => {
  const rows = core.parseTbDocument('\ufeff[TB-0001] ཀ།\r\n[TB-0002] ཁ།\n');
  assert.deepEqual(rows, [
    { id: 'TB-0001', text: 'ཀ།' },
    { id: 'TB-0002', text: 'ཁ།' },
  ]);
  assert.throws(() => core.parseTbDocument('[TB-0001] ཀ།\nstray text'), /第 2 行/);
  assert.throws(() => core.parseTbDocument('[TB-0001] ཀ།\n[TB-0001] ཁ།'), /重复/);
});

test('virtual pages never change TB identity', () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ id: `TB-${String(i + 1).padStart(4, '0')}`, text: 'ཀ།' }));
  assert.deepEqual(core.getVirtualPage(rows, 2, 15).map((row) => row.id), ['TB-0016', 'TB-0017']);
  assert.deepEqual(core.getVirtualPage(rows, 2, 10).map((row) => row.id).slice(0, 1), ['TB-0011']);
});

test('translation request uses only selected paragraph as source and keeps neighbor context separate', () => {
  const request = core.buildTranslationRequest(
    { id: 'TB-0002', text: 'ཁ།' },
    { previous: { id: 'TB-0001', text: 'ཀ།' }, next: { id: 'TB-0003', text: 'ག།' } },
    { model: 'gemini:test', sourceName: 'book.txt', page: 1 },
  );
  assert.equal(request.text, 'ཁ།');
  assert.equal(request.model, 'gemini:test');
  assert.match(request.user_prompt_template, /TB-0001.*ཀ།/s);
  assert.match(request.user_prompt_template, /TB-0003.*ག།/s);
  assert.match(request.user_prompt_template, /只翻译.*TB-0002/);
});

test('translation response and export preserve each model and human final', () => {
  assert.equal(core.extractTranslation({ translated_text: '甲' }), '甲');
  assert.throws(() => core.extractTranslation({ text: '' }), /空译文/);
  const markdown = core.exportTranslationMarkdown(
    [{ id: 'TB-0001', text: 'ཀ།' }],
    { 'TB-0001': { models: { 'model:a': { text: '甲' }, 'model:b': { text: '乙' } }, final: '定稿' } },
    ['model:a', 'model:b'],
  );
  assert.match(markdown, /TB-0001[\s\S]*ཀ།[\s\S]*model:a[\s\S]*甲[\s\S]*model:b[\s\S]*乙[\s\S]*定稿/);
});

test('aggregator request carries selected model and only current paragraph as translation target', () => {
  const row = { id: 'TB-0002', text: 'ཁ།' };
  const base = core.buildTranslationRequest(row, { previous: { id: 'TB-0001', text: 'ཀ།' } },
    { model: 'gemini:test', sourceName: 'book.txt', page: 1 });
  const request = core.buildAggregatorRequest(base);
  assert.equal(request.model, 'gemini:test');
  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.messages[1].role, 'user');
  assert.match(request.messages[1].content, /当前段：[\s\S]*ཁ།/);
  assert.doesNotMatch(request.messages[1].content, /\{source_text\}/);
  assert.equal(core.extractTranslation({ answer: '中文' }), '中文');
  assert.equal(core.extractTranslation({ choices: [{ message: { content: '备选' } }] }), '备选');
});

test('provider-prefixed request and bare response name identify the same model', () => {
  assert.equal(core.modelsMatch('gemini:gemini-3.8-flash', 'gemini-3.8-flash'), true);
  assert.equal(core.modelsMatch('gemini:gemini-3.8-flash', 'gemini-3.5-flash-lite'), false);
  assert.equal(core.modelsMatch('local:qwen3.6-27b:latest', 'qwen3.6-27b:latest'), true);
});

test('batch skips saved model results and persists each success before later failure', async () => {
  const rows = [{ id: 'TB-0001', text: 'ཀ།' }, { id: 'TB-0002', text: 'ཁ།' }];
  const existing = { 'TB-0001': { models: { a: { text: '已保存' } } } };
  const calls = [];
  const saved = [];
  await assert.rejects(core.runTranslationBatch(rows, ['a', 'b'], existing,
    async (row, model) => {
      calls.push(`${row.id}:${model}`);
      if (row.id === 'TB-0002') throw new Error('timeout');
      return '译文';
    },
    async (row, model, text) => saved.push(`${row.id}:${model}:${text}`),
  ), /TB-0002.*a.*timeout/);
  assert.deepEqual(calls, ['TB-0001:b', 'TB-0002:a']);
  assert.deepEqual(saved, ['TB-0001:b:译文']);
});
