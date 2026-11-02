import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('async function deleteCloudLibraryFile(');
const end = app.indexOf('function formatCloudLibrarySize(', start);
assert.ok(start >= 0 && end > start, 'cloud library delete action must exist');

function makeAction({ confirm = true, response = { ok: true, json: async () => ({ ok: true }) } } = {}) {
  const calls = [];
  const messages = [];
  const cloudLibrary = { items: [{ path: '经书/第一册.pdf', size: 9, etag: 'old-etag' }, { path: '保留.pdf', size: 4, etag: 'keep-etag' }], authMode: 'collaboration', actor: 'msh', token: '', accessToken: '', apiBaseUrl: '' };
  const els = { cloudLibraryCount: { textContent: '' } };
  const action = new Function('window', 'cloudLibrary', 'els', 'fetchWithCloudTimeout', 'cloudLibraryApiOrigin', 'isCloudDeployment', 'isLocalWorkbench', 'renderCloudLibraryRows', 'setCloudLibraryStatus',
    `${app.slice(start, end)}\nreturn deleteCloudLibraryFile;`)(
    { confirm: (message) => { calls.push(['confirm', message]); return confirm; } }, cloudLibrary, els,
    async (url, options) => { calls.push(['fetch', url, options]); return response; },
    () => 'https://example.test', () => true, () => false,
    () => calls.push(['render']), (message, error) => messages.push([message, Boolean(error)]),
  );
  return { action, calls, messages, cloudLibrary, els };
}

test('canceling deletion keeps the file and sends no request', async () => {
  const context = makeAction({ confirm: false });
  await context.action({ path: '经书/第一册.pdf', size: 9, etag: 'old-etag' }, { disabled: false });
  assert.equal(context.calls.filter(([type]) => type === 'fetch').length, 0);
  assert.equal(context.cloudLibrary.items.length, 2);
});

test('confirmed deletion sends the selected path and removes only that row after success', async () => {
  const context = makeAction();
  await context.action({ path: '经书/第一册.pdf', size: 9, etag: 'old-etag' }, { disabled: false });
  const request = context.calls.find(([type]) => type === 'fetch');
  assert.equal(request[1], 'https://example.test/api/library/file');
  assert.equal(request[2].method, 'DELETE');
  assert.deepEqual(JSON.parse(request[2].body), { path: '经书/第一册.pdf', size: 9, etag: 'old-etag' });
  assert.deepEqual(context.cloudLibrary.items.map(item => item.path), ['保留.pdf']);
  assert.equal(context.els.cloudLibraryCount.textContent, '1 项');
});

test('failed deletion leaves the file and shows the error in the library', async () => {
  const context = makeAction({ response: { ok: false, status: 409, json: async () => ({ detail: '文件已更新' }) } });
  await context.action({ path: '经书/第一册.pdf', size: 9, etag: 'old-etag' }, { disabled: false });
  assert.equal(context.cloudLibrary.items.length, 2);
  assert.match(context.messages.at(-1)[0], /文件已更新/);
  assert.equal(context.messages.at(-1)[1], true);
});
