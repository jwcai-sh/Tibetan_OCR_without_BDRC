(() => {
  'use strict';
  const core = window.TbTranslationCore;
  const PAGE_SIZE = 15;
  const DB_NAME = 'tb-paragraph-translations-v1';
  const STORE_NAME = 'results';
  const settingsKey = 'tb-paragraph-translations:settings-v2';
  const routeBookId = new URLSearchParams(location.search).get('book_id');
  const bookId = /^[0-9a-f]{32}$/.test(routeBookId || '') ? routeBookId : '';
  const cloudBase = bookId ? `/api/books/${bookId}/tb` : '';
  const byId = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    'fileInput', 'endpointInput', 'modelAInput', 'modelBInput', 'customModelBInput', 'healthButton', 'status', 'workspace',
    'documentTitle', 'documentSummary', 'previousPageButton', 'nextPageButton', 'pageInput', 'pageTotal',
    'segmentList', 'segmentTitle', 'segmentProgress', 'sourceText', 'translateAButton', 'translateBButton',
    'pilotButton', 'stopButton', 'exportButton', 'modelATitle', 'modelBTitle', 'modelAText', 'modelBText',
    'useAButton', 'useBButton', 'teacherImport', 'yigdzin1Import', 'teacherText', 'yigdzin1Text',
    'teacherMeta', 'yigdzin1Meta', 'useTeacherButton', 'useYigdzin1Button',
    'finalText', 'saveFinalButton', 'saveState',
  ].map((id) => [id, byId(id)]));
  const state = { rows: [], records: {}, references: { teacher: {}, yigdzin1: {} }, hash: '', name: '', selected: 0, page: 1, db: null, busy: false, controller: null, draftDirty: false };

  async function cloudJson(path, options = {}) {
    const response = await fetch(`${cloudBase}${path}`, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('协作登录已失效，请返回原书页面重新登录后再打开 TB 翻译。');
      throw Object.assign(new Error(payload.detail || payload.error || `云端请求失败：HTTP ${response.status}`), { status: response.status });
    }
    return payload;
  }

  async function readOriginalBookSource() {
    status('正在读取已选的云端编号 TXT 并关联到 TB 段落…');
    const response = await fetch(`/api/books/${bookId}/source`, { credentials: 'same-origin' });
    if (!response.ok) {
      if (response.status === 401) throw new Error('协作登录已失效，请返回书籍目录重新登录。');
      throw new Error(`读取已选文件失败：HTTP ${response.status}`);
    }
    const disposition = response.headers.get('content-disposition') || '';
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    let name = '云端原文.txt';
    if (encodedName) {
      try { name = decodeURIComponent(encodedName); } catch (_) { /* Use the fallback name. */ }
    }
    if (!/\.txt$/i.test(name)) throw new Error('所选书籍不是编号 TXT；请从云端目录选择含 [TB-0001] 段号的 TXT。');
    return { name, text: await response.text() };
  }

  function ensureCloudSource() {
    return core.ensureBookTbSource({
      readAttached: () => cloudJson('/source'),
      readOriginal: readOriginalBookSource,
      attach: ({ name, text }) => cloudJson('/source', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, text }),
      }),
    });
  }

  async function loadCloudRows(rows) {
    if (!bookId || !rows.length) return;
    const models = modelIds().filter(Boolean);
    for (let start = 0; start < rows.length; start += 30) {
      const ids = rows.slice(start, start + 30).map((row) => row.id).join(',');
      const query = new URLSearchParams({ ids, models: models.join(','), source_hash: state.hash });
      const result = await cloudJson(`/results?${query}`);
      for (const [id, record] of Object.entries(result.records || {})) {
        state.records[id] = { ...(state.records[id] || {}), ...record,
          models: { ...(state.records[id]?.models || {}), ...(record.models || {}) } };
      }
    }
    render(false);
  }

  async function loadReferences() {
    if (!bookId) return;
    for (const kind of ['teacher', 'yigdzin1']) {
      try {
        const saved = await cloudJson(`/references/${kind}`);
        if (saved.source_hash === state.hash) state.references[kind] = saved.entries || {};
        ui[kind === 'teacher' ? 'teacherMeta' : 'yigdzin1Meta'].textContent = `${saved.name || '参考稿'} · ${Object.keys(state.references[kind]).length} 段`;
      } catch (error) {
        if (!/不存在|404|Not Found/.test(error.message)) throw error;
      }
    }
  }

  async function importReference(kind, file) {
    if (!file || !state.rows.length) throw new Error('请先打开 TB 编号原文');
    const entries = core.parseReferenceDocument(await file.text(), state.rows);
    if (bookId) await cloudJson(`/references/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_hash: state.hash, name: file.name, entries }) });
    state.references[kind] = entries;
    ui[kind === 'teacher' ? 'teacherMeta' : 'yigdzin1Meta'].textContent = `${file.name} · ${Object.keys(entries).length} 段`;
    renderEditor(false);
    status(`${kind === 'teacher' ? '教师校正稿' : 'Yigdzin1'} 已导入 ${Object.keys(entries).length} 段。`, 'success');
  }

  function status(message, type = '') {
    ui.status.textContent = message;
    ui.status.className = type;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function loadRecords(hash) {
    const transaction = state.db.transaction(STORE_NAME, 'readonly');
    const prefix = `${hash}:`;
    return dbRequest(transaction.objectStore(STORE_NAME).getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  }

  function saveRecord(id) {
    const record = state.records[id];
    record.updatedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const transaction = state.db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ ...record, key: `${state.hash}:${id}` });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('浏览器存储已中止'));
    });
  }

  async function saveCloudResult(id, kind, text, model = '') {
    if (!bookId) return;
    await cloudJson(`/results/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_hash: state.hash, kind, model, text }),
    });
  }

  async function documentHash(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function currentRow() { return state.rows[state.selected]; }
  function recordFor(id) { return state.records[id] ||= { id, models: {}, final: '' }; }
  function modelIds() { return [ui.modelAInput.value.trim(), ui.modelBInput.value === 'custom' ? ui.customModelBInput.value.trim() : ui.modelBInput.value.trim()]; }
  function validateModels(both = false) {
    const models = modelIds();
    if (!models[0] || !models[1]) throw new Error('请分别选择 Gemini 和 GPT 模型');
    if (both && models[0] === models[1]) throw new Error('两个对照模型必须使用不同的模型 ID');
    return models;
  }

  function saveSettings() {
    localStorage.setItem(settingsKey, JSON.stringify({
      endpoint: ui.endpointInput.value.trim(), modelA: ui.modelAInput.value.trim(), modelB: modelIds()[1],
    }));
    if (state.rows.length) {
      renderEditor(false);
      if (bookId) void loadCloudRows(core.getVirtualPage(state.rows, state.page, PAGE_SIZE)).catch(showError);
    }
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      if (saved.endpoint) ui.endpointInput.value = saved.endpoint;
      if (saved.modelA && [...ui.modelAInput.options].some((option) => option.value === saved.modelA)) ui.modelAInput.value = saved.modelA;
      if (saved.modelB) {
        if ([...ui.modelBInput.options].some((option) => option.value === saved.modelB)) ui.modelBInput.value = saved.modelB;
        else { ui.modelBInput.value = 'custom'; ui.customModelBInput.value = saved.modelB; }
      }
      ui.customModelBInput.hidden = ui.modelBInput.value !== 'custom';
    } catch (_) { /* Keep visible defaults. */ }
  }

  async function importFile(file) {
    if (!file) return;
    if (state.busy) throw new Error('翻译进行中，请先停止再导入文件');
    if (state.draftDirty) await saveFinal();
    const text = await file.text();
    core.parseTbDocument(text);
    const attached = bookId ? await cloudJson('/source', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, text }),
    }) : null;
    await loadDocument(attached?.text || text, attached?.name || file.name, attached?.source_hash);
  }

  async function loadDocument(text, name, cloudHash = '') {
    const rows = core.parseTbDocument(text);
    const hash = cloudHash || await documentHash(text);
    state.db ||= await openDb();
    const stored = await loadRecords(hash);
    state.rows = rows;
    state.hash = hash;
    state.name = name;
    state.records = bookId ? {} : Object.fromEntries(stored.map(({ key, ...record }) => [record.id, record]));
    state.references = { teacher: {}, yigdzin1: {} };
    state.selected = 0;
    state.page = 1;
    state.draftDirty = false;
    ui.workspace.hidden = false;
    render(true);
    if (bookId) {
      await loadCloudRows(rows.slice(0, 30));
      await loadReferences();
      render(true);
    }
    status(`已打开 ${name}：${rows.length} 段，${Math.ceil(rows.length / PAGE_SIZE)} 个浏览页。${bookId ? '云端译文已同步。' : '本机译文已恢复。'}`, 'success');
  }

  function render(resetDraft = false) {
    ui.documentTitle.textContent = state.name;
    const models = modelIds();
    const done = state.rows.filter((row) => models.every((model) => state.records[row.id]?.models?.[model]?.text)).length;
    const final = state.rows.filter((row) => state.records[row.id]?.final?.trim()).length;
    ui.documentSummary.textContent = `${state.rows.length} 段 · 双模型完成 ${done} · 定稿 ${final}`;
    const count = Math.ceil(state.rows.length / PAGE_SIZE);
    ui.pageInput.max = String(count);
    ui.pageInput.value = String(state.page);
    ui.pageTotal.textContent = `/ ${count}`;
    ui.previousPageButton.disabled = state.busy || state.page <= 1;
    ui.nextPageButton.disabled = state.busy || state.page >= count;
    ui.segmentList.replaceChildren(...core.getVirtualPage(state.rows, state.page, PAGE_SIZE).map((row) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `segment-item${row.id === currentRow().id ? ' active' : ''}`;
      button.disabled = state.busy;
      const label = document.createElement('strong');
      label.textContent = row.id;
      const stateLabel = document.createElement('small');
      const record = state.records[row.id];
      stateLabel.textContent = record?.final?.trim() ? '已定稿' : models.every((model) => record?.models?.[model]?.text) ? '双模型已译' : '待处理';
      button.append(label, stateLabel);
      button.addEventListener('click', () => void showSegment(state.rows.indexOf(row)).catch(showError));
      return button;
    }));
    renderEditor(resetDraft);
  }

  function renderEditor(resetDraft) {
    const row = currentRow();
    const record = recordFor(row.id);
    const [modelA, modelB] = modelIds();
    ui.segmentTitle.textContent = row.id;
    ui.segmentProgress.textContent = `${state.selected + 1} / ${state.rows.length}`;
    ui.sourceText.textContent = row.text;
    ui.modelATitle.textContent = ui.modelAInput.selectedOptions[0]?.textContent || modelA;
    ui.modelBTitle.textContent = ui.modelBInput.value === 'custom' ? modelB : ui.modelBInput.selectedOptions[0]?.textContent || modelB;
    ui.modelAText.value = record.models[modelA]?.text || '';
    ui.modelBText.value = record.models[modelB]?.text || '';
    ui.teacherText.value = state.references.teacher[row.id] || '';
    ui.yigdzin1Text.value = state.references.yigdzin1[row.id] || '';
    ui.useAButton.disabled = !ui.modelAText.value;
    ui.useBButton.disabled = !ui.modelBText.value;
    ui.useTeacherButton.disabled = !ui.teacherText.value;
    ui.useYigdzin1Button.disabled = !ui.yigdzin1Text.value;
    if (resetDraft) {
      ui.finalText.value = record.final || '';
      state.draftDirty = false;
      ui.saveState.textContent = record.final ? '已保存' : '未定稿';
    }
  }

  async function saveFinal() {
    if (!state.rows.length) return;
    const row = currentRow();
    const record = recordFor(row.id);
    if (!state.draftDirty && record.final === ui.finalText.value) return;
    await saveCloudResult(row.id, 'final', ui.finalText.value);
    record.final = ui.finalText.value;
    await saveRecord(row.id);
    state.draftDirty = false;
    ui.saveState.textContent = '已保存';
    render(false);
    status(`${row.id} 人工定稿已保存。`, 'success');
  }

  async function showSegment(index) {
    if (index < 0 || index >= state.rows.length) return;
    if (state.busy) throw new Error('翻译进行中，请先停止再切换段落');
    if (state.draftDirty) await saveFinal();
    state.selected = index;
    state.page = Math.floor(index / PAGE_SIZE) + 1;
    if (bookId) await loadCloudRows(core.getVirtualPage(state.rows, state.page, PAGE_SIZE));
    render(true);
  }

  async function goPage(page) {
    const count = Math.ceil(state.rows.length / PAGE_SIZE);
    if (!Number.isInteger(page) || page < 1 || page > count) throw new Error(`页码应在 1–${count} 之间`);
    await showSegment((page - 1) * PAGE_SIZE);
  }

  function setBusy(busy) {
    state.busy = busy;
    [ui.translateAButton, ui.translateBButton, ui.pilotButton, ui.healthButton].forEach((button) => { button.disabled = busy; });
    ui.stopButton.disabled = !busy;
    [ui.fileInput, ui.teacherImport, ui.yigdzin1Import, ui.endpointInput, ui.modelAInput, ui.modelBInput, ui.customModelBInput, ui.pageInput,
      ui.previousPageButton, ui.nextPageButton].forEach((input) => { input.disabled = busy; });
    ui.segmentList.querySelectorAll('button').forEach((button) => { button.disabled = busy; });
    if (!busy && state.rows.length) render(false);
  }

  function addAvailableModels(data) {
    const choices = data.aggregator_config?.unifiedModels;
    if (!Array.isArray(choices)) return;
    for (const entry of choices) {
      const model = typeof entry === 'string' ? entry : entry?.id || entry?.model || '';
      const select = model.startsWith('gemini:') ? ui.modelAInput : /gpt/i.test(model) ? ui.modelBInput : null;
      if (!select || [...select.options].some((option) => option.value === model)) continue;
      const option = new Option(model.replace(/^[^:]+:/, ''), model);
      select.add(option);
    }
  }

  async function checkHealth() {
    const endpoint = ui.endpointInput.value.trim();
    if (!/^https?:\/\//.test(endpoint)) throw new Error('请填写有效的 HTTP 翻译接口地址');
    const aggregator = /\/api\/aggregate\/chat\/?$/.test(endpoint);
    const url = aggregator ? endpoint.replace(/\/chat\/?$/, '/health')
      : /\/api\/translate\/?$/.test(endpoint) ? `${endpoint.replace(/\/$/, '')}/health`
      : endpoint.replace(/\/translate\/?$/, '/health');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`翻译服务健康检查 HTTP ${response.status}`);
    const data = await response.json();
    if (aggregator) {
      if (data.ok !== true) throw new Error(data.error || '模型聚合服务未就绪');
      return { ...data, provider: 'model_aggregator' };
    }
    const provider = data.provider || data.translation?.provider;
    if (!(data.loaded || data.status === 'ready' || data.translation?.status === 'ready' || (data.ok === true && data.translation?.provider))) throw new Error(data.error || `翻译服务未就绪：${data.status || 'unknown'}`);
    if (!['model_aggregator', 'model-aggregator', 'aggregator'].includes(provider)) {
      throw new Error(`当前接口使用 ${provider || '未知提供者'}，不支持按模型 ID 切换；请使用模型聚合接口或配置为 model_aggregator 的翻译服务。`);
    }
    addAvailableModels(data);
    return { ...data, provider };
  }

  async function translateRow(row, model, signal) {
    const index = state.rows.indexOf(row);
    const request = core.buildTranslationRequest(row, {
      previous: state.rows[index - 1], next: state.rows[index + 1],
    }, { model, sourceName: state.name, page: Math.floor(index / PAGE_SIZE) + 1 });
    const endpoint = ui.endpointInput.value.trim();
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, 150000);
    try {
      const aggregator = /\/api\/aggregate\/chat\/?$/.test(endpoint);
      const body = aggregator ? core.buildAggregatorRequest(request) : request;
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      let data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (response.status === 202 && data.status_url) {
        if (!/^\/api\/translate\/jobs\/[0-9a-f]{32}$/.test(data.status_url)) throw new Error('翻译任务地址无效');
        const jobUrl = data.status_url;
        while (true) {
          if (controller.signal.aborted) throw new Error('已停止翻译');
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const progress = await fetch(jobUrl, { credentials: 'same-origin', signal: controller.signal });
          data = await progress.json().catch(() => ({}));
          if (!progress.ok) throw new Error(data.detail || data.error || `翻译任务 HTTP ${progress.status}`);
          if (data.status !== 'running' && data.status !== 'queued') break;
        }
      }
      if (data.ok === false) throw new Error(data.error || data.message || '模型聚合服务返回失败');
      if (data.model && !core.modelsMatch(model, data.model)) throw new Error(`实际返回模型 ${data.model} 与请求模型 ${model} 不一致，译文未保存`);
      return core.extractTranslation(data);
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal?.aborted ? '已停止翻译' : '请求超过 150 秒');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
    }
  }

  async function saveModel(row, model, text) {
    await saveCloudResult(row.id, 'model', text, model);
    const record = recordFor(row.id);
    record.models[model] = { text, updatedAt: new Date().toISOString() };
    await saveRecord(row.id);
    render(false);
  }

  async function runOne(which) {
    if (!state.rows.length || state.busy) return;
    const model = modelIds()[which];
    if (!model) { showError(new Error(`请填写模型 ${which === 0 ? 'A' : 'B'} 的完整模型 ID`)); return; }
    const row = currentRow();
    setBusy(true);
    state.controller = new AbortController();
    try {
      await checkHealth();
      status(`正在翻译 ${row.id} / ${model}…`);
      const translated = await translateRow(row, model, state.controller.signal);
      if (state.controller.signal.aborted) throw new Error('已停止翻译');
      await saveModel(row, model, translated);
      status(`${row.id} / ${model} 已保存。`, 'success');
    } catch (error) { showError(error); }
    finally { state.controller = null; setBusy(false); }
  }

  async function runPilot() {
    if (!state.rows.length || state.busy) return;
    let models;
    try { models = validateModels(true); } catch (error) { showError(error); return; }
    const rows = state.rows.slice(state.selected, state.selected + 20);
    setBusy(true);
    state.controller = new AbortController();
    try {
      if (bookId) await loadCloudRows(rows);
      await checkHealth();
      status(`从 ${rows[0].id} 开始试译 ${rows.length} 段。已有结果将跳过。`);
      const completed = await core.runTranslationBatch(rows, models, state.records,
        (row, model) => translateRow(row, model, state.controller.signal),
        async (row, model, text) => {
          await saveModel(row, model, text);
          status(`已保存 ${row.id} / ${model}，可随时停止。`, 'success');
        }, state.controller.signal);
      status(`试译结束：新增 ${completed} 份译文，已有结果已跳过。`, 'success');
    } catch (error) { showError(error); }
    finally { state.controller = null; setBusy(false); }
  }

  function useCandidate(text) {
    ui.finalText.value = text;
    state.draftDirty = true;
    ui.saveState.textContent = '未保存';
    void saveFinal().catch(showError);
  }

  async function exportAll() {
    if (!state.rows.length) return;
    if (bookId) await loadCloudRows(state.rows);
    const models = [...new Set([...modelIds(), ...Object.values(state.records).flatMap((record) => Object.keys(record.models || {}))])].filter(Boolean);
    const content = core.exportTranslationMarkdown(state.rows, state.records, models, state.references);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.name.replace(/\.txt$/i, '')}-翻译对照.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status(`已导出 ${state.rows.length} 段的翻译对照。`, 'success');
  }

  function showError(error) { status(error?.message || String(error), 'error'); }

  restoreSettings();
  if (bookId) {
    ui.endpointInput.value = `${location.origin}/api/translate`;
    byId('backLink').href = `./?workflow=translation&book_id=${encodeURIComponent(bookId)}`;
    status('正在读取本书的 TB 编号原文…');
    void ensureCloudSource().then((source) => loadDocument(source.text, source.name, source.source_hash)).catch(showError);
  }
  ui.fileInput.addEventListener('change', () => void importFile(ui.fileInput.files[0]).catch(showError));
  [ui.endpointInput, ui.modelAInput, ui.modelBInput, ui.customModelBInput].forEach((input) => input.addEventListener('change', saveSettings));
  ui.modelBInput.addEventListener('change', () => { ui.customModelBInput.hidden = ui.modelBInput.value !== 'custom'; });
  [ui.modelAInput, ui.modelBInput].forEach((input) => input.addEventListener('input', () => {
    if (state.rows.length) renderEditor(false);
  }));
  ui.healthButton.addEventListener('click', () => void checkHealth().then((data) => status(`翻译服务已就绪：${data.provider || ''} ${data.model || ''}`, 'success')).catch(showError));
  ui.previousPageButton.addEventListener('click', () => void goPage(state.page - 1).catch(showError));
  ui.nextPageButton.addEventListener('click', () => void goPage(state.page + 1).catch(showError));
  ui.pageInput.addEventListener('change', () => void goPage(Number(ui.pageInput.value)).catch(showError));
  ui.translateAButton.addEventListener('click', () => void runOne(0));
  ui.translateBButton.addEventListener('click', () => void runOne(1));
  ui.pilotButton.addEventListener('click', () => void runPilot());
  ui.stopButton.addEventListener('click', () => state.controller?.abort());
  ui.useAButton.addEventListener('click', () => useCandidate(ui.modelAText.value));
  ui.useBButton.addEventListener('click', () => useCandidate(ui.modelBText.value));
  ui.useTeacherButton.addEventListener('click', () => useCandidate(ui.teacherText.value));
  ui.useYigdzin1Button.addEventListener('click', () => useCandidate(ui.yigdzin1Text.value));
  ui.teacherImport.addEventListener('change', () => void importReference('teacher', ui.teacherImport.files[0]).catch(showError));
  ui.yigdzin1Import.addEventListener('change', () => void importReference('yigdzin1', ui.yigdzin1Import.files[0]).catch(showError));
  ui.finalText.addEventListener('input', () => { state.draftDirty = true; ui.saveState.textContent = '未保存'; });
  ui.saveFinalButton.addEventListener('click', () => void saveFinal().catch(showError));
  ui.exportButton.addEventListener('click', () => void saveFinal().then(exportAll).catch(showError));
})();
