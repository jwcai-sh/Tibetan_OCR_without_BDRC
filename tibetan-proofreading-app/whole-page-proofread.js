(function (root) {
  'use strict';

  const MODEL_KEYS = ['gemini4', 'teacher', 'yigdzin1', 'openai'];
  const MODEL_LABELS = { gemini4: 'Gemini 4', openai: 'GPT（OpenAI API）', teacher: '教师校正稿', yigdzin1: 'Yigdzin1' };

  function parsePageTextFile(source, pageCount) {
    const text = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const headings = [...text.matchAll(/^[^\n]*?第[ \t]*([0-9０-９]+)[ \t]*页[^\n]*$/gm)];
    if (!headings.length) {
      if (!text.trim()) throw new Error('TXT 没有可导入的文字');
      const fileHeadings = [...text.matchAll(/^【([^【】\n]+\.pdf)】[ \t]*$/gim)];
      if (fileHeadings.length > 1) {
        if (fileHeadings.length !== pageCount || text.slice(0, fileHeadings[0].index).trim()
          || fileHeadings.some(heading => heading[1].toLowerCase() !== fileHeadings[0][1].toLowerCase())) {
          throw new Error(`检测到 ${fileHeadings.length} 个 PDF 段首，与当前 ${pageCount} 页不一致；请核对是否为同一本书`);
        }
        return Object.fromEntries(fileHeadings.map((heading, index) => [
          String(index + 1),
          text.slice(heading.index, fileHeadings[index + 1]?.index ?? text.length).trim(),
        ]));
      }
      if (pageCount === 1) return { '1': text.trim() };
      const paragraphs = text.trim().split(/\n[ \t]*\n+/).map(paragraph => paragraph.trim());
      if (paragraphs.length !== pageCount) {
        throw new Error(`未找到“第…页”页标；自然分段有 ${paragraphs.length} 段，当前 PDF 有 ${pageCount} 页，请核对分段`);
      }
      return Object.fromEntries(paragraphs.map((paragraph, index) => [String(index + 1), paragraph]));
    }
    const pages = {};
    headings.forEach((heading, index) => {
      const page = Number(heading[1].replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 65296)));
      if (page < 1 || page > pageCount) throw new Error(`第 ${page} 页不在当前文档的 1–${pageCount} 页范围内`);
      if (Object.hasOwn(pages, String(page))) throw new Error(`第 ${page} 页重复`);
      pages[String(page)] = text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length).trim();
    });
    return pages;
  }

  function buildCorrectedExport(results, pageCount) {
    const pages = new Map(results.map(result => [Number(result.page_num), result]));
    const missing = Array.from({ length: pageCount }, (_, index) => index + 1)
      .filter(page => !pages.get(page)?.saved);
    if (missing.length) throw new Error(`第 ${missing.join('、')} 页尚未保存正确版；请先保存后导出。`);
    return Array.from({ length: pageCount }, (_, index) => {
      const page = index + 1;
      return `第 ${page} 页\n${String(pages.get(page).text || '').replace(/\r\n?/g, '\n')}`;
    }).join('\n\n') + '\n';
  }

  function parseExportPages(input, pageCount, currentPage) {
    const pages = new Set();
    for (const item of (String(input || '').trim() || String(currentPage)).split(/[,，、]/)) {
      const match = item.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
      if (!match) throw new Error('页码格式应为 1,3-5');
      const first = Number(match[1]);
      const last = Number(match[2] || match[1]);
      if (first < 1 || last > pageCount || first > last) throw new Error(`页码须在 1–${pageCount} 页范围内，且起始页不大于结束页`);
      for (let page = first; page <= last; page += 1) pages.add(page);
    }
    return [...pages].sort((a, b) => a - b);
  }

  function buildGeminiExport(pages, selectedPages) {
    const missing = selectedPages.filter(page => !String(pages?.[String(page)] || '').trim());
    if (missing.length) throw new Error(`第 ${missing.join('、')} 页没有 Gemini 4 识别结果`);
    return selectedPages.map(page => `第 ${page} 页\n${String(pages[String(page)]).replace(/\r\n?/g, '\n').trim()}`).join('\n\n') + '\n';
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

  function candidateSegments(pages, baselineKey, key, page) {
    const candidate = pages?.[key]?.[String(page)] || '';
    if (!candidate) return [];
    const reference = pages?.[baselineKey]?.[String(page)] || '';
    if (key === baselineKey || !String(reference).trim()) return [{ type: 'plain', text: candidate }];
    return diffSegments(reference, candidate);
  }

  function hasAnyModelText(pages, key) {
    return Object.values(pages?.[key] || {}).some(value => String(value || '').trim());
  }

  function normalizeModelOrder(order) {
    const known = Array.isArray(order) ? order.filter((key, index) => MODEL_KEYS.includes(key) && order.indexOf(key) === index) : [];
    return [...known, ...MODEL_KEYS.filter(key => !known.includes(key))];
  }

  function pagesForRecognition(count, pages, mode) {
    return Array.from({ length: count }, (_, index) => index + 1)
      .filter(page => mode !== 'remaining' || !String(pages?.[String(page)] || '').trim());
  }

  async function recognizeWithRetries(pages, recognize, options = {}) {
    const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const shouldStop = options.shouldStop || (() => false);
    const onAttempt = options.onAttempt || (() => {});
    let pending = [...pages];
    let completed = 0;
    const errors = new Map();
    for (let round = 1; round <= 3 && pending.length && !shouldStop(); round += 1) {
      if (round > 1) await wait(round === 2 ? 3000 : 6000);
      const failed = [];
      for (const page of pending) {
        if (shouldStop()) break;
        onAttempt(page, round, completed, pages.length);
        try { await recognize(page); completed += 1; errors.delete(page); }
        catch (error) { failed.push(page); errors.set(page, error); }
      }
      pending = failed;
    }
    return { completed, failed: pending, errors, stopped: shouldStop() };
  }

  function normalizeRotation(degrees) {
    return ((Number(degrees) || 0) % 360 + 360) % 360;
  }

  function defaultPreviewRotation(bookId, sourceName, pageCount, page) {
    return 0;
  }

  function effectivePreviewRotation(bookId, sourceName, pageCount, page, documentRotation, pageRotation) {
    return normalizeRotation(defaultPreviewRotation(bookId, sourceName, pageCount, page) + documentRotation + pageRotation);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { diffSegments, candidateSegments, hasAnyModelText, normalizeModelOrder, parsePageTextFile, buildCorrectedExport, parseExportPages, buildGeminiExport, pagesForRecognition, recognizeWithRetries, normalizeRotation, defaultPreviewRotation, effectivePreviewRotation };
  if (!root.document) return;

  const $ = id => root.document.getElementById(id);
  const params = new URLSearchParams(root.location.search);
  const bookId = params.get('book_id') || '';
  $('topImportControls').hidden = Boolean(bookId);
  const state = { page: Math.max(1, Number(params.get('page')) || 1), count: 0, sourceName: '', documentRotation: 0, pageRotations: {}, pages: {}, pageModels: {}, openaiPageModels: {}, openaiModel: '', openaiConfigured: false, baselineKey: 'gemini4', dirty: false, saving: false, exporting: false, recognizing: false, batchRecognizing: false, batchProvider: '', batchStop: false, pageRequest: 0 };
  const endpoint = path => `/api/books/${encodeURIComponent(bookId)}${path}`;
  const draftKey = page => `whole-page-proofread-draft:${bookId}:${page}`;
  const rotationKey = scope => {
    const oldInvertedBook = bookId === 'a3a76874e921481e9d1bd53626f40e99'
      || (state.sourceName.trim().split(/[\\/]/).pop().toLowerCase() === '1.pdf' && state.count === 24);
    return `whole-page-preview-rotation-${oldInvertedBook ? 'v3' : 'v2'}:${bookId}:${scope}`;
  };
  const modelOrderKey = `whole-page-model-order:${bookId}`;
  const baselineKey = `whole-page-baseline:${bookId}`;

  function storedRotation(scope) {
    try {
      const value = Number(root.localStorage.getItem(rotationKey(scope)));
      return [0, 90, 180, 270].includes(value) ? value : 0;
    } catch { return 0; }
  }

  function restoreModelPreferences() {
    let order = null;
    try {
      order = JSON.parse(root.localStorage.getItem(modelOrderKey));
      const savedBaseline = root.localStorage.getItem(baselineKey);
      if (MODEL_KEYS.includes(savedBaseline) && !$(`${savedBaseline}Panel`).hidden) state.baselineKey = savedBaseline;
    } catch { /* Default order and Gemini baseline remain usable. */ }
    for (const key of normalizeModelOrder(order)) $('modelCards').appendChild($(`${key}Panel`));
  }

  function saveModelOrder() {
    const order = [...$('modelCards').children].map(panel => panel.dataset.model);
    try { root.localStorage.setItem(modelOrderKey, JSON.stringify(order)); }
    catch { /* Reordering still works for this session. */ }
  }

  function pageRotation(page) {
    if (!Object.prototype.hasOwnProperty.call(state.pageRotations, page)) state.pageRotations[page] = storedRotation(`page:${page}`);
    return state.pageRotations[page];
  }

  function renderPagePreview() {
    const rotation = effectivePreviewRotation(bookId, state.sourceName, state.count, state.page, state.documentRotation, pageRotation(state.page));
    const source = endpoint(`/pages/${state.page}/preview?dpi=200&format=jpeg&landscape=true&rotation=0`);
    const scan = $('pageScan');
    if (scan.dataset.source !== source) {
      scan.dataset.source = source;
      scan.dataset.ready = '';
      $('pageScanFrame').style.height = '';
      scan.src = source;
    }
    layoutPagePreview(rotation);
    $('pageScan').alt = `原始 PDF 第 ${state.page} 页，预览旋转 ${rotation} 度`;
    $('previewRotationStatus').textContent = `本页 ${rotation}° · 整本补充旋转 ${state.documentRotation}°`;
  }

  function layoutPagePreview(rotation = effectivePreviewRotation(bookId, state.sourceName, state.count, state.page, state.documentRotation, pageRotation(state.page))) {
    const scan = $('pageScan');
    if (!scan.dataset.ready || !scan.naturalWidth || !scan.naturalHeight) return;
    const viewportWidth = scan.parentElement.parentElement.clientWidth;
    if (!viewportWidth) return;
    const zoom = (Number(scan.dataset.zoom) || 100) / 100;
    const imageHeight = viewportWidth * scan.naturalHeight / scan.naturalWidth;
    const quarterTurn = rotation % 180 !== 0;
    const scale = zoom * (quarterTurn ? Math.min(1, viewportWidth / imageHeight) : 1);
    const visualWidth = (quarterTurn ? imageHeight : viewportWidth) * scale;
    const visualHeight = (quarterTurn ? viewportWidth : imageHeight) * scale;
    const frame = $('pageScanFrame');
    frame.style.width = `${Math.max(viewportWidth, visualWidth)}px`;
    frame.style.height = `${visualHeight}px`;
    scan.style.width = `${viewportWidth}px`;
    scan.style.transform = `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`;
  }

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

  function modelLabel(key) {
    if (key === 'gemini4') return geminiLabel();
    if (key === 'openai') return `GPT（${String(state.openaiPageModels[String(state.page)] || state.openaiModel || 'OpenAI API').replace(/^openai:/, '')}）`;
    return MODEL_LABELS[key];
  }

  function renderBaselineInfo() {
    const label = modelLabel(state.baselineKey);
    const hasReference = Boolean(String(state.pages[state.baselineKey]?.[String(state.page)] || '').trim());
    $('baselineDescription').textContent = hasReference
      ? `全书差异基准：${label}。切换页码时保持。`
      : `全书差异基准：${label}。该模型本页无识别文本，暂不标差异。`;
    $('diffHint').textContent = hasReference
      ? `黄色表示候选比 ${label} 多识或写法不同；橙色短线表示候选漏识。`
      : '基准模型本页无识别文本，因此不标记差异。';
  }

  function renderCandidate(key) {
    const panel = $(`${key}Panel`);
    const container = $(`${key}Text`);
    container.replaceChildren();
    panel.querySelector('.model-label').textContent = modelLabel(key);
    panel.classList.toggle('is-baseline', key === state.baselineKey);
    const baselineButton = panel.querySelector('.set-baseline');
    baselineButton.setAttribute('aria-pressed', String(key === state.baselineKey));
    baselineButton.textContent = key === state.baselineKey ? '当前全书基准' : '设为全书基准';
    const text = state.pages[key]?.[String(state.page)] || '';
    panel.querySelector('.fill-corrected').disabled = !text;
    baselineButton.disabled = !hasAnyModelText(state.pages, key);
    if (!text) {
      container.textContent = key === 'yigdzin1' ? '本页无藏文识别结果。' : '本页尚无识别结果。';
      container.classList.add('missing');
      return;
    }
    container.classList.remove('missing');
    for (const piece of candidateSegments(state.pages, state.baselineKey, key, state.page)) {
      if (piece.type === 'plain') container.appendChild(root.document.createTextNode(piece.text));
      else {
        const mark = root.document.createElement(piece.type === 'diff' ? 'mark' : 'span');
        mark.className = piece.type === 'diff' ? 'different' : 'omission';
        if (piece.type === 'omission') {
          mark.title = `${modelLabel(state.baselineKey)} 有字，此结果漏识`;
          mark.setAttribute('aria-label', mark.title);
        } else mark.textContent = piece.text;
        container.appendChild(mark);
      }
    }
  }

  function renderAllCandidates() {
    for (const key of MODEL_KEYS) renderCandidate(key);
    renderBaselineInfo();
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
    $('openaiRecognitionFeedback').textContent = state.openaiConfigured ? '' : '服务端尚未配置 OpenAI API key 和模型；请在 Zeabur 服务环境变量中设置 OPENAI_API_KEY、OPENAI_REVIEW_MODEL。';
    const pageModel = String(state.pageModels[String(page)] || '').replace(/^gemini:/, '');
    if (pageModel && [...$('geminiRecognitionModel').options].some(option => option.value === pageModel && !option.disabled)) $('geminiRecognitionModel').value = pageModel;
    renderNavigation();
    renderAllCandidates();
    renderPagePreview();
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
    $('stopBatchRecognition').hidden = !state.batchRecognizing || state.batchProvider !== 'gemini';
    const openaiAvailable = Boolean(bookId && state.count && state.openaiConfigured);
    $('recognizeOpenAI').disabled = !openaiAvailable || busy;
    $('recognizeOpenAIAllPages').disabled = !openaiAvailable || busy;
    $('recognizeOpenAIRemainingPages').disabled = !openaiAvailable || busy || !pagesForRecognition(state.count, state.pages.openai, 'remaining').length;
    $('stopOpenAIBatchRecognition').hidden = !state.batchRecognizing || state.batchProvider !== 'openai';
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
      if (state.page === page) renderAllCandidates();
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
    state.batchProvider = 'gemini';
    state.batchStop = false;
    updateRecognitionControls();
    $('geminiRecognitionFeedback').textContent = '';
    const { completed, failed, errors, stopped } = await recognizeWithRetries(pages,
      page => recognizeGeminiResult(page, model), {
        shouldStop: () => state.batchStop,
        onAttempt: (page, round, done, total) => feedback(`批量识别 ${done + 1}/${total}：第 ${page} 页（${model}，第 ${round}/3 次）…`),
      });
    for (const page of failed) console.error(`第 ${page} 页识别失败`, errors.get(page));
    state.batchRecognizing = false;
    state.batchProvider = '';
    state.batchStop = false;
    updateRecognitionControls();
    const summary = `批量识别${stopped ? '已停止' : '已结束'}：成功 ${completed}/${pages.length} 页${failed.length ? `；重试后仍失败：第 ${failed.join('、')} 页` : ''}。已保存的正确版未修改。`;
    $('geminiRecognitionFeedback').textContent = failed.length ? summary : '';
    feedback(summary, Boolean(failed.length));
  }

  async function recognizeOpenAIResult(page) {
    const job = await requestJson(endpoint('/openai-recognition-jobs'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_num: page }),
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
    if (result.model !== `openai:${state.openaiModel}` || !result.text?.trim()) throw new Error('模型身份或识别文本无效，原结果保留');
    const saved = await requestJson(endpoint(`/model-results/openai/pages/${page}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: result.text, model: result.model }),
    });
    state.pages.openai[String(page)] = saved.text;
    state.openaiPageModels[String(page)] = saved.model;
    if (state.page === page) {
      if (state.baselineKey === 'openai') renderAllCandidates();
      else renderCandidate('openai');
    }
    updateRecognitionControls();
    return saved;
  }

  async function recognizeOpenAIPage() {
    if (!state.openaiConfigured || !state.count || state.recognizing || state.batchRecognizing) return;
    const page = state.page;
    state.recognizing = true;
    updateRecognitionControls();
    $('openaiRecognitionFeedback').textContent = '';
    feedback(`第 ${page} 页正在用 GPT（${state.openaiModel}）识别…`);
    try {
      await recognizeOpenAIResult(page);
      feedback(`第 ${page} 页 GPT 识别结果已保存到云端；人工正确版仍需单独保存。`);
    } catch (error) {
      const message = `第 ${page} 页 GPT 识别失败：${error.message}；原结果保留。`;
      $('openaiRecognitionFeedback').textContent = message;
      feedback(message, true);
    } finally {
      state.recognizing = false;
      updateRecognitionControls();
    }
  }

  async function recognizeOpenAIBatch(mode) {
    if (!state.openaiConfigured || !state.count || state.recognizing || state.batchRecognizing) return;
    const pages = pagesForRecognition(state.count, state.pages.openai, mode);
    if (!pages.length) { feedback('所有页面已有 GPT 识别结果。'); return; }
    state.batchRecognizing = true;
    state.batchProvider = 'openai';
    state.batchStop = false;
    updateRecognitionControls();
    $('openaiRecognitionFeedback').textContent = '';
    const { completed, failed, errors, stopped } = await recognizeWithRetries(pages,
      page => recognizeOpenAIResult(page), {
        shouldStop: () => state.batchStop,
        onAttempt: (page, round, done, total) => feedback(`GPT 批量识别 ${done + 1}/${total}：第 ${page} 页（第 ${round}/3 次）…`),
      });
    for (const page of failed) console.error(`第 ${page} 页 GPT 识别失败`, errors.get(page));
    state.batchRecognizing = false;
    state.batchProvider = '';
    state.batchStop = false;
    updateRecognitionControls();
    const summary = `GPT 批量识别${stopped ? '已停止' : '已结束'}：成功 ${completed}/${pages.length} 页${failed.length ? `；重试后仍失败：第 ${failed.join('、')} 页` : ''}。人工正确版未修改。`;
    $('openaiRecognitionFeedback').textContent = failed.length ? summary : '';
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

  async function exportCorrected() {
    if (state.exporting || state.saving) return;
    if (!bookId || !state.count) { feedback('请先打开一个 PDF 项目。', true); return; }
    state.exporting = true;
    $('exportCorrected').disabled = true;
    try {
      if (!(await saveCorrected())) return;
      const results = [];
      for (let first = 1; first <= state.count; first += 4) {
        feedback(`正在读取正确版：第 ${first}–${Math.min(first + 3, state.count)} 页 / 共 ${state.count} 页…`);
        const batch = await Promise.all(Array.from({ length: Math.min(4, state.count - first + 1) }, (_, index) =>
          requestJson(endpoint(`/whole-page-proofread/${first + index}`))));
        results.push(...batch);
      }
      const content = buildCorrectedExport(results, state.count);
      const baseName = String(state.sourceName || '藏文文档').split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || '藏文文档';
      const url = root.URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' }));
      const link = root.document.createElement('a');
      link.href = url;
      link.download = `${baseName}_人工校对正确版.txt`;
      root.document.body.appendChild(link);
      link.click();
      link.remove();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 2000);
      feedback(`已下载 ${state.count} 页正确版 TXT：${link.download}`);
    } catch (error) { feedback(`正确版导出失败：${error.message}`, true); }
    finally { state.exporting = false; $('exportCorrected').disabled = !state.count; }
  }

  function exportGemini(wholeBook = false) {
    const notice = $('geminiRecognitionFeedback');
    try {
      if (!state.count) throw new Error('请先打开 PDF 项目');
      const selected = wholeBook
        ? Array.from({ length: state.count }, (_, index) => index + 1)
        : parseExportPages($('geminiExportPages').value, state.count, state.page);
      const content = buildGeminiExport(state.pages.gemini4, selected);
      const baseName = String(state.sourceName || '藏文文档').split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || '藏文文档';
      const url = root.URL.createObjectURL(new Blob(['\uFEFF', content], { type: 'text/plain;charset=utf-8' }));
      const link = root.document.createElement('a');
      link.href = url;
      link.download = wholeBook ? `${baseName}_整书Gemini4识别版.txt` : `${baseName}_Gemini4_第${selected.join('-')}页.txt`;
      root.document.body.appendChild(link);
      link.click();
      link.remove();
      root.setTimeout(() => root.URL.revokeObjectURL(url), 2000);
      notice.textContent = '';
      feedback(wholeBook ? `已导出整书 Gemini 4 识别结果，共 ${state.count} 页。` : `已导出 Gemini 4 第 ${selected.join('、')} 页识别结果。`);
    } catch (error) {
      if (wholeBook) feedback(`整书 Gemini 4 导出失败：${error.message}`, true);
      else notice.textContent = `Gemini 4 导出失败：${error.message}`;
    }
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
      const sourceText = await file.text();
      const hasPageHeadings = /^[^\n]*?第[ \t]*[0-9０-９]+[ \t]*页[^\n]*$/m.test(sourceText);
      const pages = parsePageTextFile(sourceText, state.count);
      if (!hasPageHeadings && !root.confirm(`此 TXT 没有“第…页”页标，已按 ${Object.keys(pages).length} 个自然分段依次对应当前 PDF 的第 1–${state.count} 页。请确认是同一本书；继续将覆盖这些页现有的 ${MODEL_LABELS[key]} 内容。`)) {
        feedback(`${MODEL_LABELS[key]} 导入已取消。`);
        return;
      }
      feedback(`正在导入 ${MODEL_LABELS[key]} 的 ${Object.keys(pages).length} 页…`);
      await requestJson(endpoint(`/model-results/${key}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages }),
      });
      state.pages[key] = { ...(state.pages[key] || {}), ...pages };
      if (key === 'gemini4') {
        state.pageModels = {};
      }
      if (key === state.baselineKey) renderAllCandidates();
      else renderCandidate(key);
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

  function setupModelCards() {
    const cards = $('modelCards');
    let dragging = null;
    const clearDropMarkers = () => {
      for (const panel of cards.children) panel.classList.remove('drop-before', 'drop-after', 'dragging');
    };
    restoreModelPreferences();
    cards.addEventListener('click', event => {
      const button = event.target.closest('button');
      const panel = button?.closest('.model-panel');
      if (!panel) return;
      const key = panel.dataset.model;
      const text = state.pages[key]?.[String(state.page)] || '';
      if (button.classList.contains('fill-corrected') && text) {
        $('correctedText').value = text;
        $('correctedText').dispatchEvent(new Event('input'));
      } else if (button.classList.contains('set-baseline') && hasAnyModelText(state.pages, key) && key !== state.baselineKey) {
        state.baselineKey = key;
        try { root.localStorage.setItem(baselineKey, key); } catch { /* Session selection still works. */ }
        renderAllCandidates();
        feedback(`已将 ${modelLabel(key)} 设为本书所有页的差异基准；正确版内容未修改。`);
      }
    });
    cards.addEventListener('dragstart', event => {
      const handle = event.target.closest('.model-drag-handle');
      if (!handle) { event.preventDefault(); return; }
      dragging = handle.closest('.model-panel');
      dragging.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragging.dataset.model);
    });
    cards.addEventListener('dragover', event => {
      if (!dragging) return;
      const target = event.target.closest('.model-panel');
      if (!target || target === dragging || target.hidden) return;
      event.preventDefault();
      for (const panel of cards.children) panel.classList.remove('drop-before', 'drop-after');
      const before = event.clientY < target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
      target.classList.add(before ? 'drop-before' : 'drop-after');
    });
    cards.addEventListener('drop', event => {
      if (!dragging) return;
      const target = event.target.closest('.model-panel');
      if (target && target !== dragging && !target.hidden) {
        event.preventDefault();
        const before = target.classList.contains('drop-before');
        cards.insertBefore(dragging, before ? target : target.nextSibling);
        saveModelOrder();
      }
      clearDropMarkers();
      dragging = null;
    });
    cards.addEventListener('dragend', () => { clearDropMarkers(); dragging = null; });
    cards.addEventListener('keydown', event => {
      if (!event.target.classList.contains('model-drag-handle') || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const panel = event.target.closest('.model-panel');
      const visible = [...cards.children].filter(item => !item.hidden);
      const index = visible.indexOf(panel);
      const target = visible[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (!target) return;
      cards.insertBefore(panel, event.key === 'ArrowUp' ? target : target.nextSibling);
      saveModelOrder();
      event.target.focus();
    });
  }

  $('previous').addEventListener('click', () => void goToPage(state.page - 1));
  $('next').addEventListener('click', () => void goToPage(state.page + 1));
  $('pageInput').addEventListener('change', () => void goToPage(Number($('pageInput').value)));
  $('saveCorrected').addEventListener('click', () => void saveCorrected());
  $('exportCorrected').addEventListener('click', () => void exportCorrected());
  $('exportGemini').addEventListener('click', () => exportGemini());
  $('exportGeminiBook').addEventListener('click', () => exportGemini(true));
  $('recognizeGemini').addEventListener('click', () => void recognizeGeminiPage());
  $('recognizeOpenAI').addEventListener('click', () => void recognizeOpenAIPage());
  $('recognizeOpenAIAllPages').addEventListener('click', () => void recognizeOpenAIBatch('all'));
  $('recognizeOpenAIRemainingPages').addEventListener('click', () => void recognizeOpenAIBatch('remaining'));
  $('stopOpenAIBatchRecognition').addEventListener('click', () => {
    state.batchStop = true;
    feedback('批量识别将在当前页完成后停止。');
  });
  $('recognizeAllPages').addEventListener('click', () => void recognizeBatch('all'));
  $('recognizeRemainingPages').addEventListener('click', () => void recognizeBatch('remaining'));
  $('stopBatchRecognition').addEventListener('click', () => {
    state.batchStop = true;
    feedback('批量识别将在当前页完成后停止。');
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
  for (const key of MODEL_KEYS.filter(key => key !== 'openai')) {
    $(`${key}Import`).addEventListener('change', async event => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await importModel(key, file);
    });
  }
  $('pageScan').addEventListener('load', () => { $('pageScan').dataset.ready = 'yes'; layoutPagePreview(); });
  $('pageScan').addEventListener('error', () => feedback('原图加载失败；请检查协作登录状态后重试。', true));
  $('backToWorkbench').href = bookId
    ? `/tibetan-proofreading-app/?workflow=ocr&book_id=${encodeURIComponent(bookId)}&view=line`
    : '/tibetan-proofreading-app/';
  $('collaborationLogout').addEventListener('click', async event => {
    event.preventDefault();
    try {
      await requestJson('/api/collaboration/logout', { method: 'POST' });
      root.location.assign('/tibetan-proofreading-app/');
    } catch (error) { feedback(`退出协作失败：${error.message}`, true); }
  });
  $('zoomOut').addEventListener('click', () => { $('pageScan').dataset.zoom = String(Math.max(60, (Number($('pageScan').dataset.zoom) || 100) - 20)); layoutPagePreview(); });
  $('zoomIn').addEventListener('click', () => { $('pageScan').dataset.zoom = String(Math.min(200, (Number($('pageScan').dataset.zoom) || 100) + 20)); layoutPagePreview(); });
  root.addEventListener('resize', () => layoutPagePreview());
  for (const [scope, buttonId] of [['page', 'rotatePage'], ['document', 'rotateDocument']]) {
    const button = $(buttonId);
    button.addEventListener('click', () => {
      if (scope === 'document') {
        state.documentRotation = normalizeRotation(state.documentRotation + 90);
        try { root.localStorage.setItem(rotationKey('document'), String(state.documentRotation)); } catch { /* Session setting still works. */ }
      } else {
        state.pageRotations[state.page] = normalizeRotation(pageRotation(state.page) + 90);
        try { root.localStorage.setItem(rotationKey(`page:${state.page}`), String(state.pageRotations[state.page])); } catch { /* Session setting still works. */ }
      }
      renderPagePreview();
    });
  }

  async function start() {
    void loadCollaborationActor();
    if (!bookId) { $('bookName').textContent = '尚未选择 PDF'; feedback('请点击右侧“导入文件”，上传 PDF 创建项目。'); return; }
    try {
      const info = await requestJson(endpoint('/document-info'));
      state.count = Number(info.page_count) || 0;
      if (!state.count) throw new Error('书籍没有可预览的 PDF 页面');
      $('exportCorrected').disabled = false;
      state.sourceName = info.name || '';
      state.documentRotation = storedRotation('document');
      $('bookName').textContent = info.name || '藏文典籍';
      $('pageIndex').replaceChildren();
      for (let page = 1; page <= state.count; page += 1) {
        const button = root.document.createElement('button');
        button.type = 'button'; button.textContent = String(page); button.dataset.page = String(page);
        button.addEventListener('click', () => void goToPage(page));
        $('pageIndex').appendChild(button);
      }
      const catalog = await requestJson('/api/review-models').catch(() => null);
      state.openaiModel = String(catalog?.openai?.model || '');
      state.openaiConfigured = Boolean(catalog?.openai?.configured && state.openaiModel);
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
      $('exportGeminiBook').disabled = false;
      state.pageModels = models.find(([key]) => key === 'gemini4')?.[1]?.page_models || {};
      state.openaiPageModels = models.find(([key]) => key === 'openai')?.[1]?.page_models || {};
      updateRecognitionControls();
      await loadPage(Math.min(state.count, state.page));
    } catch (error) { feedback(`整页校对加载失败：${error.message}`, true); }
  }
  setupModelCards();
  void start();
})(typeof window !== 'undefined' ? window : globalThis);
