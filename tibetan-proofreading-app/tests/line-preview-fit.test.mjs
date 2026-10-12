import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('function linePreviewDisplayHeight(');
const end = app.indexOf('\nfunction createModelInputPreview(', start);
assert.notEqual(start, -1, 'the preview sizing helper must exist');
assert.notEqual(end, -1, 'the preview sizing helper must end before model preview rendering');
const context = vm.createContext({});
vm.runInContext(app.slice(start, end), context);

assert.match(app, /const SOURCE_PREVIEW_SCALE_MIN = 1;/,
  'fit-to-width is the minimum preview scale so saved smaller values normalize to full width');
assert.match(app, /const strip = document\.createElement\("div"\);[\s\S]*?strip\.style\.width = "max-content";/,
  'the multi-tile model input strip should keep its natural combined width');
assert.match(app, /const displayHeight = linePreviewDisplayHeight\([\s\S]*?Number\(state\.sourcePreviewScale\) \|\| 1,[\s\S]*?img\.style\.height = `\$\{displayHeight\}px`;/,
  'multi-tile previews should derive their display width from fitted height and source aspect ratio');

const availableWidth = 1089;
const reviewSize = {width: 5664, height: 396};
const displayHeight = context.linePreviewDisplayHeight(1113, reviewSize, 1);
assert.ok(Math.abs(displayHeight * reviewSize.width / reviewSize.height - availableWidth) < 1,
  'a long multi-tile line should fill the full available preview width at fit scale');
assert.ok(displayHeight > 0, 'fitting a long row must retain a visible preview height');

assert.ok(context.linePreviewDisplayHeight(1113, reviewSize, 1.3) * reviewSize.width / reviewSize.height > availableWidth,
  'the existing zoom control should still enlarge a fitted row beyond the panel width');
assert.equal(context.linePreviewDisplayHeight(1113, {width: 500, height: 300}, 1), 160,
  'ordinary rows should retain the existing 160px base height at fit scale');
console.log('Long multi-tile line previews fill the available width while zoom remains available.');
