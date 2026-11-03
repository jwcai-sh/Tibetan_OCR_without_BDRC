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

test('missing TB source attaches the already selected numbered TXT once', async () => {
  const original = { name: 'book.txt', text: '[TB-0001] ཀ།\n' };
  const calls = [];
  const attached = await core.ensureBookTbSource({
    readAttached: async () => { calls.push('read TB'); throw Object.assign(new Error('missing'), { status: 404 }); },
    readOriginal: async () => { calls.push('read original'); return original; },
    attach: async (source) => { calls.push('attach'); assert.deepEqual(source, original); return { ...source, source_hash: 'hash' }; },
  });
  assert.equal(attached.source_hash, 'hash');
  assert.deepEqual(calls, ['read TB', 'read original', 'attach']);
});

test('existing TB source is reused without reading or replacing the original', async () => {
  const saved = { name: 'saved.txt', text: '[TB-0001] ཀ།\n' };
  const attached = await core.ensureBookTbSource({
    readAttached: async () => saved,
    readOriginal: async () => { throw new Error('unexpected original read'); },
    attach: async () => { throw new Error('unexpected write'); },
  });
  assert.equal(attached, saved);
});

test('unnumbered original is rejected before any TB source write', async () => {
  let writes = 0;
  await assert.rejects(core.ensureBookTbSource({
    readAttached: async () => { throw Object.assign(new Error('missing'), { status: 404 }); },
    readOriginal: async () => ({ name: 'book.txt', text: 'not numbered' }),
    attach: async () => { writes += 1; },
  }), /不是有效的 TB 编号原文/);
  assert.equal(writes, 0);
});

test('concurrent attachment reuses matching text but rejects another source', async () => {
  const original = { name: 'book.txt', text: '\ufeff[TB-0001] ཀ།\r\n' };
  const conflict = Object.assign(new Error('conflict'), { status: 409 });
  let reads = 0;
  const readAttached = async () => {
    if (reads++ === 0) throw Object.assign(new Error('missing'), { status: 404 });
    return { text: '[TB-0001] ཀ།\n' };
  };
  const attached = await core.ensureBookTbSource({ readAttached, readOriginal: async () => original, attach: async () => { throw conflict; } });
  assert.equal(attached.text, '[TB-0001] ཀ།\n');
  await assert.rejects(core.ensureBookTbSource({
    readAttached: async () => { if (reads++ === 2) throw Object.assign(new Error('missing'), { status: 404 }); return { text: '[TB-0001] ཁ།\n' }; },
    readOriginal: async () => original,
    attach: async () => { throw conflict; },
  }), /conflict/);
});

test('virtual pages never change TB identity', () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ id: `TB-${String(i + 1).padStart(4, '0')}`, text: 'ཀ།' }));
  assert.deepEqual(core.getVirtualPage(rows, 2, 15).map((row) => row.id), ['TB-0016', 'TB-0017']);
  assert.deepEqual(core.getVirtualPage(rows, 2, 10).map((row) => row.id).slice(0, 1), ['TB-0011']);
});

test('model progress counts completed pages and partial final page independently', () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ id: `TB-${String(i + 1).padStart(4, '0')}` }));
  const completed = new Set(rows.slice(0, 15).map((row) => row.id).concat('TB-0017', 'TB-9999'));
  const progress = core.calculateModelProgress(rows, completed, 15);
  assert.equal(progress.completedSegments, 16);
  assert.equal(progress.completedPages, 1);
  assert.deepEqual(progress.pages, [
    { page: 1, completed: 15, total: 15 },
    { page: 2, completed: 1, total: 2 },
  ]);
});

