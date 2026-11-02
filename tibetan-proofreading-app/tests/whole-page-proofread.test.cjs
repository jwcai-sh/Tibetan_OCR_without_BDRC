const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { diffSegments, candidateSegments, hasAnyModelText, normalizeModelOrder, parsePageTextFile, buildCorrectedExport, pagesForRecognition, recognizeWithRetries, normalizeRotation, defaultPreviewRotation, effectivePreviewRotation } = require('../whole-page-proofread.js');

test('a whole-book baseline remains selectable when only another page has model text', () => {
  const pages = { teacher: { '1': '', '2': 'ཀ་ཁ' }, yigdzin1: { '1': '  ' } };
  assert.equal(hasAnyModelText(pages, 'teacher'), true);
  assert.equal(hasAnyModelText(pages, 'yigdzin1'), false);
});

test('selected model is the only unmarked baseline and missing baselines do not mark differences', () => {
  const pages = { gemini4: { '1': 'ཀ་ཁ' }, teacher: { '1': 'ཀ་ག་ཁ' }, yigdzin1: { '1': 'ཀ་ཁ' } };
  assert.deepEqual(candidateSegments(pages, 'teacher', 'teacher', 1), [{ type: 'plain', text: 'ཀ་ག་ཁ' }]);
  assert.equal(candidateSegments(pages, 'teacher', 'gemini4', 1).some(piece => piece.type !== 'plain'), true);
  assert.deepEqual(candidateSegments(pages, 'yigdzin1', 'teacher', 2), []);
  assert.deepEqual(candidateSegments(pages, 'openai', 'teacher', 1), [{ type: 'plain', text: 'ཀ་ག་ཁ' }]);
  assert.deepEqual(candidateSegments({ teacher: { '1': '  ' }, gemini4: { '1': 'ཀ་ཁ' } }, 'teacher', 'gemini4', 1), [{ type: 'plain', text: 'ཀ་ཁ' }]);
});

test('saved card order keeps each model once and restores omitted models', () => {
  assert.deepEqual(normalizeModelOrder(['yigdzin1', 'teacher', 'teacher', 'unknown']), ['yigdzin1', 'teacher', 'gemini4', 'openai']);
  assert.deepEqual(normalizeModelOrder(null), ['gemini4', 'teacher', 'yigdzin1', 'openai']);
});

test('batch retries only failed pages and leaves successful pages untouched', async () => {
  const attempts = [];
  const waits = [];
  const result = await recognizeWithRetries([1, 2, 3], async page => {
    attempts.push(page);
    if (page === 2 && attempts.filter(item => item === 2).length < 3) throw new Error('temporary');
    if (page === 3) throw new Error('persistent');
  }, { wait: async ms => { waits.push(ms); } });
  assert.deepEqual(attempts, [1, 2, 3, 2, 3, 2, 3]);
  assert.deepEqual(waits, [3000, 6000]);
  assert.equal(result.completed, 2);
  assert.deepEqual(result.failed, [3]);
  assert.match(result.errors.get(3).message, /persistent/);
});

test('the inverted first page defaults upright for the original and reopened 24-page book', () => {
  assert.equal(defaultPreviewRotation('a3a76874e921481e9d1bd53626f40e99', '1.pdf', 24, 1), 180);
  assert.equal(defaultPreviewRotation('new-project-id', '1.pdf', 24, 1), 180);
  assert.equal(defaultPreviewRotation('new-project-id', '藏文/1.pdf', 24, 1), 180);
  assert.equal(defaultPreviewRotation('new-project-id', '1.pdf', 24, 2), 0);
  assert.equal(defaultPreviewRotation('another-book', 'other.pdf', 24, 1), 0);
});

test('page and document turns accumulate and wrap at a full circle', () => {
  assert.equal(normalizeRotation(-90), 270);
  assert.deepEqual([1, 2, 3, 4].map(turns => normalizeRotation(turns * 90)), [90, 180, 270, 0]);
  assert.equal(effectivePreviewRotation('new-project-id', '1.pdf', 24, 1, 0, 0), 180);
  assert.equal(effectivePreviewRotation('new-project-id', '1.pdf', 24, 1, 90, 90), 0);
  assert.equal(effectivePreviewRotation('new-project-id', '1.pdf', 24, 2, 90, 0), 90);
});

test('page and document rotation use direct buttons without a choice menu', () => {
  const html = readFileSync(join(__dirname, '../whole-page-proofread.html'), 'utf8');
  assert.match(html, /<button id="rotatePage"[^>]*type="button"/);
  assert.match(html, /<button id="rotateDocument"[^>]*type="button"/);
  assert.doesNotMatch(html, /rotatePageMenu|rotateDocumentMenu|rotation-menu/);
});

