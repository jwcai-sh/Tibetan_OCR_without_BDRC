import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

class FakeCanvas {
  constructor() {
    this.calls = [];
    this.width = 0;
    this.height = 0;
  }
  getContext() {
    return {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: '',
      translate: (...args) => this.calls.push(['translate', ...args]),
      rotate: (...args) => this.calls.push(['rotate', ...args]),
      drawImage: (...args) => this.calls.push(['drawImage', ...args]),
    };
  }
}

class FakeSourceCanvas {
  width = 1000;
  height = 1200;
}

function fakeElement(tagName) {
  const classes = new Set();
  return {
    tagName,
    children: [],
    className: '',
    style: {},
    dataset: {},
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
    },
    appendChild(child) { this.children.push(child); },
    append(...children) { this.children.push(...children); },
    addEventListener() {},
  };
}

const context = vm.createContext({
  console,
  window: {addEventListener() {}},
  document: {querySelector: () => null, createElement: (tag) => tag === 'canvas' ? new FakeCanvas() : fakeElement(tag)},
  HTMLCanvasElement: FakeSourceCanvas,
});
vm.runInContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), context);
vm.runInContext(`
  state.sourcePreviewScale = 1;
  getVisibleSourceElement = () => new HTMLCanvasElement();
  getSelectedOcrProfile = () => ({id:'traditional'});
`, context);

test('left vertical region preview preserves BDRC rotation and displays a landscape crop', () => {
  const result = vm.runInContext(`(() => {
    const regions = normalizeOcrRegions([{
      id:'left', label:'左侧', direction:'vertical', ocr_rotation:'counterclockwise',
      bbox:{x:.05,y:.1,width:.1,height:.8}, text:'བོད',
      lines:[{text:'བོད',bbox:{x:.05,y:.1,width:.1,height:.8}}],
    }]);
    const line = flattenTraditionalRegionLines(regions)[0];
    const preview = createSourceBlockPreviewCanvas(line);
    return {
      lineRotation: line.regionRotation,
      previewWidth: preview.children[0].width,
      previewHeight: preview.children[0].height,
      transforms: preview.children[0].calls.filter(([name]) => name === 'rotate'),
    };
  })()`, context);

  assert.equal(result.lineRotation, 'counterclockwise');
  assert.ok(result.previewWidth > result.previewHeight, 'vertical crop should be rotated into landscape');
  assert.deepEqual(JSON.parse(JSON.stringify(result.transforms)), [['rotate', -Math.PI / 2]]);
});

test('left vertical preview defaults to clockwise only when cached rotation metadata is absent', () => {
  const transforms = vm.runInContext(`(() => {
    const preview = createSourceBlockPreviewCanvas({
      bbox:{x:.05,y:.1,width:.1,height:.8}, regionId:'left', regionDirection:'vertical',
    });
    return preview.children[0].calls.filter(([name]) => name === 'rotate');
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(transforms)), [['rotate', Math.PI / 2]]);
});

test('normalized cached BDRC lines retain their selected preview rotation', () => {
  const rotation = vm.runInContext(`normalizeOcrCompareSide({lines:[{
    text:'བོད', regionId:'left', regionDirection:'vertical', regionRotation:'counterclockwise',
  }]}).lines[0].regionRotation`, context);
  assert.equal(rotation, 'counterclockwise');
});

test('the right-side original panel shows the left vertical crop preview', () => {
  const panel = vm.runInContext(`renderProofreadSourcePanel({
    regionId:'left', regionLabel:'左侧', regionDirection:'vertical',
    bbox:{x:.05,y:.1,width:.1,height:.8},
  }, 0)`, context);
  assert.ok(panel.children.some((child) => child.className === 'proofread-source-preview'));
});
