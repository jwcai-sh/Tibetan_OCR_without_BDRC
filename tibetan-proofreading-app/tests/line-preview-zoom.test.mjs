import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('function createModelInputPreview(');
const end = app.indexOf('\nfunction mergeDuplicateSourcePreviews(', start);
const preview = app.slice(start, end);

test('single-image row previews expose a collapsible full-size image', () => {
  assert.notEqual(start, -1, 'the model input preview renderer must exist');
  assert.notEqual(end, -1, 'the model input preview renderer must end before preview merging');
  assert.match(preview,
    /if \(previewImages\.length === 1\) \{[\s\S]*?createElement\("details"\)[\s\S]*?summary\.textContent = "放大查看这一行"[\s\S]*?fullImage\.src = previewImages\[0\][\s\S]*?append\(summary, scroll\)/);
});
