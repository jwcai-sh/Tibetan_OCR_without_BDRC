const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { diffSegments, parsePageTextFile, pagesForRecognition, recognizeWithRetries, normalizeRotation, defaultPreviewRotation, effectivePreviewRotation } = require('../whole-page-proofread.js');

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

test('GPT candidate uses its own cloud jobs and remains separate from the Gemini baseline', () => {
  const html = readFileSync(join(__dirname, '../whole-page-proofread.html'), 'utf8');
  const script = readFileSync(join(__dirname, '../whole-page-proofread.js'), 'utf8');
  assert.match(html, /id="openaiPanel"/);
  assert.match(html, /id="recognizeOpenAIAllPages"/);
  assert.match(html, /id="recognizeOpenAIRemainingPages"/);
  assert.match(script, /openai-recognition-jobs/);
  assert.match(script, /model-results\/openai\/pages\/\$\{page\}/);
  assert.match(script, /diffSegments\(state\.pages\.gemini4/);
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

test('rejects missing page headings and keeps a deliberately empty page', () => {
  const parsed = parsePageTextFile('第 1 页\nཀ་\n\n第 2 页\n', 2);
  assert.deepEqual(parsed, { '1': 'ཀ་', '2': '' });
  assert.throws(() => parsePageTextFile('第 1 页\nཀ་', 2), /2 页/);
});
