const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { diffSegments, parsePageTextFile } = require('../whole-page-proofread.js');

test('Gemini panel offers model selection and current-page recognition', () => {
  const html = readFileSync(join(__dirname, '../whole-page-proofread.html'), 'utf8');
  const script = readFileSync(join(__dirname, '../whole-page-proofread.js'), 'utf8');
  assert.match(html, /id="geminiRecognitionModel"/);
  assert.match(html, /id="recognizeGemini"[^>]*>识别/);
  assert.match(script, /gemini-recognition-jobs/);
  assert.match(script, /model-results\/gemini4\/pages\/\$\{page\}/);
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