test('page progress navigation targets the first untranslated paragraph on that page', () => {
  const rows = Array.from({ length: 32 }, (_, i) => ({ id: `TB-${String(i + 1).padStart(4, '0')}` }));
  const completed = new Set(rows.slice(15, 20).map((row) => row.id));
  assert.equal(core.getPageNavigationIndex(rows, completed, 2, 15), 20);
  assert.equal(core.getPageNavigationIndex(rows, new Set(rows.map((row) => row.id)), 2, 15), 15);
  assert.equal(core.getPageNavigationIndex(rows, completed, 4, 15), -1);
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

test('Gemini all and remaining batches use different ranges for the selected model', async () => {
  const rows = [{ id: 'TB-0001', text: 'ཀ།' }, { id: 'TB-0002', text: 'ཁ།' }];
  const records = { 'TB-0001': { models: { 'gemini:gemini-4-argon': { text: '旧译' } } } };
  const model = 'gemini:gemini-4-argon';
  assert.deepEqual(core.selectModelBatchRows(rows, records, model, 'all'), rows);
  assert.deepEqual(core.selectModelBatchRows(rows, records, model, 'remaining'), [rows[1]]);
  assert.deepEqual(core.selectModelBatchRows(rows, records, 'gemini:gemini-3.8-flash', 'remaining'), rows);
  const saved = [];
  const completed = await core.runTranslationBatch(rows, [model], records,
    async (row) => `${row.id} 新译`,
    async (row, selectedModel, text) => saved.push([row.id, selectedModel, text]),
    undefined, { skipExisting: false });
  assert.equal(completed, 2);
  assert.deepEqual(saved.map(([id]) => id), ['TB-0001', 'TB-0002']);
  assert.equal(records['TB-0001'].models[model].text, '旧译');
});

test('stopping a batch keeps earlier saved paragraphs', async () => {
  const rows = [{ id: 'TB-0001', text: 'ཀ།' }, { id: 'TB-0002', text: 'ཁ།' }];
  const controller = new AbortController();
  const saved = [];
  await assert.rejects(core.runTranslationBatch(rows, ['gemini:gemini-4-argon'], {},
    async (row) => row.text,
    async (row) => { saved.push(row.id); controller.abort(); },
    controller.signal), /已停止翻译/);
  assert.deepEqual(saved, ['TB-0001']);
});

test('all-paragraph batch continues past a failed segment and reports it', async () => {
  const rows = [1, 2, 3].map((number) => ({ id: `TB-000${number}`, text: `row ${number}` }));
  const saved = [];
  const failed = [];
  const completed = await core.runTranslationBatch(rows, ['gemini:gemini-4-argon'], {},
    async (row) => {
      if (row.id === 'TB-0002') throw new Error('503');
      return '译文';
    },
    async (row) => saved.push(row.id),
    undefined, { continueOnError: true, onError: (row) => failed.push(row.id) });
  assert.equal(completed, 2);
  assert.deepEqual(saved, ['TB-0001', 'TB-0003']);
  assert.deepEqual(failed, ['TB-0002']);
});

test('numbered reference text maps to TB ids and keeps continuation lines', () => {
  const rows = core.parseTbDocument('[TB-0001] ཀ།\n[TB-0002] ཁ།');
  assert.deepEqual(core.parseReferenceDocument('[TB-0001] 第一段\n续句\n[TB-0002] 第二段', rows), {
    'TB-0001': '第一段\n续句', 'TB-0002': '第二段',
  });
  assert.throws(() => core.parseReferenceDocument('[TB-0003] 错段', rows), /TB-0003/);
  const exported = core.exportTranslationMarkdown(rows, {}, [], { teacher: { 'TB-0001': '教师文字' } });
  assert.match(exported, /教师校正稿[\s\S]*教师文字/);
});

test('translator style, glossary and examples are included while saved variants remain separate', () => {
  const [academic, classical, modern] = core.STYLE_PROFILES;
  const model = 'gemini:test';
  assert.equal(core.resultKey(model, academic), model);
  const classicalKey = core.resultKey(model, classical, 'ཀ = 甲', '原文：ཀ།\n译文：甲。');
  assert.notEqual(classicalKey, model);
  assert.notEqual(classicalKey, core.resultKey(model, modern, 'ཀ = 甲', '原文：ཀ།\n译文：甲。'));
  assert.notEqual(classicalKey, core.resultKey(model, classical, 'ཀ = 乙', '原文：ཀ།\n译文：甲。'));
  assert.equal(classicalKey, core.resultKey(model, classical, 'ཀ = 甲', '原文：ཀ།\n译文：甲。'));
  const request = core.buildTranslationRequest({ id: 'TB-0001', text: 'ཀ།' }, {},
    { model, sourceName: 'book.txt', page: 1, profile: classical,
      glossary: 'ཀ = 甲', examples: '原文：ཀ།\n译文：甲。' });
  assert.equal(request.role_id, classical.id);
  assert.match(request.system_prompt, /凝练/);
  assert.match(request.user_prompt_template, /ཀ = 甲/);
  assert.match(request.user_prompt_template, /译文：甲/);
  assert.equal(core.buildAggregatorRequest(request).model, model);
});
