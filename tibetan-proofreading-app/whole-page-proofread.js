(function (root) {
  'use strict';

  const MODEL_KEYS = ['gemini4', 'teacher', 'yigdzin1'];
  const MODEL_LABELS = { gemini4: 'Gemini 4', teacher: '教师校正稿', yigdzin1: 'Yigdzin1' };

  function parsePageTextFile(source, pageCount) {
    const text = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const headings = [...text.matchAll(/^第\s*(\d+)\s*页\s*$/gm)];
    if (headings.length !== pageCount) throw new Error(`需要 ${pageCount} 页，实际找到 ${headings.length} 页`);
    const pages = {};
    headings.forEach((heading, index) => {
      const page = Number(heading[1]);
      if (page !== index + 1) throw new Error(`页码不连续：第 ${page} 页`);
      pages[String(page)] = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim();
    });
    return pages;
  }

  function graphemes(text) {
    if (typeof Intl.Segmenter === 'function') {
      return [...new Intl.Segmenter('bo', { granularity: 'grapheme' }).segment(text)].map(part => part.segment);
    }
    return Array.from(text);
  }

  function diffSegments(reference, candidate) {
    const source = graphemes(String(reference || '')).filter(part => !/^\s+$/u.test(part));
    const visible = graphemes(String(candidate || ''));
    const target = visible.filter(part => !/^\s+$/u.test(part));
    const n = source.length, m = target.length;
    if (n * m > 4_000_000) return candidate ? [{ type: 'diff', text: String(candidate) }] : [{ type: 'omission' }];
    const width = m + 1;
    const table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i * width + j] = source[i].normalize('NFC') === target[j].normalize('NFC')
          ? 1 + table[(i + 1) * width + j + 1]
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    const matched = new Set();
    const omissions = new Set();
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (source[i].normalize('NFC') === target[j].normalize('NFC')) { matched.add(j); i += 1; j += 1; }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { omissions.add(j); i += 1; }
      else j += 1;
    }
    if (i < n) omissions.add(m);
    const pieces = [];
    const push = (type, text = '') => {
      const last = pieces[pieces.length - 1];
      if (type !== 'omission' && last?.type === type) last.text += text;
      else pieces.push(type === 'omission' ? { type } : { type, text });
    };
    let tokenIndex = 0;
    for (const part of visible) {
      if (!/^\s+$/u.test(part)) {
        if (omissions.has(tokenIndex)) push('omission');
        push(matched.has(tokenIndex) ? 'plain' : 'diff', part);
        tokenIndex += 1;
      } else push('plain', part);
    }
    if (omissions.has(m)) push('omission');
    return pieces;
  }

  function pagesForRecognition(count, pages, mode) {
    return Array.from({ length: count }, (_, index) => index + 1)
      .filter(page => mode !== 'remaining' || !String(pages?.[String(page)] || '').trim());
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { diffSegments, parsePageTextFile, pagesForRecognition };
  if (!root.document) return;

  const $ = id => root.document.getElementById(id);
  const params = new URLSearchParams(root.location.search);
  const bookId = params.get('book_id') || '';
  $('topImportControls').hidden = Boolean(bookId);
  const state = { page: Math.max(1, Number(params.get('page')) || 1), count: 0, pages: {}, pageModels: {}, dirty: false, saving: false, recognizing: false, batchRecognizing: false, batchStop: false, pageRequest: 0 };
  const endpoint = path => `/api/books/${encodeURIComponent(bookId)}${path}`;
  const draftKey = page => `whole-page-proofread-draft:${bookId}:${page}`;

  function feedback(message, error = false) {
    $('feedback').textContent = message;
    $('feedback').classList.toggle('error', error);
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
    return payload;
  }

  async function loadCollaborationActor() {
    try {
      const actor = await requestJson('/api/collaboration/me');
      $('collaborationActor').textContent = actor.name ? `协作者：${actor.name}` : '协作者：未登录';
      $('collaborationLogout').hidden = !actor.name;
    } catch {
      $('collaborationActor').textContent = '协作者：未登录';
      $('collaborationLogout').hidden = true;
    }
  }

  function geminiLabel(page = state.page) {
    const model = String(state.pageModels[String(page)] || 'gemini:gemini-4-argon').replace(/^gemini:/, '');
    return [...$('geminiRecognitionModel').options].find(option => option.value === model)?.textContent || model;
  }

  function renderCandidate(key) {
    const container = $(`${key}Text`);
    container.replaceChildren();
    if (key === 'gemini4') $('geminiModelLabel').textContent = `${geminiLabel()} · 差异基准`;
    const text = state.pages[key]?.[String(state.page)] || '';
    if (!text) {
      container.textContent = key === 'yigdzin1' ? '本页无藏文识别结果。' : '本页尚无识别结果。';
      container.classList.add('missing');
      return;
    }
    container.classList.remove('missing');
    if (key === 'gemini4') { container.textContent = text; return; }
    for (const piece of diffSegments(state.pages.gemini4?.[String(state.page)] || '', text)) {
      if (piece.type === 'plain') container.appendChild(root.document.createTextNode(piece.text));
      else {
        const mark = root.document.createElement(piece.type === 'diff' ? 'mark' : 'span');
        mark.className = piece.type === 'diff' ? 'different' : 'omission';
        if (piece.type === 'omission') {
          mark.title = 'Gemini 有字，此结果漏识';
          mark.setAttribute('aria-label', mark.title);
        } else mark.textContent = piece.text;
        container.appendChild(mark);
      }
    }
  }

  function renderNavigation() {
    $('pageNumber').textContent = `${state.page} / ${state.count}`;
    $('previous').disabled = state.page <= 1;
    $('next').disabled = state.page >= state.count;
    $('pageInput').value = String(state.page);
    $('pageInput').max = String(state.count);
    for (const button of $('pageIndex').querySelectorAll('button')) button.classList.toggle('active', Number(button.dataset.page) === state.page);
  }

  async function loadCorrected(page, token) {
    const result = await requestJson(endpoint(`/whole-page-proofread/${page}`));
    if (token !== state.pageRequest) return;
    let text = result.saved ? result.text : (state.pages.gemini4?.[String(page)] || '');
    let draft = null;
    try { draft = root.localStorage.getItem(draftKey(page)); }
    catch { /* Cloud copy remains available when local storage is blocked. */ }
    if (draft !== null) { text = draft; state.dirty = true; feedback(`第 ${page} 页有尚未同步的本机草稿，请检查后保存。`, true); }
    else { state.dirty = false; feedback(result.saved ? `第 ${page} 页正确版已从云端读取。` : `第 ${page} 页正确版以 Gemini 4 为起点，修改后保存。`); }
    $('correctedText').value = text;
    $('saveCorrected').disabled = !state.dirty;
  }

  async function loadPage(page) {
    state.page = page;
    const token = ++state.pageRequest;
    $('geminiRecognitionFeedback').textContent = '';
    const pageModel = String(state.pageModels[String(page)] || '').replace(/^gemini:/, '');
    if (pageModel && [...$('geminiRecognitionModel').options].some(option => option.value === pageModel && !option.disabled)) $('geminiRecognitionModel').value = pageModel;
    renderNavigation();
    for (const key of MODEL_KEYS) renderCandidate(key);
    $('pageScan').src = endpoint(`/pages/${page}/preview?dpi=200&format=jpeg&landscape=true`);
    $('pageScan').alt = `原始 PDF 第 ${page} 页`;
    $('correctedText').value = '';
    $('saveCorrected').disabled = true;
    const url = new URL(root.location.href);
    url.searchParams.set('page', String(page));
    root.history.replaceState(null, '', url);
    try { await loadCorrected(page, token); }
    catch (error) { if (token === state.pageRequest) feedback(`正确版读取失败：${error.message}`, true); }
  }

  function updateRecognitionControls() {
    const busy = state.recognizing || state.batchRecognizing;
    const available = Boolean(bookId && state.count && [...$('geminiRecognitionModel').options].some(option => !option.disabled));
    $('geminiRecognitionModel').disabled = busy;
    $('recognizeGemini').disabled = !available || busy;
    $('recognizeAllPages').disabled = !available || busy;
    $('recognizeRemainingPages').disabled = !available || busy || !pagesForRecognition(state.count, state.pages.gemini4, 'remaining').length;
    $('stopBatchRecognition').hidden = !state.batchRecognizing;
  }

  async function recognizeGeminiResult(page, model) {
      const job = await requestJson(endpoint('/gemini-recognition-jobs'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_num: page, model }),
      });
      if (!/^[a-f0-9]{32}$/.test(job.job_id || '')) throw new Error('识别任务编号无效');
      let result = null;
      for (let attempt = 0; attempt < 360; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const progress = await requestJson(`/api/line-review/jobs/${job.job_id}`);
        if (progress.status === 'failed') throw new Error(progress.error || '模型识别失败');
        if (progress.status === 'completed') { result = progress.result; break; }
      }
      if (!result) throw new Error('识别等待超时，请稍后重试');
      if (result.model !== `gemini:${model}` || !result.text?.trim()) throw new Error('模型身份或识别文本无效，原结果保留');
      const saved = await requestJson(endpoint(`/model-results/gemini4/pages/${page}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: result.text, model: result.model }),
      });
      state.pages.gemini4[String(page)] = saved.text;
      state.pageModels[String(page)] = saved.model;
      if (state.page === page) for (const key of MODEL_KEYS) renderCandidate(key);
      return saved;
  }

  async function recognizeGeminiPage() {
    if (!bookId || !state.count || state.recognizing || state.batchRecognizing) return;
    const page = state.page;
    const model = $('geminiRecognitionModel').value;
    state.recognizing = true;
    updateRecognitionControls();
    $('geminiRecognitionFeedback').textContent = '';
    feedback(`第 ${page} 页正在用 ${model} 识别…`);
    try {
      await recognizeGeminiResult(page, model);
      feedback(`第 ${page} 页 ${geminiLabel(page)} 识别结果已保存到云端。人工正确版仍需单独保存。`);
    } catch (error) {
      const message = `第 ${page} 页识别失败：${error.message}；原结果保留。`;
      $('geminiRecognitionFeedback').textContent = message;
      feedback(message, true);
    } finally {
      state.recognizing = false;
      updateRecognitionControls();
    }
  }

  async function recognizeBatch(mode) {
    if (!bookId || !state.count || state.recognizing || state.batchRecognizing) return;
    const pages = pagesForRecognition(state.count, state.pages.gemini4, mode);
    if (!pages.length) { feedback('所有页面已有 Gemini 识别结果。'); return; }
    const model = $('geminiRecognitionModel').value;
    state.batchRecognizing = true;
    state.batchStop = false;
    updateRecognitionControls();
    $('geminiRecognitionFeedback').textContent = '';
    const failed = [];
    let completed = 0;
    for (const page of pages) {
      if (state.batchStop) break;
      feedback(`批量识别 ${completed + failed.length + 1}/${pages.length}：第 ${page} 页（${model}）…`);
      try { await recognizeGeminiResult(page, model); completed += 1; }
      catch (error) { failed.push(page); console.error(`第 ${page} 页识别失败`, error); }
      updateRecognitionControls();
    }
    const stopped = state.batchStop;
    state.batchRecognizing = false;
    state.batchStop = false;
    updateRecognitionControls();
    const summary = `批量识别${stopped ? '已停止' : '已结束'}：成功 ${completed}/${pages.length} 页${failed.length ? `；失败页：${failed.join('、')}` : ''}。已保存的正确版未修改。`;
    $('geminiRecognitionFeedback').textContent = failed.length ? summary : '';
    feedback(summary, Boolean(failed.length));
  }

  async function saveCorrected() {
    if (!state.dirty || state.saving) return true;
    const page = state.page;
    const text = $('correctedText').value;
    state.saving = true;
    $('saveCorrected').disabled = true;
    $('correctedText').readOnly = true;
    feedback(`正在保存第 ${page} 页正确版…`);
    try {
      await requestJson(endpoint(`/whole-page-proofread/${page}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      try { root.localStorage.removeItem(draftKey(page)); } catch { /* Server save succeeded. */ }
      state.dirty = false;
      feedback(`第 ${page} 页正确版已保存到云端。`);
      return true;
    } catch (error) {
      feedback(`第 ${page} 页云端保存失败：${error.message}；本机草稿仍在。`, true);
      return false;
    } finally { state.saving = false; $('correctedText').readOnly = false; $('saveCorrected').disabled = !state.dirty; }
  }

  async function goToPage(page) {
    if (!Number.isInteger(page) || page < 1 || page > state.count) return;
    if (page === state.page) return;
    if (!(await saveCorrected())) return;
    await loadPage(page);
  }

  async function importModel(key, file) {
    try {
      if (!bookId || !state.count) throw new Error('请先导入 PDF 项目');
      const pages = parsePageTextFile(await file.text(), state.count);
      feedback(`正在导入 ${MODEL_LABELS[key]} 的 ${state.count} 页…`);
      await requestJson(endpoint(`/model-results/${key}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages }),
      });
      state.pages[key] = pages;
      if (key === 'gemini4') {
        state.pageModels = {};
        for (const model of MODEL_KEYS) renderCandidate(model);
      } else renderCandidate(key);
      updateRecognitionControls();
      feedback(`${MODEL_LABELS[key]} 已保存到云端。`);
      if (key === 'gemini4') root.document.querySelector('.import-controls').open = false;
    } catch (error) { feedback(`${MODEL_LABELS[key]} 导入失败：${error.message}`, true); }
  }

  async function importSource(file) {
    const input = $('sourceImport');
    try {
      if (!/\.pdf$/i.test(file.name)) throw new Error('请选择 PDF 文件');
      input.disabled = true;
      feedback(`正在上传 ${file.name}…`);
      const form = new FormData();
      form.append('file', file, file.name);
      const result = await requestJson('/api/books', { method: 'POST', body: form });
      if (!result.book_id) throw new Error('云端未返回书籍 ID');
      root.location.assign(`./whole-page-proofread.html?book_id=${encodeURIComponent(result.book_id)}&page=1`);
    } catch (error) {
      input.disabled = false;
      feedback(`PDF 导入失败：${error.message}`, true);
    }
  }

  $('previous').addEventListener('click', () => void goToPage(state.page - 1));
  $('next').addEventListener('click', () => void goToPage(state.page + 1));
  $('pageInput').addEventListener('change', () => void goToPage(Number($('pageInput').value)));
  $('saveCorrected').addEventListener('click', () => void saveCorrected());
  $('recognizeGemini').addEventListener('click', () => void recognizeGeminiPage());
  $('recognizeAllPages').addEventListener('click', () => void recognizeBatch('all'));
  $('recognizeRemainingPages').addEventListener('click', () => void recognizeBatch('remaining'));
  $('stopBatchRecognition').addEventListener('click', () => {
    state.batchStop = true;
    feedback('批量识别将在当前页完成后停止。');
  });
  $('copyGemini').addEventListener('click', () => {
    $('correctedText').value = state.pages.gemini4?.[String(state.page)] || '';
    $('correctedText').dispatchEvent(new Event('input'));
  });
  $('correctedText').addEventListener('input', () => {
    state.dirty = true;
    let draftStored = true;
    try { root.localStorage.setItem(draftKey(state.page), $('correctedText').value); }
    catch { draftStored = false; }
    $('saveCorrected').disabled = false;
    feedback(draftStored
      ? `第 ${state.page} 页有未同步修改；点击“保存正确版”或翻页时自动保存。`
      : '本机草稿保存失败；请立即点击“保存正确版”。', !draftStored);
  });
  $('sourceImport').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importSource(file);
  });
  for (const key of MODEL_KEYS) {
    $(`${key}Import`).addEventListener('change', async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await importModel(key, file);
    });
  }
  $('pageScan').addEventListener('error', () => feedback('原图加载失败；请检查协作登录状态后重试。', true));
  $('backToWorkbench').href = bookId
    ? `/tibetan-proofreading-app/?workflow=ocr&book_id=${encodeURIComponent(bookId)}&view=line`
    : '/tibetan-proofreading-app/';
  $('manageProject').href = $('backToWorkbench').href;
  $('collaborationLogout').addEventListener('click', async event => {
    event.preventDefault();
    try {
      await requestJson('/api/collaboration/logout', { method: 'POST' });
      root.location.assign('/tibetan-proofreading-app/');
    } catch (error) { feedback(`退出协作失败：${error.message}`, true); }
  });
  $('zoomOut').addEventListener('click', () => { $('pageScan').style.width = `${Math.max(60, (Number($('pageScan').dataset.zoom) || 100) - 20)}%`; $('pageScan').dataset.zoom = String(Math.max(60, (Number($('pageScan').dataset.zoom) || 100) - 20)); });
  $('zoomIn').addEventListener('click', () => { $('pageScan').style.width = `${Math.min(200, (Number($('pageScan').dataset.zoom) || 100) + 20)}%`; $('pageScan').dataset.zoom = String(Math.min(200, (Number($('pageScan').dataset.zoom) || 100) + 20)); });

  async function start() {
    void loadCollaborationActor();
    if (!bookId) { $('bookName').textContent = '尚未选择 PDF'; feedback('请点击右侧“导入文件”，上传 PDF 创建项目。'); return; }
    try {
      const info = await requestJson(endpoint('/document-info'));
      state.count = Number(info.page_count) || 0;
      if (!state.count) throw new Error('书籍没有可预览的 PDF 页面');
      $('bookName').textContent = info.name || '藏文典籍';
      $('pageIndex').replaceChildren();
      for (let page = 1; page <= state.count; page += 1) {
        const button = root.document.createElement('button');
        button.type = 'button'; button.textContent = String(page); button.dataset.page = String(page);
        button.addEventListener('click', () => void goToPage(page));
        $('pageIndex').appendChild(button);
      }
      const catalog = await requestJson('/api/review-models').catch(() => null);
      const allowed = catalog?.gemini?.models;
      if (Array.isArray(allowed)) {
        for (const option of $('geminiRecognitionModel').options) option.disabled = !allowed.includes(option.value);
        const first = [...$('geminiRecognitionModel').options].find(option => !option.disabled);
        $('recognizeGemini').disabled = !first;
        if (first && $('geminiRecognitionModel').selectedOptions[0]?.disabled) $('geminiRecognitionModel').value = first.value;
      }
      const models = await Promise.all(MODEL_KEYS.map(async key => {
        const result = await requestJson(endpoint(`/model-results/${key}`));
        return [key, result];
      }));
      state.pages = Object.fromEntries(models.map(([key, result]) => [key, result.pages || {}]));
      state.pageModels = models.find(([key]) => key === 'gemini4')?.[1]?.page_models || {};
      updateRecognitionControls();
      await loadPage(Math.min(state.count, state.page));
    } catch (error) { feedback(`整页校对加载失败：${error.message}`, true); }
  }
  void start();
})(typeof window !== 'undefined' ? window : globalThis);