test('whole-book export is in the global toolbar while page save stays in its card', () => {
  const html = readFileSync(join(__dirname, '../whole-page-proofread.html'), 'utf8');
  const exportAt = html.indexOf('id="exportCorrected"');
  assert.ok(exportAt > html.indexOf('<div class="toolbar">'));
  assert.ok(exportAt < html.indexOf('<nav id="pageIndex"'));
  assert.match(html.slice(exportAt, exportAt + 100), /导出整本正确版 TXT/);
  assert.match(html, /<h2>人工校对正确版<\/h2><button id="saveCorrected"[^>]*>保存本页正确版<\/button>/);
});

test('batch page selection includes every page or only pages without Gemini text', () => {
  const pages = { '1': 'ཀ་', '2': '  ', '4': 'ཁ་' };
  assert.deepEqual(pagesForRecognition(4, pages, 'all'), [1, 2, 3, 4]);
  assert.deepEqual(pagesForRecognition(4, pages, 'remaining'), [2, 3]);
});

test('Gemini panel offers model selection and current-page recognition', () => {
  const html = readFileSync(join(__dirname, '../whole-page-proofread.html'), 'utf8');
  const script = readFileSync(join(__dirname, '../whole-page-proofread.js'), 'utf8');
  assert.match(html, /id="geminiRecognitionModel"/);
  assert.match(html, /id="recognizeGemini"[^>]*>识别/);
  assert.match(script, /gemini-recognition-jobs/);
  assert.match(script, /model-results\/gemini4\/pages\/\$\{page\}/);
});

test('GPT candidate uses its own cloud jobs and follows the selected baseline', () => {
  const html = readFileSync(join(__dirname, '../whole-page-proofread.html'), 'utf8');
  const script = readFileSync(join(__dirname, '../whole-page-proofread.js'), 'utf8');
  assert.match(html, /id="openaiPanel"/);
  assert.match(html, /id="recognizeOpenAIAllPages"/);
  assert.match(html, /id="recognizeOpenAIRemainingPages"/);
  assert.match(script, /openai-recognition-jobs/);
  assert.match(script, /model-results\/openai\/pages\/\$\{page\}/);
  assert.match(script, /candidateSegments\(state\.pages, state\.baselineKey, key, state\.page\)/);
});

test('line breaks and spaces do not create Tibetan differences', () => {
  const pieces = diffSegments('ཀ་ ཁ་', 'ཀ་\nཁ་');
  assert.equal(pieces.map(piece => piece.text || '').join(''), 'ཀ་\nཁ་');
  assert.equal(pieces.filter(piece => piece.type !== 'plain').length, 0);
});

test('marks extra text and a missing baseline character', () => {
  const inserted = diffSegments('ཀ་ཁ', 'ཀ་ག་ཁ');
  assert.equal(inserted.filter(piece => piece.type === 'diff').map(piece => piece.text).join(''), 'ག་');
  const missing = diffSegments('ཀ་ཁ', 'ཀ་');
  assert.equal(missing.some(piece => piece.type === 'omission'), true);
});

test('accepts selected pages and keeps a deliberately empty page', () => {
  const parsed = parsePageTextFile('第 1 页\nཀ་\n\n第 2 页\n', 2);
  assert.deepEqual(parsed, { '1': 'ཀ་', '2': '' });
  assert.deepEqual(parsePageTextFile('### 第 2 页：教师稿\nཁ་', 3), { '2': 'ཁ་' });
  assert.throws(() => parsePageTextFile('没有页标', 2), /第…页/);
  assert.throws(() => parsePageTextFile('第 3 页\nཀ་', 2), /范围/);
  assert.throws(() => parsePageTextFile('第 1 页\nཀ་\n第 1 页\nཁ་', 2), /重复/);
});

test('imports pages separated by the Mingdeng OCR TXT headings', () => {
  const source = '===== 第 1 页 =====\r\nཀ་\r\n\r\n===== 第 2 页 =====\r\nཁ་\r\n';
  assert.deepEqual(parsePageTextFile(source, 2), { '1': 'ཀ་', '2': 'ཁ་' });
});

test('corrected export retains Tibetan line breaks and orders pages numerically', () => {
  const content = buildCorrectedExport([
    { page_num: 2, saved: true, text: 'ག་\r\nང་' },
    { page_num: 1, saved: true, text: 'ཀ་\nཁ་' },
  ], 2);
  assert.deepEqual(parsePageTextFile(content, 2), { '1': 'ཀ་\nཁ་', '2': 'ག་\nང་' });
  assert.match(content, /^第 1 页\nཀ་\nཁ་\n\n第 2 页\nག་\nང་\n$/);
});

test('corrected export refuses to silently omit an unsaved page', () => {
  assert.throws(() => buildCorrectedExport([
    { page_num: 1, saved: true, text: 'ཀ་' },
    { page_num: 2, saved: false, text: '' },
  ], 3), /第 2、3 页尚未保存/);
});
