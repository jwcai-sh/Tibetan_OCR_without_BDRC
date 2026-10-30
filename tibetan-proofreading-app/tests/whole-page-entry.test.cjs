const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../app.js'), 'utf8');

function functionSource(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `${start} must exist`);
  return source.slice(first, last);
}

test('cloud OCR project resumes in whole-page view', () => {
  let destination = '';
  const context = {
    window: { location: { assign(url) { destination = url; } } },
    isCloudDeployment: () => true,
  };
  vm.runInNewContext(functionSource('function openHomeProject(', 'async function openFolderProject('), context);
  context.openHomeProject({ remoteBookId: 'book-123' }, 'ocr');
  assert.equal(destination, './whole-page-proofread.html?book_id=book-123&page=1');
});

test('OSS PDF opens directly in whole-page view after library registration', async () => {
  let destination = '';
  let resumed = false;
  const context = {
    state: { documentRequestId: 0 },
    cloudLibrary: { authMode: 'collaboration', apiBaseUrl: '' },
    setCloudLibraryStatus: () => {},
    isCloudDeployment: () => true,
    isLocalWorkbench: () => false,
    cloudLibraryApiOrigin: () => 'https://example.test',
    fetchWithCloudTimeout: async () => ({ ok: true, json: async () => ({ book_id: 'oss-book', name: 'source.pdf', content_type: 'application/pdf' }) }),
    isPdfFile: ({ name }) => name.endsWith('.pdf'),
    resumeRemoteProject: async () => { resumed = true; },
    window: { location: { assign(url) { destination = url; } } },
  };
  vm.runInNewContext(functionSource('async function openCloudLibraryFile(', 'function renderHomeDashboard('), context);
  await context.openCloudLibraryFile({ path: 'source.pdf' });
  assert.equal(destination, './whole-page-proofread.html?book_id=oss-book&page=1');
  assert.equal(resumed, false);
});

test('cached PDF without a cloud book uploads for whole-page proofreading', async () => {
  let destination = '';
  const context = {
    window: { location: { origin: 'https://example.test', assign(url) { destination = url; } } },
    setStatus: () => {},
    getStoredSourceFile: async () => ({ name: 'source.pdf' }),
    FormData: class { append() {} },
    fetchWithCloudTimeout: async () => ({ ok: true, json: async () => ({ book_id: 'new-book' }) }),
  };
  vm.runInNewContext(functionSource('async function openCachedPdfInWholePage(', 'async function openFolderProject('), context);
  await context.openCachedPdfInWholePage({ cacheKey: 'cached', sourceName: 'source.pdf' });
  assert.equal(destination, './whole-page-proofread.html?book_id=new-book&page=1');
});

test('old cloud OCR URL opens whole page, explicit line view stays in workbench', async () => {
  for (const [search, shouldRedirect] of [
    ['?workflow=ocr&book_id=book-123', true],
    ['?workflow=ocr&book_id=book-123&view=line', false],
  ]) {
    let destination = '';
    let restored = false;
    const context = {
      window: { location: { search, assign(url) { destination = url; } } },
      URLSearchParams,
      initializeProofreadFallback: async () => {},
      isCloudDeployment: () => true,
      showWorkbenchView: () => {},
      resumeRemoteProject: async () => { restored = true; },
    };
    vm.runInNewContext(functionSource('async function restoreRouteFromLocation(', 'async function restoreActiveProjectForRoute('), context);
    context.getWorkflowFromLocation = () => 'ocr';
    await context.restoreRouteFromLocation();
    assert.equal(Boolean(destination), shouldRedirect);
    assert.equal(restored, !shouldRedirect);
  }
});

test('cached cloud OCR project also restores in whole-page view', async () => {
  let destination = '';
  const context = {
    state: { activeProjectRestoreInFlight: false },
    window: {
      location: { search: '?workflow=ocr', assign(url) { destination = url; } },
      localStorage: { getItem: () => 'project:book-123' },
    },
    URLSearchParams,
    hasActiveDocument: () => false,
    ACTIVE_PROJECT_KEY: 'active',
    CACHE_PREFIX: 'project:',
    parseCachedProject: () => ({ remoteBookId: 'book-123' }),
    isCloudDeployment: () => true,
  };
  vm.runInNewContext(functionSource('async function restoreActiveProjectForRoute(', 'function updateRouteForWorkflow('), context);
  await context.restoreActiveProjectForRoute('ocr');
  assert.equal(destination, './whole-page-proofread.html?book_id=book-123&page=1');
});
