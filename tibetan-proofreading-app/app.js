const SAMPLE_PDF_URL = "../藏文/天文历算学-本科教材 藏文40301698_部分.pdf";
const PDF_WORKER_URL = "./vendor/pdf.worker.min.js";
const APP_BUILD_ID = "20261026-cloud-state-load-v27";
let pageReviewPending = false;
const REVIEW_MODEL_DEFAULTS = { qwen: ["qwen3.8-max"], gemini: ["gemini-3.8-flash", "gemini-3.1-flash-lite"] };
let geminiRowModels = [...REVIEW_MODEL_DEFAULTS.gemini];
let geminiRowModelTitle = "";
const reviewCatalogRequests = new Map();
const pendingGeminiRowModels = new Map();
const SOURCE_LAYOUT_VERSION = 4;
window.__TIBETAN_PROOFREADING_APP_BUILD_ID__ = APP_BUILD_ID;
const CACHE_PREFIX = "tibetan-proofreading-app:v1:";
const ACTIVE_PROJECT_KEY = "tibetan-proofreading-app:active-project";
const CLOUD_LIBRARY_SESSION_KEY = "tibetan-proofreading-app:cloud-library-token";
const LOCAL_CLOUD_LIBRARY_SESSION_KEY = "tibetan-proofreading-app:zeabur-library-session";
const SOURCE_DB_NAME = "tibetan-proofreading-app-sources";
const SOURCE_STORE_NAME = "files";
const FOLDER_PROJECTS_KEY = "tibetan-proofreading-app:folder-projects:v1";
const HOME_PROJECT_FILTERS = new Set(["all", "ocr", "translation"]);
const OCR_FONT_SIZE_KEY = "tibetan-proofreading-app:ocr-font-size";
const SOURCE_PREVIEW_SCALE_KEY = "tibetan-proofreading-app:source-preview-scale";
const SOURCE_PAGE_ZOOM_MIN = 0.75;
const SOURCE_PAGE_ZOOM_MAX = 4;
const SOURCE_PAGE_ZOOM_STEP = 0.25;
const LEGACY_WORKSPACE_LAYOUT_KEYS = [
  "tibetan-proofreading-app:workspace-layout",
  "tibetan-proofreading-app:workspace-layout:v2",
  "tibetan-proofreading-app:workspace-layout:v3",
];
const WORKSPACE_LAYOUT_KEY = "tibetan-proofreading-app:workspace-layout:v4";
const TRANSLATION_ROLES_KEY = "tibetan-proofreading-app:translation-roles";
const ACTIVE_TRANSLATION_ROLE_KEY = "tibetan-proofreading-app:active-translation-role";
const TRANSLATION_MODEL_OVERRIDES_KEY = "tibetan-proofreading-app:translation-model-overrides";
const OCR_FONT_SIZE_MIN = 16;
const OCR_FONT_SIZE_MAX = 36;
const OCR_FONT_SIZE_STEP = 2;
const CANONICAL_REGION_ORDER = Object.freeze(["left", "center", "right"]);
const CANONICAL_REGION_DEFAULTS = Object.freeze({
  left: {
    label: "左侧",
    role: "side",
    direction: "vertical",
    textOrientation: "vertical-or-page-number",
    regionType: "margin",
  },
  center: {
    label: "中间",
    role: "body",
    direction: "horizontal",
    textOrientation: "horizontal",
    regionType: "body",
  },
  right: {
    label: "右侧",
    role: "side",
    direction: "vertical",
    textOrientation: "vertical-or-page-number",
    regionType: "margin",
  },
});
const OCR_PROFILES = Object.freeze({
  handwritten: {
    label: "手写体",
    model: "Ume_Petsuk",
    lineMode: "line",
    prompt: "这是藏文手写体资料。优先适应手写笔画、连写和不规则字距；无法确认的字符不要凭语义补写。",
  },
  traditional: {
    label: "传统经书印刷版式",
    model: "Woodblock-Stacks",
    lineMode: "line",
    prompt: "这是传统藏文经书/木刻印刷版式。只识别中间栏正文，忽略左右边栏、边框和页码。优先保留堆叠字、上加字、下加字、朱色标记和经书行序。",
  },
  modern: {
    label: "现代印刷版式",
    model: "Modern",
    lineMode: "line",
    prompt: "这是现代藏文印刷版式。优先识别清晰的标准印刷字形，同时严格保留藏文音节和标点，不要按语义改写。",
  },
});
const DEFAULT_OCR_PROFILE = "traditional";
const SOURCE_PREVIEW_SCALE_MIN = 1;
const SOURCE_PREVIEW_SCALE_MAX = 1.75;
const SOURCE_PREVIEW_SCALE_STEP = 0.15;
const TIBETAN_HIGH_RISK_MARK_RE = /[\u0F71-\u0F84\u0F90-\u0FBC]/;
const TIBETAN_CLUSTER_RE = /[\u0F40-\u0F6C][\u0F71-\u0F84\u0F90-\u0FBC]*/g;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DIRECT_TEXT_SOURCES = new Set(["pdf-text", "word-text", "markdown", "text-file"]);
const QUIET_STATUS_RE =
  /^(已载入|已识别源文档属性|已切换到|已取消|已新建|已删除|已保存|已重置|已清空|已导出|当前页.*已复制|第\s*\d+\s*页已从 PDF 文本层直接提取|第\s*\d+\s*页藏译汉完成)/;
const EMPTY_STATE_HTML = `
  <i data-lucide="file-search"></i>
  <p>上传藏文 PDF 后，这里显示当前单页原文。</p>
`;
const DEFAULT_LAYOUT = {
  viewer: 1.18,
  proofreadViewer: 1.18,
  ocr: 0.92,
  ai: 0.92,
  translation: 0.86,
  translationCollapsed: true,
  collapsed: {
    viewer: false,
    ocr: false,
    ai: false,
  },
};
const DEFAULT_TRANSLATION_MODEL = "gemini:gemini-2.5-flash";
const BUILT_IN_TRANSLATION_ROLES = [
  {
    id: "academic-literal",
    name: "学术直译",
    sourceLang: "bo",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: "你是严谨的佛学与藏文典籍翻译助手。请忠实翻译原文，保持术语稳定，少发挥；不添加原文没有的信息。",
    userPromptTemplate: "请将以下{source_lang}文本翻译为{target_lang}。要求忠实、术语一致、适合学术校对，只输出译文。\n\n来源：{source_name}\n页码：{page}\n\n原文：\n{source_text}",
    temperature: 0.2,
    maxTokens: 2048,
    builtIn: true,
  },
  {
    id: "fluent-english",
    name: "通顺英译",
    sourceLang: "zh",
    targetLang: "en",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: "You are a careful Chinese-to-English translator. Preserve meaning and terminology while producing fluent academic English.",
    userPromptTemplate: "Translate the following {source_lang} text into {target_lang}. Keep the meaning faithful, smooth the prose where appropriate, and output only the translation.\n\nSource: {source_name}\nPage: {page}\n\nText:\n{source_text}",
    temperature: 0.3,
    maxTokens: 2048,
    builtIn: true,
  },
  {
    id: "dzongsar-reference-en-zh",
    name: "宗萨参考英译中",
    sourceLang: "en",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: [
      "你是佛学、文学与公共开示文本的英译中助手。",
      "译文应参考当代佛学开示中文译本常见的清澈、直接、自然、有一点口语感的表达。",
      "保留原文的思辨锋芒、幽默和反讽，但不要添加原文没有的判断。",
      "术语要稳定，优先使用通行佛学中文译名；遇到可疑术语可保留英文括注。",
      "不要声称模仿任何具体作者本人，只输出译文。",
    ].join(""),
    userPromptTemplate: "请将以下英文文本翻译为中文。要求：忠实、通顺、不过度文言，保留开示语气中的直接、轻松与反讽；只输出译文。\n\n来源：{source_name}\n页码：{page}\n\n英文原文：\n{source_text}",
    temperature: 0.28,
    maxTokens: 3072,
    builtIn: true,
  },
  {
    id: "term-analysis",
    name: "术语拆解",
    sourceLang: "bo",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: "你是藏文术语解析助手。请偏重逐词解释、术语对应和疑难点说明，避免过度润色。",
    userPromptTemplate: "请解析并翻译以下{source_lang}文本为{target_lang}。输出包括：1. 直译；2. 关键术语；3. 疑难处说明。\n\n来源：{source_name}\n页码：{page}\n\n原文：\n{source_text}",
    temperature: 0.1,
    maxTokens: 3072,
    builtIn: true,
  },
];

const els = {};
let proofreadFloatingMarkButton = null;
let lastProofreadSelectionPoint = null;
const state = {
  pdfDoc: null,
  remoteServerPdf: false,
  remoteFirstPageDeadline: 0,
  remotePreviewError: "",
  remoteRestoreComplete: false,
  remoteStateLoadError: "",
  pdfUrl: "",
  pdfFile: null,
  pdfPageRenderUrl: "",
  pdfPageRenderCache: new Map(),
  imageUrl: "",
  imageBlob: null,
  markdownText: "",
  documentText: "",
  sourceName: "",
  sourceSize: 0,
  sourceMime: "",
  cacheKey: "",
  sourceType: "",
  pageNum: 1,
  pageCount: 0,
  ocrResults: new Map(),
  ocrProfile: DEFAULT_OCR_PROFILE,
  translationResults: new Map(),
  ocrQualityReviews: [],
  ocrView: "lines",
  ocrFontSize: 22,
  sourcePreviewScale: 1,
  sourcePageZoom: 1.25,
  activeOcrLine: -1,
  renderToken: 0,
  thumbnailToken: 0,
  layout: { ...DEFAULT_LAYOUT },
  translationRoles: [...BUILT_IN_TRANSLATION_ROLES],
  activeTranslationRoleId: "academic-literal",
  editingRoleId: "academic-literal",
  activeWorkflow: "home",
  homeProjectFilter: "all",
  pendingHomeProjectDeletionId: "",
  folderProjectFiles: new Map(),
  pendingFolderProjectId: "",
  activeFolderProjectId: "",
  isOcrBusy: false,
  batchOcr: null,
  isTranslateBusy: false,
  remoteBookId: "",
  remotePageRevisions: {},
  remotePageSnapshots: {},
  remoteDeferredPages: new Set(),
  remoteSaveTimer: null,
  remoteSavePromise: null,
  remotePendingPayload: null,
  localCacheQuotaExceeded: false,
  layoutHydrationInFlight: new Map(),
  activeProjectRestoreInFlight: false,
  documentRequestId: 0,
};

const cloudLibrary = {
  token: "",
  accessToken: "",
  apiBaseUrl: "",
  authMode: "unknown",
  actor: "",
  names: [],
  items: [],
  path: "",
  loaded: false,
  loading: false,
  uploading: false,
  pendingResume: null,
  bootAttempted: false,
};

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.dataset.appBuild = APP_BUILD_ID;
  cacheElements();
  restoreTranslationRoles();
  restoreOcrFontSize();
  restoreSourcePreviewScale();
  restoreWorkspaceLayout();
  configureDeploymentEndpoints();
  wireEvents();
  initializeGeminiJobs();
  const localCacheReady = initializeProofreadFallback();
  const cloudLibraryReady = initializeCloudLibrary();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  configurePdfJs();
  refreshControls();
  updateSummary();
  updateTranslationSummary();
  void Promise.all([cloudLibraryReady, localCacheReady]).then(() => {
    if (els.homeView && !els.homeView.hidden) renderHomeDashboard();
    if (cloudLibrary.authMode !== "unknown") restoreRouteFromLocation();
  });
  window.addEventListener("popstate", restoreRouteFromLocation);
  window.addEventListener("beforeunload", event => {
    if (!state.localProofreadSavePending && !state.localCacheQuotaExceeded) return;
    event.preventDefault();
    event.returnValue = "";
  });
  warnIfFileProtocol();
  if (window.lucide) {
    window.lucide.createIcons();
  }
  if (!window.__tibetanWorkbenchBootAssetFailed) {
    window.__tibetanWorkbenchBootReady = true;
    window.__tibetanWorkbenchBootSuccess?.();
    if (els.collaborationRetryButton) els.collaborationRetryButton.onclick = null;
  }
});

function cacheElements() {
  [
    "homeButton",
    "homeNewOcrProjectButton",
    "homeNewOcrFolderProjectButton",
    "homeBrowseOcrProjectsButton",
    "homeContinueOcrTaskButton",
    "homeNewTranslationProjectButton",
    "homeBrowseTranslationProjectsButton",
    "homeContinueTranslationTaskButton",
    "homeRefreshProjectsButton",
    "homeOcrStats",
    "homeTranslationStats",
    "homeProjectList",
    "cloudLibrary",
    "cloudLibraryCount",
    "cloudLibraryUploadButton", "cloudLibraryUploadInput",
    "cloudLibraryRefreshButton",
    "cloudLibraryAuth",
    "cloudLibraryAuthTitle", "cloudLibraryAuthHint",
    "cloudLibraryPassword",
    "collaboratorName",
    "collaborationLoginBar", "collaborationActorLabel", "collabHeaderName", "collabHeaderPassword", "collabHeaderLogin", "collabHeaderLogout", "collaborationRetryButton",
    "collaborationPanel", "collabPageNumber", "collabShowHistory", "collabRetryLoad", "collabRetrySync", "collabLogout", "collabFeedback",
    "cloudLibraryUnlockButton",
    "cloudLibraryStatus",
    "cloudLibraryFiles",
    "cloudLibraryBreadcrumb",
    "cloudLibraryRows",
    "sourceRetryButton",
    "fileLoadButton",
    "newProjectButton",
    "deleteProjectButton",
    "fileInput",
    "folderInput",
    "ocrModeSelect",
    "ocrProfileSelect",
    "endpointInput",
    "aiOcrEndpointInput",
    "translateEndpointInput",
    "dpiInput",
    "pageInput",
    "pageTotal",
    "prevButton",
    "nextButton",
    "viewerFirstPageButton",
    "viewerPrevPageButton",
    "viewerPageInput",
    "ocrFirstPageButton", "ocrPrevPageButton", "ocrPageInput", "ocrNextPageButton", "ocrLastPageButton", "ocrPageTotal",
    "viewerNextPageButton",
    "viewerLastPageButton",
    "viewerZoomOutButton",
    "viewerZoomInButton",
    "viewerZoomLabel",
    "zoomInput",
    "checkTranslateButton",
    "ocrButton",
    "statusBar",
    "thumbnailList",
    "sourceTitle",
    "fileOcrStatus",
    "renderMeta",
    "pageViewport",
    "pdfCanvas",
    "imagePage",
    "sourceBlockOverlay",
    "sourceLineHighlight",
    "emptyState",
    "ocrPaneEyebrow",
    "ocrTitle",
    "batchOcrButton",
    "cancelBatchOcrButton",
    "batchOcrProgress",
    "ocrMeta",
    "copyButton",
    "downloadTextButton",
    "decreaseOcrFontButton",
    "increaseOcrFontButton",
    "ocrViewSwitch",
    "proofreadViewButton",
    "compareViewButton",
    "lineViewButton",
    "textViewButton",
    "ocrLineCompare",
    "ocrText",
    "charCount",
    "recognizedCount",
    "aiOcrTitle",
    "aiOcrMeta",
    "copyAiButton",
    "downloadAiTextButton",
    "aiOcrLineCompare",
    "aiCharCount",
    "aiLineCount",
    "translationTitle",
    "translationMeta",
    "translationRoleSelect",
    "manageRolesButton",
    "translationRoleModel",
    "translateButton",
    "copyTranslationButton",
    "clearTranslationButton",
    "downloadTranslationButton",
    "translationText",
    "translationCharCount",
    "translatedCount",
    "toggleTranslationPaneButton",
    "roleManagerModal",
    "closeRoleManagerButton",
    "roleList",
    "roleForm",
    "newRoleButton",
    "saveRoleButton",
    "deleteRoleButton",
    "resetRolesButton",
    "roleNameInput",
    "roleIdInput",
    "roleSourceLangInput",
    "roleTargetLangInput",
    "roleModelInput",
    "roleTemperatureInput",
    "roleMaxTokensInput",
    "roleSystemPromptInput",
    "roleUserPromptTemplateInput",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.appShell = document.querySelector(".app-shell");
  els.homeView = document.getElementById("homeView");
  els.workbenchView = document.getElementById("workbenchView");
  els.workspace = document.querySelector(".workspace");
  els.resizers = Array.from(document.querySelectorAll(".pane-resizer[data-resizer]"));
  els.viewerDividerToggle = document.querySelector(".viewer-ocr-divider-toggle");
  els.paneCollapseButtons = Array.from(document.querySelectorAll("[data-collapse-pane]")).filter(
    (button) => button !== els.viewerDividerToggle,
  );
}

function isCloudDeployment() {
  return window.location.protocol === "https:" || !["127.0.0.1", "localhost", ""].includes(window.location.hostname);
}

function isLocalWorkbench() {
  return !isCloudDeployment() && ["127.0.0.1", "localhost"].includes(window.location.hostname);
}

function cloudLibraryApiOrigin() {
  return isCloudDeployment() ? window.location.origin : "https://tibetan-ocr-without-bdrc.zeabur.app";
}

function configureDeploymentEndpoints() {
  els.aiOcrEndpointInput.value = `${window.location.origin}/api/ai-ocr`;
  els.translateEndpointInput.value = `${window.location.origin}/api/translate`;
}

function wireEvents() {
  bindOptionalClick("homeButton", () => showHomeView());
  bindOptionalClick("homeNewOcrProjectButton", () => startNewWorkflowProject("ocr"));
  bindOptionalClick("homeNewOcrFolderProjectButton", () => startNewOcrFolderProject());
  bindOptionalClick("homeBrowseOcrProjectsButton", () => browseHomeProjects("ocr"));
  bindOptionalClick("homeContinueOcrTaskButton", () => continueHomeTask("ocr"));
  bindOptionalClick("homeNewTranslationProjectButton", () => startNewWorkflowProject("translation"));
  bindOptionalClick("homeBrowseTranslationProjectsButton", () => browseHomeProjects("translation"));
  bindOptionalClick("homeContinueTranslationTaskButton", () => continueHomeTask("translation"));
  bindOptionalClick("homeRefreshProjectsButton", () => renderHomeDashboard());
  bindOptionalClick("cloudLibraryRefreshButton", () => void (cloudLibrary.authMode === "unknown" ? initializeCloudLibrary() : refreshCloudLibrary()));
  bindOptionalClick("collaborationRetryButton", () => void initializeCloudLibrary());
  bindOptionalClick("sourceRetryButton", () => {
    els.sourceRetryButton.hidden = true;
    if (state.remoteBookId && !state.remoteRestoreComplete) {
      void resumeRemoteProject({
        sourceName: state.sourceName, sourceSize: state.sourceSize, sourceMime: state.sourceMime,
        remoteBookId: state.remoteBookId,
      }, state.activeWorkflow);
    } else if (state.pageCount) {
      state.remoteFirstPageDeadline = Date.now() + 120000;
      void renderCurrentPage().catch(() => {});
    }
  });
  bindOptionalClick("collabRetrySync", () => void retryCollaborationSync());
  bindOptionalClick("collabRetryLoad", () => {
    if (!state.remoteBookId) return;
    els.collabRetryLoad.hidden = true;
    void resumeRemoteProject({
      sourceName: state.sourceName, sourceSize: state.sourceSize, sourceMime: state.sourceMime,
      remoteBookId: state.remoteBookId,
    }, state.activeWorkflow);
  });
  bindOptionalClick("cloudLibraryUploadButton", () => els.cloudLibraryUploadInput?.click());
  bindOptionalClick("cloudLibraryUnlockButton", () => void unlockCloudLibrary());
  els.cloudLibraryUploadInput?.addEventListener("change", (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void uploadCloudLibraryFile(file);
  });
  bindOptionalClick("collabShowHistory", () => void showPageHistory());
  bindOptionalClick("collabLogout", () => void logoutCollaboration());
  bindOptionalClick("collabHeaderLogin", () => void unlockCloudLibrary());
  bindOptionalClick("collabHeaderLogout", () => void logoutCollaboration());
  els.cloudLibraryPassword?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void unlockCloudLibrary();
  });
  document.querySelectorAll("[data-workflow-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea")) return;
      showWorkbenchView(card.dataset.workflowCard === "translation" ? "translation" : "ocr");
    });
  });

  els.fileLoadButton.addEventListener("click", () => {
    if (!els.fileInput) {
      setStatus("文件选择控件未初始化，请刷新页面后重试。", "error");
      return;
    }
    els.fileInput.value = "";
    els.fileInput.click();
  });

  bindOptionalClick("newProjectButton", newProject);
  bindOptionalClick("deleteProjectButton", deleteCurrentProject);

  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) {
      try {
        await loadFile(file);
      } catch (error) {
        console.error("Failed to load file", error);
        setStatus(`文件加载失败：${error.message || error}`, "error");
      } finally {
        event.target.value = "";
      }
    } else {
      setStatus("已取消文件选择。", "warn");
    }
  });

  if (els.folderInput) {
    els.folderInput.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      try {
        if (files.length) {
          await loadFolderProject(files);
        } else {
          setStatus("已取消文件夹选择。", "warn");
        }
      } catch (error) {
        console.error("Failed to load folder project", error);
        setStatus(`文件夹项目加载失败：${error.message || error}`, "error");
      } finally {
        state.pendingFolderProjectId = "";
        event.target.value = "";
      }
    });
  }

  els.prevButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.nextButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.viewerFirstPageButton.addEventListener("click", () => goToPage(1));
  els.viewerPrevPageButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.viewerNextPageButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.viewerLastPageButton.addEventListener("click", () => goToPage(state.pageCount));
  els.ocrFirstPageButton.addEventListener("click", () => goToPage(1));
  els.ocrPrevPageButton.addEventListener("click", () => goToPage(state.pageNum - 1));
  els.ocrNextPageButton.addEventListener("click", () => goToPage(state.pageNum + 1));
  els.ocrLastPageButton.addEventListener("click", () => goToPage(state.pageCount));
  els.ocrPageInput.addEventListener("change", () => goToPage(Number(els.ocrPageInput.value)));
  els.ocrPageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") goToPage(Number(els.ocrPageInput.value));
  });
  els.viewerZoomOutButton.addEventListener("click", () => setSourcePageZoom(state.sourcePageZoom - SOURCE_PAGE_ZOOM_STEP));
  els.viewerZoomInButton.addEventListener("click", () => setSourcePageZoom(state.sourcePageZoom + SOURCE_PAGE_ZOOM_STEP));

  els.pageInput.addEventListener("change", () => {
    goToPage(Number(els.pageInput.value));
  });
  els.pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      goToPage(Number(els.pageInput.value));
    }
  });
  els.viewerPageInput.addEventListener("change", () => {
    goToPage(Number(els.viewerPageInput.value));
  });
  els.viewerPageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      goToPage(Number(els.viewerPageInput.value));
    }
  });

  els.zoomInput.addEventListener("change", renderCurrentPage);
  els.pageViewport.addEventListener("click", handleSourceViewportClick);
  els.ocrModeSelect.addEventListener("change", () => {
    const mode = getOcrMode();
    setStatus(mode === "bdrc" ? "已切换到 BDRC 识别。" : "已切换到 Gemini 识别。", "ok");
  });
  els.ocrProfileSelect.addEventListener("change", () => {
    const profile = getSelectedOcrProfile();
    state.ocrProfile = profile.id;
    saveCachedResults();
    setStatus(`资料类型已切换为“${profile.label}”，下次将使用 Gemini 识别。`, "ok");
  });
  bindOptionalClick("checkTranslateButton", checkTranslateService);
  els.ocrButton.addEventListener("click", runOcrForCurrentPage);
  loadGeminiRowModelCatalog();
  els.batchOcrButton.addEventListener("click", runOcrForRemainingPages);
  els.cancelBatchOcrButton.addEventListener("click", () => {
    if (state.batchOcr?.running) {
      state.batchOcr.cancelled = true;
      updateBatchOcrProgress();
    }
  });
  els.copyButton.addEventListener("click", copyCurrentText);
  els.downloadTextButton.addEventListener("click", downloadAllOcrText);
  els.copyAiButton.addEventListener("click", copyCurrentAiText);
  els.downloadAiTextButton.addEventListener("click", downloadAllAiOcrText);
  els.decreaseOcrFontButton.addEventListener("click", () => {
    setOcrFontSize(state.ocrFontSize - OCR_FONT_SIZE_STEP);
  });
  els.increaseOcrFontButton.addEventListener("click", () => {
    setOcrFontSize(state.ocrFontSize + OCR_FONT_SIZE_STEP);
  });
  els.proofreadViewButton.addEventListener("click", () => setOcrView("proofread"));
  els.compareViewButton.addEventListener("click", () => setOcrView("compare"));
  els.lineViewButton.addEventListener("click", () => setOcrView("lines"));
  els.textViewButton.addEventListener("click", () => setOcrView("text"));
  els.translationRoleSelect.addEventListener("change", () => {
    state.activeTranslationRoleId = els.translationRoleSelect.value;
    saveActiveTranslationRole();
    renderActiveTranslationRoleMeta();
  });
  els.translationRoleModel.addEventListener("change", () => {
    const role = getActiveTranslationRole();
    role.model = els.translationRoleModel.value;
    if (role.builtIn) {
      const overrides = readTranslationModelOverrides();
      overrides[role.id] = role.model;
      window.localStorage.setItem(TRANSLATION_MODEL_OVERRIDES_KEY, JSON.stringify(overrides));
    } else {
      saveCustomTranslationRoles();
    }
    renderActiveTranslationRoleMeta();
    renderRoleList();
    setStatus(`当前角色模型已切换为 ${role.model}。`, "ok");
  });
  els.manageRolesButton.addEventListener("click", openRoleManager);
  els.closeRoleManagerButton.addEventListener("click", closeRoleManager);
  els.roleManagerModal.addEventListener("click", (event) => {
    if (event.target === els.roleManagerModal) {
      closeRoleManager();
    }
  });
  els.newRoleButton.addEventListener("click", createDraftTranslationRole);
  els.roleForm.addEventListener("submit", saveRoleFromForm);
  els.deleteRoleButton.addEventListener("click", deleteEditingTranslationRole);
  els.resetRolesButton.addEventListener("click", resetCustomTranslationRoles);
  els.translateButton.addEventListener("click", runTranslateForCurrentPage);
  els.copyTranslationButton.addEventListener("click", copyCurrentTranslation);
  els.clearTranslationButton.addEventListener("click", clearCurrentTranslation);
  els.downloadTranslationButton.addEventListener("click", downloadAllTranslationText);
  els.toggleTranslationPaneButton.addEventListener("click", () => {
    setTranslationCollapsed(!state.layout.translationCollapsed);
  });
  els.paneCollapseButtons.forEach((button) => {
    button.addEventListener("click", () => togglePaneCollapsed(button.dataset.collapsePane));
  });
  els.viewerDividerToggle?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    togglePaneCollapsed("viewer");
  });
  els.viewerDividerToggle?.addEventListener("click", (event) => {
    if (event.detail === 0) togglePaneCollapsed("viewer");
  });
  wireWorkspaceResizers();
  wireProofreadFloatingMarkAction();

  els.ocrText.addEventListener("input", () => {
    if (!state.pageCount) return;
    const existing = state.ocrResults.get(state.pageNum) || {};
    const textLines = els.ocrText.value.split("\n");
    const existingLines = existing.lines || extractOcrLines(existing.raw);
    const lines = existingLines.map((line, index) => ({
      ...line,
      text: textLines[index] ?? "",
    }));
    for (let index = existingLines.length; index < textLines.length; index += 1) {
      lines.push({ text: textLines[index], bbox: null, index });
    }
    const compare = syncTextViewEditsToAdoptedModels(existing, lines, textLines);
    state.ocrResults.set(state.pageNum, {
      ...existing,
      text: els.ocrText.value,
      lines,
      ...(compare ? { compare } : {}),
      source: existing.source || "manual",
      updatedAt: new Date().toISOString(),
    });
    const saved = saveCachedResults() !== false;
    setStatus(saved ? "当前页各行的修改已自动保存。" : "当前页修改未能保存，请重试。", saved ? "ok" : "error");
    renderOcrLineComparison();
    updateSummary();
    updateThumbnailState();
  });

  els.translationText.addEventListener("input", () => {
    if (!state.pageCount) return;
    if (els.translationText.value.trim()) {
      const existing = state.translationResults.get(state.pageNum) || {};
      state.translationResults.set(state.pageNum, {
        ...existing,
        text: els.translationText.value,
        source: existing.source || "manual",
        updatedAt: new Date().toISOString(),
      });
    } else {
      state.translationResults.delete(state.pageNum);
    }
    saveCachedResults();
    updateTranslationSummary();
    updateThumbnailState();
  });

  window.addEventListener("resize", debounce(() => {
    if (state.pageCount && els.zoomInput.value === "fit") {
      renderCurrentPage();
    } else {
      renderActiveSourceHighlight();
    }
  }, 160));
}

function bindOptionalClick(id, handler) {
  if (els[id]) {
    els[id].addEventListener("click", handler);
  }
}

function getProofreadFloatingMarkTarget(selection) {
  if (!selection || !Number.isInteger(selection.index) || selection.index < 0 || !/[\u0F00-\u0FFF]/u.test(selection.text || "")) {
    return null;
  }
  const provider = selection.reviewProvider || selection.side;
  if (!["bdrc", "llm", "qwen", "openai"].includes(provider)) return null;
  return { index: selection.index, provider };
}

function markProofreadFloatingSelection(card) {
  const target = getProofreadFloatingMarkTarget(getSelectedProofreadRange(card));
  if (!target) return false;
  markSelectedSharedError(target.index, card, target.provider);
  return true;
}

function getProofreadFloatingMarkPosition(x, y, width, height, viewportWidth, viewportHeight) {
  const margin = 8;
  let left = x + 12;
  let top = y + 12;
  if (left + width > viewportWidth - margin) left = x - width - 12;
  if (top + height > viewportHeight - margin) top = y - height - 12;
  return {
    left: clamp(left, margin, Math.max(margin, viewportWidth - width - margin)),
    top: clamp(top, margin, Math.max(margin, viewportHeight - height - margin)),
  };
}

function wireProofreadFloatingMarkAction() {
  if (proofreadFloatingMarkButton || !els.ocrLineCompare || !document.body) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button compact proofread-floating-mark-action";
  button.textContent = "标错";
  button.setAttribute("aria-label", "将所选藏文标错");
  button.hidden = true;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideProofreadFloatingMarkButton();
    markProofreadFloatingSelection(els.ocrLineCompare);
  });
  document.body.append(button);
  proofreadFloatingMarkButton = button;

  document.addEventListener("pointerdown", (event) => {
    if (!button.contains(event.target)) hideProofreadFloatingMarkButton();
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (button.contains(event.target)) return;
    const selectionEditor = event.target?.closest?.(".proofread-editor, .openai-review-candidate");
    if (!selectionEditor) {
      hideProofreadFloatingMarkButton();
      return;
    }
    lastProofreadSelectionPoint = { x: event.clientX, y: event.clientY };
    updateProofreadFloatingMarkButton(lastProofreadSelectionPoint);
  }, true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      hideProofreadFloatingMarkButton();
      return;
    }
    lastProofreadSelectionPoint = null;
    updateProofreadFloatingMarkButton();
  }, true);
  document.addEventListener("selectionchange", () => {
    updateProofreadFloatingMarkButton(lastProofreadSelectionPoint);
  });
  window.addEventListener("scroll", hideProofreadFloatingMarkButton, true);
  window.addEventListener("resize", hideProofreadFloatingMarkButton);
}

function updateProofreadFloatingMarkButton(point = null) {
  if (!proofreadFloatingMarkButton) return;
  const selection = getSelectedProofreadRange(els.ocrLineCompare);
  if (!getProofreadFloatingMarkTarget(selection)) {
    hideProofreadFloatingMarkButton();
    return;
  }
  const range = window.getSelection?.()?.getRangeAt(0);
  const rect = range?.getBoundingClientRect?.();
  const x = Number.isFinite(point?.x) ? point.x : (rect?.right ?? 0);
  const y = Number.isFinite(point?.y) ? point.y : (rect?.bottom ?? 0);
  const bounds = getProofreadFloatingMarkPosition(
    x,
    y,
    proofreadFloatingMarkButton.offsetWidth || 68,
    proofreadFloatingMarkButton.offsetHeight || 34,
    window.innerWidth,
    window.innerHeight,
  );
  proofreadFloatingMarkButton.style.left = `${bounds.left}px`;
  proofreadFloatingMarkButton.style.top = `${bounds.top}px`;
  proofreadFloatingMarkButton.hidden = false;
}

function hideProofreadFloatingMarkButton() {
  if (proofreadFloatingMarkButton) proofreadFloatingMarkButton.hidden = true;
}

function getWorkflowFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const workflow = params.get("workflow");
  return workflow === "ocr" || workflow === "translation" ? workflow : "home";
}

async function restoreRouteFromLocation() {
  await initializeProofreadFallback();
  const workflow = getWorkflowFromLocation();
  if (workflow === "ocr" || workflow === "translation") {
    showWorkbenchView(workflow, { updateRoute: false });
    const bookId = new URLSearchParams(window.location.search).get("book_id");
    if (isCloudDeployment() && bookId) {
      await resumeRemoteProject({ remoteBookId: bookId }, workflow);
      return;
    }
    await restoreActiveProjectForRoute(workflow);
    return;
  }
  showHomeView({ silent: true, updateRoute: false });
}

async function restoreActiveProjectForRoute(workflow) {
  if (hasActiveDocument() || state.activeProjectRestoreInFlight) return;
  const requestId = state.documentRequestId;
  const cacheKey = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  if (!cacheKey || !cacheKey.startsWith(CACHE_PREFIX)) return;
  const project = parseCachedProject(cacheKey);
  if (!project) return;
  if (isCloudDeployment() && project.remoteBookId) {
    await resumeRemoteProject(project, workflow);
    return;
  }

  state.activeProjectRestoreInFlight = true;
  try {
    const sourceFile = await getStoredSourceFile(cacheKey);
    if (requestId !== state.documentRequestId) return;
    if (!sourceFile) {
      setStatus(`已找到“${project.sourceName}”的 OCR 缓存，但源文件缓存已丢失；请重新加载原始文件。`, "warn");
      return;
    }
    const loaded = await loadFile(sourceFile);
    if (!loaded) return;
    if (workflow === "ocr") setOcrView("proofread");
    setStatus(`已自动恢复“${sourceFile.name}”及已有 OCR/译文结果。`, "ok");
  } catch (error) {
    console.warn("Failed to auto-restore active OCR project", error);
    setStatus(`自动恢复项目失败：${error.message || error}。可从项目列表手动继续。`, "warn");
  } finally {
    state.activeProjectRestoreInFlight = false;
    refreshControls();
  }
}

function updateRouteForWorkflow(workflow, options = {}) {
  if (!window.history?.pushState || window.location.protocol === "file:") return;
  const normalized = workflow === "ocr" || workflow === "translation" ? workflow : "home";
  const url = new URL(window.location.href);
  if (normalized === "home") {
    url.searchParams.delete("workflow");
    url.searchParams.delete("book_id");
  } else {
    url.searchParams.set("workflow", normalized);
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  const method = options.replace ? "replaceState" : "pushState";
  window.history[method]({ workflow: normalized }, "", nextUrl);
}

function showHomeView(options = {}) {
  state.activeWorkflow = "home";
  els.homeView.hidden = false;
  els.workbenchView.hidden = true;
  els.appShell.classList.add("home-mode", "ocr-only-mode");
  els.appShell.classList.add("ai-only-mode");
  els.appShell.classList.remove("workbench-mode", "translation-workflow");
  els.workspace.classList.add("ocr-only-mode");
  els.workspace.classList.remove("translation-enabled", "translation-workflow");
  setAppTitle("藏文典籍翻译工作台");
  renderHomeDashboard();
  if (cloudLibrary.token && !cloudLibrary.loaded) void refreshCloudLibrary();
  if (!options.silent) {
    setStatus("", "");
  }
  if (options.updateRoute !== false) {
    updateRouteForWorkflow("home", { replace: options.replaceRoute });
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showWorkbenchView(workflow = "ocr", options = {}) {
  const isTranslation = workflow === "translation";
  state.activeWorkflow = isTranslation ? "translation" : "ocr";
  els.homeView.hidden = true;
  els.workbenchView.hidden = false;
  els.appShell.classList.remove("home-mode");
  els.appShell.classList.add("workbench-mode");
  els.appShell.classList.add("ai-only-mode");
  els.appShell.classList.toggle("ocr-only-mode", !isTranslation);
  els.appShell.classList.toggle("translation-workflow", isTranslation);
  els.workspace.classList.toggle("ocr-only-mode", !isTranslation);
  els.workspace.classList.toggle("translation-enabled", isTranslation);
  els.workspace.classList.toggle("translation-workflow", isTranslation);
  setAppTitle("藏文典籍翻译工作台");
  if (isTranslation) {
    state.layout.translationCollapsed = false;
    state.layout.collapsed.viewer = false;
    els.workspace.classList.remove("proofread-merged-view");
    els.ocrLineCompare.classList.remove("proofread-block-list");
    state.ocrView = "lines";
    clearSourceLineHighlight();
  } else {
    state.layout.translationCollapsed = true;
    setOcrView("proofread");
  }
  applyWorkspaceLayout();
  refreshControls();
  if (isTranslation) {
    updateTranslationPanelForPage();
  }
  if (options.updateRoute !== false) {
    updateRouteForWorkflow(state.activeWorkflow, { replace: options.replaceRoute });
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function startNewWorkflowProject(workflow) {
  if (newProject()) {
    showWorkbenchView(workflow);
    if (!els.fileInput) {
      setStatus("文件选择控件未初始化，请刷新页面后重试。", "error");
      return;
    }
    els.fileInput.value = "";
    els.fileInput.click();
  }
}

function startNewOcrFolderProject() {
  if (!els.folderInput) {
    setStatus("文件夹选择控件未初始化，请刷新页面后重试。", "error");
    return;
  }
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再新建项目。", "warn");
    return;
  }
  state.pendingFolderProjectId = "";
  els.folderInput.value = "";
  els.folderInput.click();
}

async function loadFolderProject(files) {
  const pdfFiles = files.filter(isPdfFile);
  if (!pdfFiles.length) {
    throw new Error("所选总文件夹中没有找到 PDF 分册。");
  }

  const manifest = makeFolderProjectManifest(pdfFiles, state.pendingFolderProjectId);
  state.folderProjectFiles.set(manifest.id, manifest.parts.map((part) => ({
    id: part.id,
    file: part.file,
  })));
  persistFolderProjectManifest(manifest);
  renderHomeDashboard();

  const firstPart = manifest.parts[0];
  if (!firstPart?.file) {
    setStatus(`已建立“${manifest.sourceName}”项目，但没有可打开的 PDF 分册。`, "warn");
    return;
  }

  state.activeFolderProjectId = manifest.id;
  showWorkbenchView("ocr");
  await loadFile(firstPart.file);
  state.activeFolderProjectId = manifest.id;
  setStatus(
    `已载入“${manifest.sourceName}”：${manifest.parts.length} 个 PDF 分册已纳入项目。当前打开第 1 个分册“${firstPart.file.name}”。`,
    "ok"
  );
}

function makeFolderProjectManifest(files, preferredId = "") {
  const rootName = inferFolderRootName(files);
  const parts = files
    .map((file, index) => makeFolderProjectPart(file, index))
    .sort(compareFolderProjectParts)
    .map((part, index) => ({
      ...part,
      order: index + 1,
      id: `${String(index + 1).padStart(4, "0")}-${slugifyProjectPart(part.relativePath || part.name)}`,
    }));
  const knownPages = parts.reduce((total, part) => total + (part.estimatedPages || 0), 0);
  const id = preferredId || makeFolderProjectId(rootName, parts);

  return {
    id,
    kind: "folder",
    workflow: "ocr",
    sourceName: rootName || "未命名藏文书籍",
    sourceMime: "folder/pdf-parts",
    sourceType: "pdf-folder",
    partCount: parts.length,
    pageCount: knownPages,
    hasEstimatedPageCount: knownPages > 0,
    updatedAt: new Date().toISOString(),
    parts,
  };
}

function makeFolderProjectPart(file, index) {
  const relativePath = file.webkitRelativePath || file.name;
  const range = parsePageRangeFromName(relativePath);
  const partNumber = parsePartNumberFromName(relativePath);
  return {
    name: file.name,
    relativePath,
    folderPath: relativePath.includes("/") ? relativePath.split("/").slice(0, -1).join("/") : "",
    pageStart: range?.start || 0,
    pageEnd: range?.end || 0,
    estimatedPages: range ? Math.max(1, range.end - range.start + 1) : 0,
    partNumber,
    fallbackOrder: index,
    file,
  };
}

function inferFolderRootName(files) {
  const firstPath = files.find((file) => file.webkitRelativePath)?.webkitRelativePath || "";
  const [root] = firstPath.split("/");
  if (root) return root;
  const firstFile = files[0];
  return firstFile?.name?.replace(/\.pdf$/i, "") || "未命名藏文书籍";
}

function compareFolderProjectParts(left, right) {
  if (left.pageStart && right.pageStart && left.pageStart !== right.pageStart) {
    return left.pageStart - right.pageStart;
  }
  if (left.partNumber && right.partNumber && left.partNumber !== right.partNumber) {
    return left.partNumber - right.partNumber;
  }
  return (left.relativePath || left.name).localeCompare(right.relativePath || right.name, "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function parsePageRangeFromName(value) {
  const normalized = String(value || "").replace(/[_\s]+/g, " ");
  const patterns = [
    /pages?\s*0*(\d{1,6})\s*[-_~至]\s*0*(\d{1,6})/i,
    /p(?:age)?\s*0*(\d{1,6})\s*[-_~至]\s*0*(\d{1,6})/i,
    /(?:^|[^\d])0*(\d{1,6})\s*[-_~至]\s*0*(\d{1,6})(?:[^\d]|$)/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }
  return null;
}

function parsePartNumberFromName(value) {
  const match = String(value || "").match(/part[_\s-]*0*(\d{1,5})/i);
  return match ? Number(match[1]) : 0;
}

function makeFolderProjectId(rootName, parts) {
  const signature = [
    rootName || "book",
    parts.length,
    parts[0]?.relativePath || "",
    parts[parts.length - 1]?.relativePath || "",
  ].join("|");
  return `folder:${slugifyProjectPart(signature)}`;
}

function slugifyProjectPart(value) {
  return encodeURIComponent(String(value || "part").toLowerCase())
    .replace(/%/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "part";
}

function persistFolderProjectManifest(manifest) {
  const stored = getStoredFolderProjects().filter((project) => project.id !== manifest.id);
  const cleanParts = manifest.parts.map(({ file: _file, ...part }) => part);
  stored.unshift({
    ...manifest,
    parts: cleanParts,
  });
  window.localStorage.setItem(FOLDER_PROJECTS_KEY, JSON.stringify(stored.slice(0, 50)));
}

function getStoredFolderProjects() {
  try {
    const raw = window.localStorage.getItem(FOLDER_PROJECTS_KEY);
    const projects = JSON.parse(raw || "[]");
    return Array.isArray(projects) ? projects.filter((project) => project?.kind === "folder") : [];
  } catch (error) {
    console.warn("Failed to parse folder projects", error);
    return [];
  }
}

function setAppTitle(title) {
  const heading = document.querySelector(".brand h1");
  if (heading) {
    heading.textContent = title;
  }
  document.title = title;
}

function browseHomeProjects(filter = "all", options = {}) {
  if (state.activeWorkflow !== "home") {
    showHomeView({ silent: true });
  }
  state.homeProjectFilter = HOME_PROJECT_FILTERS.has(filter) ? filter : "all";
  renderHomeDashboard();
  els.homeProjectList?.scrollIntoView({ block: "start", behavior: "smooth" });
  if (!options.silent) {
    const label = filter === "translation" ? "藏译中项目" : filter === "ocr" ? "OCR 项目" : "本机项目";
    setStatus(`已显示${label}列表，请在下方选择要继续的项目。`, "ok");
  }
}

function continueHomeTask(workflow) {
  const projects = getHomeProjects();
  const predicate = workflow === "translation" ? isTranslationProjectInProgress : isOcrProjectInProgress;
  const candidates = projects.filter(predicate);
  const label = workflow === "translation" ? "正在翻译的项目" : "正在校对的项目";

  if (candidates.length > 1) {
    browseHomeProjects(workflow, { silent: true });
    setStatus(`找到 ${candidates.length} 个${label}，请在下方项目列表中选择一个继续。`, "warn");
    return;
  }

  if (candidates.length === 1) {
    openHomeProject(candidates[0], workflow);
    return;
  }

  browseHomeProjects(workflow, { silent: true });
  setStatus(workflow === "translation" ? "没有正在翻译的任务。可以新建翻译项目，或先加载已有源文件。" : "没有正在校对的任务。可以新建 OCR 项目，或先加载已有源文件。", "warn");
}

function requestCachedProjectSource(project, workflow = "ocr") {
  if (isCloudDeployment() && project.remoteBookId) {
    resumeRemoteProject(project, workflow);
    return;
  }
  resumeLocalProject(project, workflow);
}

async function resumeLocalProject(project, workflow = "ocr") {
  const requestId = ++state.documentRequestId;
  try {
    const sourceFile = await getStoredSourceFile(project.cacheKey);
    if (requestId !== state.documentRequestId) return;
    if (sourceFile) {
      showWorkbenchView(workflow);
      const loaded = await loadFile(sourceFile, { requestId });
      if (!loaded) return;
      if (workflow === "ocr") setOcrView("proofread");
      setStatus(`已恢复“${sourceFile.name}”及本机校对进度。`, "ok");
      return;
    }
  } catch (error) {
    if (requestId !== state.documentRequestId) return;
    console.warn("Failed to restore cached source file", error);
  }
  if (requestId !== state.documentRequestId) return;
  showWorkbenchView(workflow);
  setStatus(
    `项目“${project.sourceName}”的浏览器源文件缓存已丢失，请点击“加载文件”重新选择原始文件；已有 OCR/译文记录仍会保留。`,
    "warn",
  );
}

function openSourceDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("当前浏览器不支持本地源文件缓存"));
      return;
    }
    const request = window.indexedDB.open(SOURCE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SOURCE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地源文件缓存"));
  });
}

async function storeSourceFile(cacheKey, file) {
  if (!cacheKey || !file || !window.indexedDB) return;
  const database = await openSourceDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
    transaction.objectStore(SOURCE_STORE_NAME).put(file, cacheKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("无法保存源文件"));
  });
  database.close();
}

async function getStoredSourceFile(cacheKey) {
  if (!cacheKey || !window.indexedDB) return null;
  const database = await openSourceDatabase();
  const file = await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readonly");
    const request = transaction.objectStore(SOURCE_STORE_NAME).get(cacheKey);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("无法读取源文件"));
  });
  database.close();
  return file;
}

async function removeStoredSourceFile(cacheKey) {
  if (!cacheKey || !window.indexedDB) return;
  const database = await openSourceDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
    transaction.objectStore(SOURCE_STORE_NAME).delete(cacheKey);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("无法删除源文件缓存"));
  });
  database.close();
}

async function resumeRemoteProject(project, workflow = "ocr", options = {}) {
  const requestId = options.requestId ?? ++state.documentRequestId;
  if (requestId !== state.documentRequestId) return;
  showWorkbenchView(workflow);
  if (cloudLibrary.authMode === "collaboration" && !cloudLibrary.actor) {
    requestCollaborationLogin(project, workflow);
    return;
  }
  setStatus(`正在恢复云端项目“${project.sourceName}”...`, "warn");
  try {
    const baseUrl = project.apiBaseUrl || window.location.origin;
    const apiHeaders = project.apiAccessToken ? { Authorization: `Bearer ${project.apiAccessToken}` } : {};
    const sourceUrl = `${baseUrl}/api/books/${encodeURIComponent(project.remoteBookId)}/source?v=${Date.now()}`;
    const sourcePromise = (async () => {
      if (isCloudDeployment() && window.matchMedia("(max-width: 760px)").matches &&
          isPdfFile({ name: project.sourceName, type: project.sourceMime })) {
        return { rangePdf: true, name: project.sourceName, type: project.sourceMime || "application/pdf", size: Number(project.sourceSize) || 0 };
      }
      let sourceName = project.sourceName || "";
      let sourceMime = project.sourceMime || "";
      let sourceSize = Number(project.sourceSize) || 0;
      {
        const probe = await fetch(sourceUrl, { credentials: project.apiAccessToken ? "omit" : "same-origin", headers: { Range: "bytes=0-0", ...apiHeaders } });
        if (!probe.ok) throw Object.assign(new Error(`源文件 HTTP ${probe.status}`), { status: probe.status });
        const disposition = probe.headers.get("content-disposition") || "";
        const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        if (!sourceName && encodedName) {
          try { sourceName = decodeURIComponent(encodedName); } catch (_) { /* Use the MIME fallback below. */ }
        }
        sourceMime ||= (probe.headers.get("content-type") || "").split(";")[0].trim();
        sourceSize ||= Number(probe.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]) || 0;
        await probe.body?.cancel();
      }
      sourceName ||= sourceMime === "application/pdf" ? "远程项目.pdf" : "远程项目.png";
      const pdfDescriptor = { name: sourceName, type: sourceMime };
      if (isPdfFile(pdfDescriptor)) {
        return { rangePdf: true, name: sourceName, type: sourceMime, size: sourceSize };
      }
      const response = await fetch(sourceUrl, { credentials: project.apiAccessToken ? "omit" : "same-origin", headers: apiHeaders });
      if (!response.ok) throw Object.assign(new Error(`源文件 HTTP ${response.status}`), { status: response.status });
      const blob = await response.blob();
      return { file: new File([blob], sourceName, {
        type: blob.type || sourceMime || "application/octet-stream",
      }) };
    })();
    const statePromise = fetchCloudBookState(`${baseUrl}/api/books/${encodeURIComponent(project.remoteBookId)}/state`, {
      credentials: project.apiAccessToken ? "omit" : "same-origin", headers: apiHeaders,
    }).then((remoteState) => ({ remoteState }), (error) => ({ error }));
    const source = await sourcePromise;
    if (requestId !== state.documentRequestId) return;
    let sourceFile = source.file || null;
    let sourceName = source.name || sourceFile?.name || "远程项目.pdf";
    const sourceMime = sourceFile?.type || source.type || "application/pdf";
    state.remoteRestoreInFlight = true;
    state.remoteStateLoadError = "";
    if (els.collabRetryLoad) els.collabRetryLoad.hidden = true;
    setCollaborationFeedback("正在读取云端校对内容…");
    if (source.rangePdf) {
      const loaded = await loadRemotePdfWithRanges(sourceUrl, {
        name: sourceName,
        size: source.size || 0,
        type: sourceMime,
      }, project.remoteBookId, requestId, apiHeaders);
      if (!loaded) return;
    } else {
      if (sourceFile.name !== sourceName) {
        sourceFile = new File([sourceFile], sourceName, { type: sourceFile.type || sourceMime });
      }
      const loaded = await loadFile(sourceFile, { skipRemoteUpload: true, remoteBookId: project.remoteBookId, requestId });
      if (!loaded) return;
    }

    const stateResult = await statePromise;
    if (requestId !== state.documentRequestId) return;
    if (stateResult.error) {
      const error = stateResult.error;
      state.remoteRestoreInFlight = false;
      state.remoteStateLoadError = String(error.message || error);
      if (restoreCachedResults()) await renderCurrentPage();
      if (error.status === 401 && cloudLibrary.authMode === "collaboration") {
        requestCollaborationLogin(project, workflow);
        return;
      }
      if (els.sourceRetryButton) {
        els.sourceRetryButton.textContent = "重试云端校对状态";
        els.sourceRetryButton.hidden = false;
      }
      if (els.collabRetryLoad) els.collabRetryLoad.hidden = false;
      setCollaborationFeedback("云端校对状态暂时无法加载；本机修改会保留，重试成功前不会写入云端。", true);
      setStatus(`已打开“${sourceName}”原文；云端校对状态暂时无法加载（${error.message || error}）。本机修改暂不上传，请点“重试云端校对状态”。`, "warn");
      updateCollaborationPageNumber();
      return;
    }
    const remoteState = stateResult.remoteState;
    sourceName = remoteState.sourceName || remoteState.name || sourceName;
    let sourceReloadRequired = false;
    if (sourceFile && remoteState.size && sourceFile.size !== Number(remoteState.size)) {
      const response = await fetch(sourceUrl, { credentials: project.apiAccessToken ? "omit" : "same-origin", headers: apiHeaders });
      if (!response.ok) throw Object.assign(new Error(`源文件 HTTP ${response.status}`), { status: response.status });
      const blob = await response.blob();
      sourceFile = new File([blob], sourceName, { type: blob.type || remoteState.content_type || project.sourceMime || "application/pdf" });
      sourceReloadRequired = true;
    }
    if (sourceFile && (sourceFile.name !== sourceName || sourceFile.type !== (remoteState.content_type || sourceFile.type))) {
      sourceFile = new File([sourceFile], sourceName, {
        type: remoteState.content_type || sourceFile.type || project.sourceMime || "application/pdf",
      });
      sourceReloadRequired = true;
    }
    if (sourceReloadRequired) {
      const loaded = await loadFile(sourceFile, { skipRemoteUpload: true, remoteBookId: project.remoteBookId, requestId });
      if (!loaded) return;
    }
    if (requestId !== state.documentRequestId) return;
    if (source.rangePdf) {
      state.sourceName = sourceName;
      state.sourceSize = Number(project.sourceSize) || Number(remoteState.size) || state.sourceSize;
      state.sourceMime = remoteState.content_type || sourceMime;
    }
    const cacheKey = sourceFile ? makeCacheKey(sourceFile) : state.cacheKey;
    const cloudCache = {
        sourceName,
        sourceSize: sourceFile?.size || state.sourceSize,
        sourceMime: sourceFile?.type || state.sourceMime,
        pageCount: Number(remoteState.page_count || remoteState.pageCount || state.pageCount || project.pageCount || 0),
        updatedAt: remoteState.updated_at || remoteState.updatedAt || new Date().toISOString(),
        remoteBookId: project.remoteBookId,
        ocrProfile: remoteState.ocr_profile || remoteState.ocrProfile || DEFAULT_OCR_PROFILE,
        ocrResults: remoteState.ocr_results || remoteState.ocrResults || {},
        translationResults: remoteState.translation_results || remoteState.translationResults || {},
        ocrQualityReviews: remoteState.ocrQualityReviews || [],
    };
    const previousLocalCache = readProofreadCache(cacheKey);
    const { payload: restoredCache, pendingPages } = mergeNewerLocalCloudState(
      cloudCache, previousLocalCache, project.remoteBookId,
    );
    if (pendingPages.length && previousLocalCache && !window.localStorage.getItem(`${cacheKey}:before-cloud-restore`)) {
      try { window.localStorage.setItem(`${cacheKey}:before-cloud-restore`, previousLocalCache); }
      catch (error) { console.warn("Could not preserve pre-restore local cache", error); }
    }
    const restored = restoreCachedResults(restoredCache);
    requireRestoredCloudResults(restoredCache, restored);
    if (state.remoteServerPdf) {
      // The preview runs independently. New collaborators have no cached text
      // to display while it is pending, so restore the cloud panels now.
      updateOcrPanelForPage();
      updateTranslationPanelForPage();
    } else {
      await renderCurrentPage();
    }
    state.remotePageRevisions = remoteState.page_revisions || {};
    state.remotePageSnapshots = makeRemotePageSnapshots({
      ocrResults: serializeResultMap(state.ocrResults),
      translationResults: serializeResultMap(state.translationResults),
      ocrQualityReviews: state.ocrQualityReviews,
    });
    for (const page of pendingPages) {
      state.remotePageSnapshots[page] = remotePageFingerprint(cloudCache, page);
    }
    state.remoteDeferredPages = new Set(pendingPages);
    state.remoteRestoreInFlight = false;
    state.remoteRestoreComplete = true;
    state.remoteStateLoadError = "";
    if (els.collabRetryLoad) els.collabRetryLoad.hidden = true;
    if (isCloudDeployment() && project.remoteBookId) {
      const url = new URL(window.location.href);
      url.searchParams.set("book_id", project.remoteBookId);
      url.searchParams.set("workflow", workflow);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (els.sourceRetryButton) {
      els.sourceRetryButton.hidden = !state.remotePreviewError;
      els.sourceRetryButton.textContent = "重试加载当前页";
    }
    setCollaborationFeedback("");
    if (els.collabRetrySync) {
      els.collabRetrySync.hidden = !pendingPages.length;
      els.collabRetrySync.textContent = pendingPages.length ? "同步本机校对" : "重试云端同步";
    }
    if (state.remotePreviewError) {
      setStatus(`云端校对内容已恢复；原文预览加载失败：${state.remotePreviewError}。请重试加载当前页。`, "warn");
    } else if (pendingPages.length && !remoteState.collaboration_degraded) {
      setStatus(`已保留本机第 ${pendingPages.join("、")} 页较新的校对内容；请复核后点击“同步本机校对”。`, "warn");
    } else {
      setStatus(remoteState.collaboration_degraded
        ? `已打开“${sourceName}”及云端最近保存的校对进度。${remoteState.collaboration_message || "协作数据库暂不可用，修改暂时无法同步。"}`
        : `已恢复“${sourceName}”及云端校对进度。`, remoteState.collaboration_degraded ? "warn" : "ok");
    }
    updateCollaborationPageNumber();
  } catch (error) {
    if (requestId !== state.documentRequestId) return;
    state.remoteRestoreInFlight = false;
    state.remoteStateLoadError = String(error.message || error);
    if (els.collabRetryLoad && state.pageCount) els.collabRetryLoad.hidden = false;
    setCollaborationFeedback(`云端校对内容恢复失败：${error.message || error}；请点击“重试加载校对”。`, true);
    if (error.status === 401 && cloudLibrary.authMode === "collaboration") {
      requestCollaborationLogin(project, workflow);
      return;
    }
    if (!state.pageCount || els.emptyState.style.display !== "none") {
      els.emptyState.style.display = "grid";
      els.emptyState.textContent = `云端 PDF 首页载入失败：${error.name === "AbortError" ? "请求超时" : error.message || error}。请点下方按钮重试。`;
      if (els.sourceRetryButton) els.sourceRetryButton.hidden = false;
    }
    setStatus(`云端项目恢复失败：${error.message || error}`, "error");
  }
}

function requireRestoredCloudResults(cloudCache, restored) {
  const savedPages = Object.keys(cloudCache.ocrResults || {}).length + Object.keys(cloudCache.translationResults || {}).length;
  if (savedPages && !restored) throw new Error("校对内容恢复失败，云端数据仍保留；请重试加载校对");
}

async function fetchCloudBookState(url, options = {}, timeoutMs = 30000) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchCloudBookStateOnce(url, options, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt || [401, 403, 404, 409].includes(error.status)) throw error;
      setCollaborationFeedback("云端校对状态读取较慢，正在自动重试…");
    }
  }
  throw lastError;
}

async function fetchCloudBookStateOnce(url, options, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const payload = await response.json().catch(() => {
          throw new Error("云端校对状态响应不完整");
        });
        if (!response.ok) throw Object.assign(new Error(payload.detail || `状态 HTTP ${response.status}`), { status: response.status });
        if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
            !payload.ocr_results && !payload.ocrResults && !payload.translation_results && !payload.translationResults) {
          throw new Error("云端校对状态缺少识别结果");
        }
        return payload;
      })(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => {
          reject(new Error("云端校对状态请求超时"));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function mergeNewerLocalCloudState(cloudCache, localRaw, bookId) {
  try {
    const local = JSON.parse(localRaw || "null");
    if (local?.remoteBookId !== bookId || Number(local.pageCount) !== Number(cloudCache.pageCount)) {
      return { payload: cloudCache, localPending: false, pendingPages: [] };
    }
    const localOcr = local.ocrResults && typeof local.ocrResults === "object" ? local.ocrResults : {};
    const localTranslation = local.translationResults && typeof local.translationResults === "object" ? local.translationResults : {};
    const localReviews = Array.isArray(local.ocrQualityReviews) ? local.ocrQualityReviews : [];
    const cloudReviews = Array.isArray(cloudCache.ocrQualityReviews) ? cloudCache.ocrQualityReviews : [];
    const pages = new Set([...Object.keys(localOcr), ...Object.keys(localTranslation)]);
    localReviews.forEach((row) => { if (row.pageNum != null || row.page_num != null) pages.add(String(row.pageNum ?? row.page_num)); });
    const ocrResults = { ...cloudCache.ocrResults };
    const translationResults = { ...cloudCache.translationResults };
    let ocrQualityReviews = [...cloudReviews];
    const pendingPages = [];
    const timestamp = (value) => Date.parse(value || "") || 0;
    for (const page of pages) {
      const localPageReviews = localReviews.filter((row) => String(row.pageNum ?? row.page_num) === page);
      const cloudPageReviews = cloudReviews.filter((row) => String(row.pageNum ?? row.page_num) === page);
      const localTime = Math.max(timestamp(localOcr[page]?.updatedAt), timestamp(localTranslation[page]?.updatedAt),
        ...localPageReviews.map((row) => timestamp(row.reviewedAt)));
      const cloudTime = Math.max(timestamp(cloudCache.ocrResults?.[page]?.updatedAt),
        timestamp(cloudCache.translationResults?.[page]?.updatedAt),
        ...cloudPageReviews.map((row) => timestamp(row.reviewedAt)));
      const cloudHasPage = cloudCache.ocrResults?.[page] != null || cloudCache.translationResults?.[page] != null || cloudPageReviews.length > 0;
      if (cloudHasPage && (!localTime || localTime <= cloudTime)) continue;
      const visibleContent = (ocr, translation, reviews) => JSON.stringify({
        ocrText: ocr?.text || "",
        lines: (ocr?.lines || []).map((line) => ({
          text: line.text || "",
          deleted: Boolean(line.deleted),
          manualBaselineText: line.manualBaselineText ?? null,
          manuallyEdited: Boolean(line.manuallyEdited),
          manualErrorChars: Number(line.manualErrorChars || 0),
          manualEditRanges: line.manualEditRanges || [],
        })),
        compare: ocr?.compare || null,
        translationText: translation?.text || "",
        reviews,
      });
      if (cloudHasPage && visibleContent(localOcr[page], localTranslation[page], localPageReviews) ===
          visibleContent(cloudCache.ocrResults?.[page], cloudCache.translationResults?.[page], cloudPageReviews)) continue;
      if (localOcr[page] != null && (!cloudHasPage || timestamp(localOcr[page].updatedAt) > timestamp(cloudCache.ocrResults?.[page]?.updatedAt))) ocrResults[page] = localOcr[page];
      if (localTranslation[page] != null && (!cloudHasPage || timestamp(localTranslation[page].updatedAt) > timestamp(cloudCache.translationResults?.[page]?.updatedAt))) translationResults[page] = localTranslation[page];
      if (localPageReviews.length && (!cloudHasPage || Math.max(...localPageReviews.map((row) => timestamp(row.reviewedAt))) >
          Math.max(0, ...cloudPageReviews.map((row) => timestamp(row.reviewedAt))))) {
        ocrQualityReviews = ocrQualityReviews.filter((row) => String(row.pageNum ?? row.page_num) !== page).concat(localPageReviews);
      }
      const merged = { ocrResults, translationResults, ocrQualityReviews };
      if (remotePageFingerprint(merged, page) !== remotePageFingerprint(cloudCache, page)) pendingPages.push(page);
    }
    pendingPages.sort((a, b) => Number(a) - Number(b));
    return {
      payload: {
        ...cloudCache,
        updatedAt: pendingPages.length ? local.updatedAt : cloudCache.updatedAt,
        ocrProfile: OCR_PROFILES[local.ocrProfile] ? local.ocrProfile : cloudCache.ocrProfile,
        ocrResults,
        translationResults,
        ocrQualityReviews,
      },
      localPending: pendingPages.length > 0,
      pendingPages,
    };
  } catch (error) {
    console.warn("Failed to compare local and cloud proofreading state", error);
    return { payload: cloudCache, localPending: false, pendingPages: [] };
  }
}

function requestCollaborationLogin(project, workflow) {
  cloudLibrary.pendingResume = { project, workflow };
  if (els.sourceRetryButton) els.sourceRetryButton.hidden = true;
  cloudLibrary.actor = "";
  cloudLibrary.loaded = false;
  els.collaborationActorLabel.textContent = "";
  els.collabHeaderName.hidden = false;
  els.collabHeaderPassword.hidden = !cloudLibrary.passwordRequired;
  els.collabHeaderLogin.hidden = false;
  els.collabHeaderLogout.hidden = true;
  els.cloudLibraryAuth.hidden = false;
  els.cloudLibraryFiles.hidden = true;
  setStatus("协作登录已失效，请在右上角重新登录；登录后会继续打开当前书籍。", "warn");
}

async function loadRemotePdfWithRanges(sourceUrl, descriptor, remoteBookId, requestId, httpHeaders = {}) {
  if (requestId !== state.documentRequestId) return false;
  const existingProject = getHomeProjects().find((project) => project.remoteBookId === remoteBookId);
  resetDocumentState();
  state.sourceName = descriptor.name || "远程项目.pdf";
  state.sourceSize = Number(descriptor.size) || 0;
  state.sourceMime = descriptor.type || "application/pdf";
  state.cacheKey = existingProject?.cacheKey || makeCacheKey({ name: state.sourceName, size: state.sourceSize, type: state.sourceMime });
  state.remoteBookId = remoteBookId;
  els.sourceTitle.textContent = state.sourceName;
  els.emptyState.textContent = `正在读取“${state.sourceName}”首页，请稍候…`;
  if (els.sourceRetryButton) els.sourceRetryButton.textContent = "重试加载当前页";
  window.localStorage.setItem(ACTIVE_PROJECT_KEY, state.cacheKey);
  setStatus(`正在载入“${state.sourceName}”首页...`, "warn");
  if (isCloudDeployment()) {
    return loadRemotePdfWithServerPages(remoteBookId, requestId);
  }
  return loadPdf(null, { sourceUrl, useRangeRequests: true, requestId, httpHeaders });
}

async function loadRemotePdfWithServerPages(bookId, requestId) {
  state.remoteServerPdf = true;
  state.remotePreviewError = "";
  state.remoteFirstPageDeadline = Date.now() + 120000;
  state.sourceType = "pdf";
  const response = await fetchWithCloudTimeout(
    `${window.location.origin}/api/books/${encodeURIComponent(bookId)}/document-info`,
    { credentials: "same-origin" }, 120000,
  );
  const info = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(info.detail || `云端 PDF 页数 HTTP ${response.status}`), { status: response.status });
  if (requestId !== state.documentRequestId) return false;
  if (!Number.isInteger(info.page_count) || info.page_count < 1) throw new Error("云端 PDF 没有可显示的页面");
  state.pageNum = 1;
  state.pageCount = info.page_count;
  els.ocrTitle.textContent = "第 1 页 OCR";
  restoreCachedResults();
  refreshControls();
  setStatus(`已读取 ${state.pageCount} 页，正在生成首页原文…`, "warn");
  // Do not gate cloud-state restoration on downloading/decoding the preview.
  // renderCurrentPage owns the visible error and retry control.
  void renderCurrentPage().then(() => {
    if (requestId !== state.documentRequestId) return;
    state.remoteFirstPageDeadline = 0;
    scheduleIdleWork(() => {
      if (requestId === state.documentRequestId) {
        void primeCurrentPageDirectText();
        buildPdfThumbnails();
      }
    });
  }).catch((error) => console.warn("First page preview unavailable", error));
  return true;
}

async function findCachedRemoteSource(project) {
  const cachedProject = project.cacheKey
    ? project
    : getHomeProjects().find((item) => item.remoteBookId === project.remoteBookId);
  if (!cachedProject?.cacheKey || cachedProject.remoteBookId !== project.remoteBookId) return null;
  try {
    const file = await getStoredSourceFile(cachedProject.cacheKey);
    return file instanceof File && makeCacheKey(file) === cachedProject.cacheKey ? file : null;
  } catch (error) {
    console.warn("Failed to read cached remote source", error);
    return null;
  }
}

async function initializeCloudLibrary() {
  if (!els.cloudLibrary) return;
  const retryAfterFailedBoot = cloudLibrary.bootAttempted && cloudLibrary.authMode === "unknown";
  cloudLibrary.bootAttempted = true;
  els.cloudLibrary.hidden = false;
  cloudLibrary.apiBaseUrl = cloudLibraryApiOrigin();
  if (els.collaborationRetryButton) els.collaborationRetryButton.hidden = true;
  if (isCloudDeployment()) {
    els.collaborationLoginBar.hidden = false;
    els.collaborationActorLabel.textContent = "正在连接协作服务…";
  }
  els.cloudLibraryAuth.hidden = false;
  els.cloudLibraryAuthTitle.textContent = "正在连接阿里云 OSS";
  els.cloudLibraryAuthHint.textContent = "请稍候，正在检查协作者登录状态。";
  setCloudLibraryStatus("正在连接云端目录…");
  try {
    const response = await fetchWithCloudTimeout(`${cloudLibrary.apiBaseUrl}/api/collaboration/config`, {}, 15000);
    if (!response.ok) throw new Error(`协作配置 HTTP ${response.status}`);
    const config = await response.json();
    cloudLibrary.authMode = config.enabled ? "collaboration" : "legacy";
    cloudLibrary.names = Array.isArray(config.names) ? config.names : [];
    cloudLibrary.passwordRequired = config.password_required !== false;
    const nameSelect = document.getElementById("collaboratorName");
    for (const select of [nameSelect, els.collabHeaderName]) if (select) {
      select.replaceChildren(...cloudLibrary.names.map((name) => new Option(name, name)));
      select.hidden = !config.enabled;
    }
    if (config.enabled) {
      document.getElementById("cloudLibraryAuthTitle").textContent = "协作者登录";
      document.getElementById("cloudLibraryAuthHint").textContent = cloudLibrary.passwordRequired
        ? "选择姓名并输入共用口令；协作修改记录保存在阿里云数据库。"
        : "测试阶段选择姓名即可登录；协作修改记录保存在阿里云数据库。";
      if (isLocalWorkbench()) {
        try { cloudLibrary.accessToken = window.sessionStorage.getItem(LOCAL_CLOUD_LIBRARY_SESSION_KEY) || ""; } catch (_) { cloudLibrary.accessToken = ""; }
      }
      const meHeaders = cloudLibrary.accessToken ? { Authorization: `Bearer ${cloudLibrary.accessToken}` } : {};
      const meResponse = await fetchWithCloudTimeout(`${cloudLibrary.apiBaseUrl}/api/collaboration/me`, {
        credentials: isCloudDeployment() ? "same-origin" : "omit",
        headers: meHeaders,
      }, 15000);
      if (meResponse.ok) cloudLibrary.actor = (await meResponse.json()).name || "";
      else if (meResponse.status !== 401) throw new Error(`协作者状态 HTTP ${meResponse.status}`);
      else if (isLocalWorkbench() && cloudLibrary.accessToken) {
        cloudLibrary.accessToken = "";
        try { window.sessionStorage.removeItem(LOCAL_CLOUD_LIBRARY_SESSION_KEY); } catch (_) { /* Ignore storage restrictions. */ }
      }
    } else {
      try { cloudLibrary.token = window.sessionStorage.getItem(CLOUD_LIBRARY_SESSION_KEY) || ""; } catch (_) { cloudLibrary.token = ""; }
    }
  } catch (error) {
    cloudLibrary.authMode = "unknown";
    els.cloudLibraryAuthTitle.textContent = "协作服务连接失败";
    els.cloudLibraryAuthHint.textContent = "点“刷新”或“重试连接”后继续使用云端目录。";
    els.collaborationActorLabel.textContent = "协作服务连接失败";
    if (els.collaborationRetryButton) els.collaborationRetryButton.hidden = !isCloudDeployment();
    setCloudLibraryStatus(`连接失败：${error.name === "AbortError" ? "请求超时" : error.message || error}`, true);
    return;
  }
  els.cloudLibraryPassword.hidden = cloudLibrary.authMode === "collaboration" && !cloudLibrary.passwordRequired;
  els.cloudLibraryUnlockButton.hidden = false;
  els.cloudLibraryUnlockButton.textContent = cloudLibrary.authMode === "collaboration" ? "登录协作" : "解锁";
  if (cloudLibrary.authMode === "legacy") {
    els.cloudLibraryAuthTitle.textContent = "云端目录已保护";
    els.cloudLibraryAuthHint.textContent = "输入文档访问口令后，查看私有 OSS 文件。";
  }
  els.cloudLibraryAuth.hidden = cloudLibrary.authMode === "collaboration" ? Boolean(cloudLibrary.actor) : Boolean(cloudLibrary.token);
  els.cloudLibraryFiles.hidden = true;
  const panel = document.getElementById("collaborationPanel");
  if (panel) panel.hidden = !isCloudDeployment() || cloudLibrary.authMode !== "collaboration";
  if (els.collaborationLoginBar) els.collaborationLoginBar.hidden = !isCloudDeployment() || cloudLibrary.authMode !== "collaboration";
  els.collaborationActorLabel.textContent = cloudLibrary.actor ? `协作者：${cloudLibrary.actor}` : "";
  els.collabHeaderName.hidden = Boolean(cloudLibrary.actor);
  els.collabHeaderPassword.hidden = Boolean(cloudLibrary.actor) || !cloudLibrary.passwordRequired;
  els.collabHeaderPassword.disabled = !cloudLibrary.passwordRequired;
  els.collabHeaderLogin.hidden = Boolean(cloudLibrary.actor);
  els.collabHeaderLogout.hidden = !cloudLibrary.actor;
  if (cloudLibrary.authMode === "collaboration") els.cloudLibraryAuth.hidden = Boolean(cloudLibrary.actor);
  if (isLocalWorkbench()) {
    if (els.cloudLibraryAuthTitle) els.cloudLibraryAuthTitle.textContent = "连接云端 OSS 目录";
    if (els.cloudLibraryAuthHint) els.cloudLibraryAuthHint.textContent = "使用 Zeabur 协作者账号登录后，可从本地工作台浏览和打开云端文件。";
  }
  if (els.cloudLibraryUploadButton) els.cloudLibraryUploadButton.hidden = !cloudLibrary.actor && !cloudLibrary.token;
  setCloudLibraryStatus("");
  if (cloudLibrary.actor || cloudLibrary.token) void refreshCloudLibrary();
  if (retryAfterFailedBoot) void restoreRouteFromLocation();
}

async function fetchWithCloudTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  return fetch(url, { ...options, signal: controller.signal });
}

async function unlockCloudLibrary() {
  const token = (els.collabHeaderPassword?.value || els.cloudLibraryPassword?.value || "").trim();
  if (cloudLibrary.authMode !== "collaboration" && !token) {
    setCloudLibraryStatus("请输入文档访问口令。", true);
    return;
  }
  if (cloudLibrary.authMode === "collaboration") {
    try {
      const response = await fetch(`${cloudLibrary.apiBaseUrl || cloudLibraryApiOrigin()}/api/collaboration/login`, {
        method: "POST", credentials: isCloudDeployment() ? "same-origin" : "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: isLocalWorkbench()
            ? document.getElementById("collaboratorName")?.value || ""
            : els.collabHeaderName?.value || document.getElementById("collaboratorName")?.value || "",
          password: token,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
      cloudLibrary.actor = payload.name;
      if (isLocalWorkbench()) {
        if (!payload.access_token) throw new Error("云端未返回本地会话凭证，请刷新本地页面后重试");
        cloudLibrary.accessToken = payload.access_token;
        try { window.sessionStorage.setItem(LOCAL_CLOUD_LIBRARY_SESSION_KEY, cloudLibrary.accessToken); } catch (_) { /* Session token remains available for this page. */ }
      }
      els.collaborationActorLabel.textContent = `协作者：${cloudLibrary.actor}`;
      els.collabHeaderName.hidden = true; els.collabHeaderPassword.hidden = true; els.collabHeaderLogin.hidden = true; els.collabHeaderLogout.hidden = false;
      els.collabHeaderPassword.value = "";
      els.cloudLibraryAuth.hidden = true;
      document.getElementById("collaborationPanel").hidden = !isCloudDeployment();
      const pendingResume = cloudLibrary.pendingResume;
      cloudLibrary.pendingResume = null;
      if (pendingResume) void resumeRemoteProject(pendingResume.project, pendingResume.workflow);
      else void restoreRouteFromLocation();
    } catch (error) { setCloudLibraryStatus(`登录失败：${error.message || error}`, true); return; }
  } else cloudLibrary.token = token;
  els.cloudLibraryPassword.value = "";
  await refreshCloudLibrary();
}

function setCloudLibraryStatus(message, isError = false) {
  if (!els.cloudLibraryStatus) return;
  els.cloudLibraryStatus.textContent = message;
  els.cloudLibraryStatus.classList.toggle("is-error", isError);
  els.cloudLibraryStatus.hidden = !message;
}

async function refreshCloudLibrary() {
  if (cloudLibrary.loading) return;
  if (cloudLibrary.authMode === "unknown") return initializeCloudLibrary();
  if (!cloudLibrary.token && !(cloudLibrary.authMode === "collaboration" && cloudLibrary.actor)) {
    els.cloudLibraryAuth.hidden = false;
    els.cloudLibraryFiles.hidden = true;
    return;
  }
  cloudLibrary.loading = true;
  setCloudLibraryStatus("正在读取云端目录…");
  try {
    const headers = cloudLibrary.authMode === "legacy" ? { Authorization: `Bearer ${cloudLibrary.token}` } : {};
    if (isLocalWorkbench() && cloudLibrary.accessToken) headers.Authorization = `Bearer ${cloudLibrary.accessToken}`;
    const response = await fetchWithCloudTimeout(`${cloudLibrary.apiBaseUrl || cloudLibraryApiOrigin()}/api/library`, {
      credentials: isCloudDeployment() ? "same-origin" : "omit", headers,
    }, 30000);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.detail || `HTTP ${response.status}`), { status: response.status });
    cloudLibrary.items = Array.isArray(payload.items) ? payload.items.filter((item) => typeof item.path === "string") : [];
    cloudLibrary.loaded = true;
    if (cloudLibrary.authMode === "legacy") try { window.sessionStorage.setItem(CLOUD_LIBRARY_SESSION_KEY, cloudLibrary.token); } catch (_) { /* Session storage can be unavailable. */ }
    els.cloudLibraryPassword.value = "";
    els.cloudLibraryAuth.hidden = true;
    els.cloudLibraryFiles.hidden = false;
    if (els.cloudLibraryUploadButton) els.cloudLibraryUploadButton.hidden = false;
    els.cloudLibraryCount.textContent = `${cloudLibrary.items.length} 项`;
    setCloudLibraryStatus(payload.truncated ? "目录超过 1000 项，仅显示前 1000 项。" : "");
    renderCloudLibraryRows();
  } catch (error) {
    if (error.status === 401) {
      cloudLibrary.token = "";
      cloudLibrary.actor = "";
      cloudLibrary.accessToken = "";
      cloudLibrary.loaded = false;
      try { window.sessionStorage.removeItem(CLOUD_LIBRARY_SESSION_KEY); } catch (_) { /* Ignore storage restrictions. */ }
      try { window.sessionStorage.removeItem(LOCAL_CLOUD_LIBRARY_SESSION_KEY); } catch (_) { /* Ignore storage restrictions. */ }
      els.cloudLibraryAuth.hidden = false;
      els.cloudLibraryFiles.hidden = true;
      if (els.cloudLibraryUploadButton) els.cloudLibraryUploadButton.hidden = true;
      if (cloudLibrary.authMode === "collaboration") {
        els.collaborationActorLabel.textContent = "";
        els.collabHeaderName.hidden = false; els.collabHeaderPassword.hidden = !cloudLibrary.passwordRequired; els.collabHeaderLogin.hidden = false; els.collabHeaderLogout.hidden = true;
      }
    }
    setCloudLibraryStatus(`云端目录读取失败：${error.name === "AbortError" ? "请求超时，请点刷新重试" : error.message || error}`, true);
  } finally {
    cloudLibrary.loading = false;
  }
}

async function uploadCloudLibraryFile(file) {
  if (cloudLibrary.uploading || (!cloudLibrary.actor && !cloudLibrary.token)) return;
  cloudLibrary.uploading = true;
  els.cloudLibraryUploadButton.disabled = true;
  els.cloudLibraryUploadInput.disabled = true;
  const formData = new FormData();
  formData.append("path", cloudLibrary.path);
  formData.append("file", file);
  setCloudLibraryStatus(`正在上传“${file.name}”… 0%`);
  try {
    const payload = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${cloudLibrary.apiBaseUrl || cloudLibraryApiOrigin()}/api/library/upload`);
      if (isCloudDeployment()) xhr.withCredentials = true;
      const bearer = isLocalWorkbench() ? cloudLibrary.accessToken : cloudLibrary.authMode === "legacy" ? cloudLibrary.token : "";
      if (bearer) xhr.setRequestHeader("Authorization", `Bearer ${bearer}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setCloudLibraryStatus(`正在上传“${file.name}”… ${Math.min(99, Math.round(event.loaded / event.total * 100))}%`);
      };
      xhr.onload = () => {
        let response = {};
        try { response = JSON.parse(xhr.responseText || "{}"); } catch (_) { /* Report the status below. */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(response);
        else reject(new Error(response.detail || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("网络连接失败"));
      xhr.onabort = () => reject(new Error("上传已取消"));
      xhr.send(formData);
    });
    const refreshed = await refreshCloudLibrary();
    setCloudLibraryStatus(refreshed ? `已上传“${payload.path || file.name}”。` : "文件已上传，但目录刷新失败；请点击“刷新”查看。", !refreshed);
  } catch (error) {
    setCloudLibraryStatus(`上传失败：${error.message || error}`, true);
  } finally {
    cloudLibrary.uploading = false;
    els.cloudLibraryUploadButton.disabled = false;
    els.cloudLibraryUploadInput.disabled = false;
  }
}

function setCollaborationFeedback(message, isError = false) {
  if (!els.collabFeedback) return;
  els.collabFeedback.textContent = message;
  els.collabFeedback.classList.toggle("is-error", isError);
}

function updateCollaborationPageNumber() {
  if (cloudLibrary.authMode !== "collaboration" || !state.remoteBookId || !els.collaborationPanel || els.collaborationPanel.hidden) return;
  els.collabPageNumber.textContent = String(state.pageNum);
}

async function showPageHistory() {
  if (!state.remoteBookId) return setCollaborationFeedback("请先打开一本文档。", true);
  try {
    const response = await fetch(`${window.location.origin}/api/books/${encodeURIComponent(state.remoteBookId)}/history/${state.pageNum}`, { credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
    const rows = payload.items || [];
    setCollaborationFeedback(rows.length ? rows.map((row) => `${row.created_at} · ${row.actor} · ${row.event_type}`).join("\n") : "本页暂无修改记录。");
    if (rows.length) window.alert(rows.map((row) => `${row.created_at}\n${row.actor} · ${row.event_type === "edit" ? "保存修改" : row.event_type}\n修改前：${JSON.stringify(row.before)}\n修改后：${JSON.stringify(row.after)}`).join("\n\n"));
  } catch (error) { setCollaborationFeedback(`读取历史失败：${error.message || error}`, true); }
}

async function logoutCollaboration() {
  if (isLocalWorkbench()) {
    try { window.sessionStorage.removeItem(LOCAL_CLOUD_LIBRARY_SESSION_KEY); } catch (_) { /* Ignore storage restrictions. */ }
    cloudLibrary.accessToken = "";
  } else {
    await fetch(`${window.location.origin}/api/collaboration/logout`, { method: "POST", credentials: "same-origin" }).catch(() => {});
  }
  cloudLibrary.actor = "";
  cloudLibrary.loaded = false;
  els.cloudLibraryAuth.hidden = false;
  els.cloudLibraryFiles.hidden = true;
  els.collaborationPanel.hidden = true;
  els.collaborationActorLabel.textContent = "";
  els.collabHeaderName.hidden = false; els.collabHeaderPassword.hidden = !cloudLibrary.passwordRequired; els.collabHeaderLogin.hidden = false; els.collabHeaderLogout.hidden = true;
  els.cloudLibraryAuth.hidden = false;
  setCloudLibraryStatus("已退出协作登录。");
}

function renderCloudLibraryRows() {
  const currentPath = cloudLibrary.path;
  const folders = new Set();
  const files = [];
  for (const item of cloudLibrary.items) {
    if (!item.path.startsWith(currentPath)) continue;
    const remainder = item.path.slice(currentPath.length);
    const slash = remainder.indexOf("/");
    if (slash >= 0) folders.add(remainder.slice(0, slash));
    else if (remainder) files.push(item);
  }
  const collator = new Intl.Collator("zh-CN", { numeric: true });
  files.sort((a, b) => collator.compare(a.path, b.path));
  const breadcrumb = els.cloudLibraryBreadcrumb;
  breadcrumb.replaceChildren();
  let crumbPath = "";
  ["待识别文档", ...currentPath.split("/").filter(Boolean)].forEach((name, index) => {
    if (index) crumbPath += `${name}/`;
    const targetPath = crumbPath;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.className = "finder-crumb";
    if (index === 0 || targetPath !== currentPath) button.addEventListener("click", () => {
      cloudLibrary.path = targetPath;
      renderCloudLibraryRows();
    });
    else button.setAttribute("aria-current", "page");
    breadcrumb.appendChild(button);
  });

  const rows = els.cloudLibraryRows;
  rows.replaceChildren();
  for (const folder of [...folders].sort(collator.compare)) {
    rows.appendChild(makeCloudLibraryRow(folder, "folder", "—", "文件夹", () => {
      cloudLibrary.path = `${currentPath}${folder}/`;
      renderCloudLibraryRows();
    }));
  }
  for (const file of files) {
    const name = file.path.slice(currentPath.length);
    const updatedAt = file.updated_at ? new Date(file.updated_at) : null;
    const date = updatedAt && !Number.isNaN(updatedAt.getTime())
      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(updatedAt) : "—";
    rows.appendChild(makeCloudLibraryRow(name, "file-text", date,
      cloudLibraryFileKind(name), () => void openCloudLibraryFile(file),
      formatCloudLibrarySize(file.size)));
  }
  if (!folders.size && !files.length) {
    const empty = document.createElement("p");
    empty.className = "finder-empty";
    empty.textContent = "此文件夹中没有文档。";
    rows.appendChild(empty);
  }
  if (window.lucide) window.lucide.createIcons();
}

function cloudLibraryFileKind(name) {
  const extension = name.split(".").pop().toLowerCase();
  if (extension === "pdf") return "PDF 文稿";
  if (["png", "jpg", "jpeg", "tif", "tiff"].includes(extension)) return "图像";
  if (extension === "docx") return "Word 文档";
  if (["md", "markdown"].includes(extension)) return "Markdown 文档";
  if (extension === "txt") return "纯文本";
  return "文件";
}

function makeCloudLibraryRow(name, icon, date, kind, onClick, size = "—") {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "finder-row";
  row.addEventListener("click", onClick);
  const nameCell = document.createElement("span");
  nameCell.className = "finder-row-name";
  const iconElement = document.createElement("i");
  iconElement.dataset.lucide = icon;
  nameCell.append(iconElement, document.createTextNode(name));
  for (const value of [nameCell, date, size, kind]) {
    const cell = document.createElement("span");
    cell.className = "finder-cell";
    if (typeof value === "string") cell.textContent = value;
    else cell.appendChild(value);
    row.appendChild(cell);
  }
  return row;
}

function formatCloudLibrarySize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1048576) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1048576).toFixed(1)} MB`;
}

async function openCloudLibraryFile(file) {
  const requestId = ++state.documentRequestId;
  setCloudLibraryStatus(`正在打开“${file.path}”…`);
  try {
    const headers = { "Content-Type": "application/json", ...(cloudLibrary.authMode === "legacy" ? { Authorization: `Bearer ${cloudLibrary.token}` } : {}) };
    if (isLocalWorkbench() && cloudLibrary.accessToken) headers.Authorization = `Bearer ${cloudLibrary.accessToken}`;
    const response = await fetch(`${cloudLibrary.apiBaseUrl || cloudLibraryApiOrigin()}/api/library/open`, {
      method: "POST",
      credentials: isCloudDeployment() ? "same-origin" : "omit",
      headers,
      body: JSON.stringify({ path: file.path }),
    });
    const book = await response.json().catch(() => ({}));
    if (requestId !== state.documentRequestId) return;
    if (!response.ok || !book.book_id) throw new Error(book.detail || `HTTP ${response.status}`);
    setCloudLibraryStatus("");
    await resumeRemoteProject({
      sourceName: book.name, sourceSize: book.size, sourceMime: book.content_type,
      remoteBookId: book.book_id,
      apiBaseUrl: cloudLibrary.apiBaseUrl || cloudLibraryApiOrigin(),
      apiAccessToken: isLocalWorkbench() ? cloudLibrary.accessToken : "",
    }, "ocr", { requestId });
  } catch (error) {
    if (requestId !== state.documentRequestId) return;
    setCloudLibraryStatus(`打开文档失败：${error.message || error}`, true);
  }
}

function renderHomeDashboard() {
  const projects = getHomeProjects();
  const ocrInProgress = projects.filter(isOcrProjectInProgress).length;
  const translationInProgress = projects.filter(isTranslationProjectInProgress).length;
  const ocrReady = projects.filter((project) => project.ocrCount > 0).length;
  const translationReady = projects.filter((project) => project.translationCount > 0).length;

  if (els.homeOcrStats) {
    els.homeOcrStats.textContent = projects.length
      ? `${projects.length} 个本机项目，${ocrInProgress} 个正在校对，${ocrReady} 个已有 OCR 结果`
      : "暂无本机项目";
  }
  if (els.homeTranslationStats) {
    els.homeTranslationStats.textContent = projects.length
      ? `${projects.length} 个本机项目，${translationInProgress} 个正在翻译，${translationReady} 个已有译文`
      : "暂无本机项目";
  }
  setOptionalDisabled("homeContinueOcrTaskButton", ocrInProgress === 0);
  setOptionalDisabled("homeContinueTranslationTaskButton", translationInProgress === 0);
  renderHomeProjectList(projects);
}

function renderHomeProjectList(projects) {
  if (!els.homeProjectList) return;
  const filter = HOME_PROJECT_FILTERS.has(state.homeProjectFilter) ? state.homeProjectFilter : "all";
  const filtered = projects.filter((project) => {
    if (filter === "ocr") return project.ocrCount > 0 || project.pageCount > 0;
    if (filter === "translation") return project.translationCount > 0 || project.pageCount > 0;
    return true;
  });
  els.homeProjectList.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "home-project-filter-summary";
  summary.textContent = makeHomeProjectFilterSummary(filter, filtered.length, projects.length);
  els.homeProjectList.appendChild(summary);

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "home-project-empty";
    empty.textContent = filter === "translation"
      ? "还没有可浏览的藏译中项目。"
      : filter === "ocr"
        ? "还没有可浏览的 OCR 项目。"
        : "还没有本机项目。";
    els.homeProjectList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((project) => {
    const card = document.createElement("article");
    card.className = "home-project-card";

    const projectId = project.kind === "folder" ? project.id : project.cacheKey;
    const titleRow = document.createElement("div");
    titleRow.className = "home-project-title-row";
    const title = document.createElement("h4");
    title.textContent = project.sourceName || "未命名项目";
    const deleteButton = document.createElement("button");
    deleteButton.className = "ghost-button compact danger-action home-project-delete";
    deleteButton.type = "button";
    deleteButton.innerHTML = '<i data-lucide="trash-2"></i><span>删除项目</span>';
    deleteButton.title = `删除“${project.sourceName || "未命名项目"}”的浏览器项目记录`;
    deleteButton.addEventListener("click", () => {
      state.pendingHomeProjectDeletionId = projectId;
      renderHomeDashboard();
    });
    titleRow.append(title, deleteButton);

    const deleteConfirm = document.createElement("div");
    deleteConfirm.className = "home-project-delete-confirm";
    deleteConfirm.hidden = state.pendingHomeProjectDeletionId !== projectId;
    const confirmText = document.createElement("span");
    confirmText.textContent = "删除此浏览器项目？";
    const confirmButton = document.createElement("button");
    confirmButton.className = "ghost-button compact danger-action";
    confirmButton.type = "button";
    confirmButton.textContent = "确认删除";
    confirmButton.addEventListener("click", () => {
      void deleteHomeProject(project);
    });
    const cancelButton = document.createElement("button");
    cancelButton.className = "ghost-button compact";
    cancelButton.type = "button";
    cancelButton.textContent = "取消";
    cancelButton.addEventListener("click", () => {
      state.pendingHomeProjectDeletionId = "";
      renderHomeDashboard();
    });
    deleteConfirm.append(confirmText, confirmButton, cancelButton);

    const meta = document.createElement("div");
    meta.className = "home-project-meta";
    meta.append(
      makeHomePill(makeProjectPageLabel(project)),
      makeHomePill(project.sourceMime || project.sourceType || "本机缓存"),
      makeHomePill(formatHomeDate(project.updatedAt)),
    );
    if (project.kind === "folder") {
      meta.append(makeHomePill(`${project.partCount || 0} 个 PDF 分册`));
    }

    const progress = document.createElement("div");
    progress.className = "home-project-progress";
    if (project.kind === "folder") {
      progress.append(makeHomePill(makeFolderProjectRangeLabel(project)));
    } else {
      progress.append(
        makeHomePill(`OCR ${project.ocrCount}/${project.pageCount || 0}`),
        makeHomePill(`译文 ${project.translationCount}/${project.pageCount || 0}`),
      );
    }

    const actions = document.createElement("div");
    actions.className = "home-project-actions";
    if (project.kind === "folder") {
      actions.append(
        makeHomeProjectButton("打开首个分册", "scan-text", () => openFolderProject(project, "ocr")),
        makeHomeProjectButton("重选总文件夹", "folder-open", () => requestFolderProjectSource(project)),
      );
    } else {
      actions.append(
        makeHomeProjectButton("继续校对", "scan-text", () => openHomeProject(project, "ocr")),
        makeHomeProjectButton("继续翻译", "languages", () => openHomeProject(project, "translation")),
      );
    }

    card.append(titleRow, deleteConfirm, meta, progress);
    if (project.kind === "folder") {
      card.append(makeFolderProjectPartsList(project));
    }
    card.append(actions);
    fragment.appendChild(card);
  });
  els.homeProjectList.appendChild(fragment);
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function deleteHomeProject(project) {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再删除项目。", "warn");
    return;
  }

  const projectName = project.sourceName || "未命名项目";
  try {
    if (project.kind === "folder") {
      const remaining = getStoredFolderProjects().filter((item) => item.id !== project.id);
      window.localStorage.setItem(FOLDER_PROJECTS_KEY, JSON.stringify(remaining));
      state.folderProjectFiles.delete(project.id);
      if (state.activeFolderProjectId === project.id) state.activeFolderProjectId = "";
    } else {
      window.localStorage.removeItem(project.cacheKey);
      await proofreadFallbackQueue.catch(() => {});
      if (proofreadFallbackRecords.has(project.cacheKey)) await writeProofreadFallback(project.cacheKey, null);
      await removeStoredSourceFile(project.cacheKey);
      if (window.localStorage.getItem(ACTIVE_PROJECT_KEY) === project.cacheKey) {
        window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      }
      if (project.isActive || state.cacheKey === project.cacheKey) {
        resetDocumentState();
      }
    }
    state.pendingHomeProjectDeletionId = "";
    setStatus(`已删除“${projectName}”的浏览器项目记录。云端文件未删除。`, "ok");
    renderHomeDashboard();
  } catch (error) {
    console.error("Failed to delete home project", error);
    setStatus(`删除“${projectName}”失败：${error.message || error}`, "error");
  }
}

function makeHomeProjectFilterSummary(filter, filteredCount, totalCount) {
  if (filter === "ocr") {
    return `正在显示 OCR 项目：${filteredCount} / ${totalCount}。点击项目卡片中的“继续校对”进入指定项目。`;
  }
  if (filter === "translation") {
    return `正在显示藏译中项目：${filteredCount} / ${totalCount}。点击项目卡片中的“继续翻译”进入指定项目。`;
  }
  return `正在显示全部本机项目：${filteredCount} / ${totalCount}。`;
}

function openHomeProject(project, workflow) {
  if (project.kind === "folder") {
    openFolderProject(project, workflow);
    return;
  }
  if (project.isActive) {
    showWorkbenchView(workflow);
    if (workflow === "ocr") {
      setOcrView("proofread");
    }
    return;
  }
  requestCachedProjectSource(project, workflow);
}

async function openFolderProject(project, workflow = "ocr") {
  const sessionParts = state.folderProjectFiles.get(project.id) || [];
  const firstPart = sessionParts[0];
  if (!firstPart?.file) {
    requestFolderProjectSource(project);
    return;
  }
  state.activeFolderProjectId = project.id;
  showWorkbenchView(workflow === "translation" ? "translation" : "ocr");
  await loadFile(firstPart.file);
  state.activeFolderProjectId = project.id;
  setStatus(`已打开“${project.sourceName}”的第 1 个 PDF 分册。当前版本先以分册为单位校对。`, "ok");
}

function requestFolderProjectSource(project) {
  if (!els.folderInput) {
    setStatus("文件夹选择控件未初始化，请刷新页面后重试。", "error");
    return;
  }
  state.pendingFolderProjectId = project.id;
  setStatus(`请选择“${project.sourceName}”的总文件夹，以恢复 ${project.partCount || 0} 个 PDF 分册。`, "warn");
  els.folderInput.value = "";
  els.folderInput.click();
}

function makeProjectPageLabel(project) {
  if (project.kind === "folder" && !project.hasEstimatedPageCount) {
    return "页数待加载";
  }
  return `${project.pageCount || 0} 页`;
}

function makeFolderProjectRangeLabel(project) {
  const parts = Array.isArray(project.parts) ? project.parts : [];
  const ranges = parts
    .filter((part) => part.pageStart && part.pageEnd)
    .slice(0, 2)
    .map((part) => `${part.pageStart}-${part.pageEnd}`);
  if (!ranges.length) {
    return "未识别页码范围，按文件名排序";
  }
  const suffix = parts.length > 2 ? ` 等 ${parts.length} 段` : "";
  return `页码范围 ${ranges.join("、")}${suffix}`;
}

function makeFolderProjectPartsList(project) {
  const list = document.createElement("div");
  list.className = "home-folder-parts";
  const parts = Array.isArray(project.parts) ? project.parts.slice(0, 8) : [];
  parts.forEach((part) => {
    const item = document.createElement("span");
    item.textContent = formatFolderProjectPartLabel(part);
    list.appendChild(item);
  });
  if ((project.parts?.length || 0) > parts.length) {
    const more = document.createElement("span");
    more.textContent = `另 ${project.parts.length - parts.length} 个分册`;
    list.appendChild(more);
  }
  return list;
}

function formatFolderProjectPartLabel(part) {
  const range = part.pageStart && part.pageEnd ? ` pages ${part.pageStart}-${part.pageEnd}` : "";
  const folder = part.folderPath ? `${part.folderPath}/` : "";
  return `${String(part.order || "").padStart(2, "0")} ${folder}${part.name}${range}`;
}

function makeHomePill(text) {
  const item = document.createElement("span");
  item.textContent = text;
  return item;
}

function makeHomeProjectButton(label, icon, handler) {
  const button = document.createElement("button");
  button.className = "ghost-button compact";
  button.type = "button";
  button.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
  button.addEventListener("click", handler);
  return button;
}

function getHomeProjects() {
  const projects = [];
  const activeProject = getActiveHomeProject();
  if (activeProject) {
    projects.push(activeProject);
  }

  const cacheKeys = new Set(proofreadFallbackRecords.keys());
  for (let index = 0; index < window.localStorage.length; index += 1) cacheKeys.add(window.localStorage.key(index));
  for (const key of cacheKeys) {
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    const project = parseCachedProject(key);
    if (!project) continue;
    if (activeProject?.cacheKey === project.cacheKey) continue;
    projects.push(project);
  }

  for (const folderProject of getStoredFolderProjects()) {
    projects.push(parseStoredFolderProject(folderProject));
  }

  return projects.sort((left, right) => {
    if (left.isActive !== right.isActive) return left.isActive ? -1 : 1;
    return (Date.parse(right.updatedAt || "") || 0) - (Date.parse(left.updatedAt || "") || 0);
  });
}

function getActiveHomeProject() {
  if (!hasActiveDocument()) return null;
  return {
    cacheKey: state.cacheKey || "active",
    sourceName: state.sourceName || "当前项目",
    sourceSize: state.sourceSize,
    sourceMime: state.sourceMime,
    remoteBookId: state.remoteBookId,
    pageCount: state.pageCount || 0,
    updatedAt: new Date().toISOString(),
    ocrCount: [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length,
    translationCount: [...state.translationResults.values()].filter((result) => (result.text || "").trim()).length,
    isActive: true,
  };
}

function parseCachedProject(cacheKey) {
  try {
    const raw = readProofreadCache(cacheKey);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const pageCount = Number(payload.pageCount) || 0;
    const ocrCount = Object.values(payload.ocrResults || {}).filter((result) => (result?.text || "").trim()).length;
    const translationCount = Object.values(payload.translationResults || {}).filter((result) => (result?.text || "").trim()).length;
    return {
      cacheKey,
      sourceName: payload.sourceName || decodeCacheProjectName(cacheKey),
      sourceSize: Number(payload.sourceSize) || 0,
      sourceMime: payload.sourceMime || "",
      pageCount,
      updatedAt: payload.updatedAt || "",
      remoteBookId: payload.remoteBookId || "",
      ocrCount,
      translationCount,
      isActive: false,
    };
  } catch (error) {
    console.warn("Failed to parse cached project", cacheKey, error);
    return null;
  }
}

function parseStoredFolderProject(project) {
  const pageCount = Number(project.pageCount) || 0;
  return {
    ...project,
    cacheKey: project.id,
    sourceName: project.sourceName || "未命名藏文书籍",
    sourceMime: project.sourceMime || "folder/pdf-parts",
    sourceType: project.sourceType || "pdf-folder",
    pageCount,
    partCount: Number(project.partCount) || project.parts?.length || 0,
    ocrCount: 0,
    translationCount: 0,
    isActive: state.activeFolderProjectId === project.id,
    kind: "folder",
  };
}

function decodeCacheProjectName(cacheKey) {
  const rest = cacheKey.slice(CACHE_PREFIX.length);
  const [encodedName] = rest.split(":");
  try {
    return decodeURIComponent(encodedName || "") || "未命名项目";
  } catch (_error) {
    return "未命名项目";
  }
}

function isOcrProjectInProgress(project) {
  return Boolean(project.pageCount && project.ocrCount > 0 && project.ocrCount < project.pageCount);
}

function isTranslationProjectInProgress(project) {
  return Boolean(project.pageCount && project.translationCount > 0 && project.translationCount < project.pageCount);
}

function formatHomeDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "未记录时间";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function configurePdfJs() {
  if (!window.pdfjsLib) {
    setStatus("PDF.js 未加载，检查网络或换用本地依赖。", "error");
    return;
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

function warnIfFileProtocol() {
  if (window.location.protocol !== "file:") return;
  setStatus(
    "当前通过 file:// 打开，PDF worker、缓存和本地 OCR/Gemini 接口可能不稳定；请使用 http://127.0.0.1:8790/tibetan-proofreading-app/ 打开。",
    "error"
  );
}

function restoreOcrFontSize() {
  const storedSize = Number(window.localStorage.getItem(OCR_FONT_SIZE_KEY));
  setOcrFontSize(Number.isFinite(storedSize) ? storedSize : state.ocrFontSize, false);
}

function restoreSourcePreviewScale() {
  const storedScale = Number(window.localStorage.getItem(SOURCE_PREVIEW_SCALE_KEY));
  setSourcePreviewScale(Number.isFinite(storedScale) ? storedScale : state.sourcePreviewScale, false);
}

function restoreWorkspaceLayout() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKSPACE_LAYOUT_KEY) || "null");
    if (stored && typeof stored === "object") {
      state.layout = normalizeWorkspaceLayout(stored);
    } else {
      state.layout = normalizeWorkspaceLayout();
    }
  } catch (_error) {
    state.layout = normalizeWorkspaceLayout();
  }
  LEGACY_WORKSPACE_LAYOUT_KEYS.forEach((key) => window.localStorage.removeItem(key));
  applyWorkspaceLayout();
}

function persistWorkspaceLayout() {
  state.layout = normalizeWorkspaceLayout(state.layout);
  window.localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify(state.layout));
}

function normalizeWorkspaceLayout(layout = {}) {
  const next = { ...DEFAULT_LAYOUT, ...layout };
  next.collapsed = { ...DEFAULT_LAYOUT.collapsed, ...(layout.collapsed || {}) };
  const safeNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  next.viewer = clamp(safeNumber(next.viewer, DEFAULT_LAYOUT.viewer), 0.55, 2.4);
  next.proofreadViewer = clamp(safeNumber(next.proofreadViewer, next.viewer), 0.55, 2.4);
  next.ocr = clamp(safeNumber(next.ocr, DEFAULT_LAYOUT.ocr), 0.45, 1.9);
  next.ai = clamp(safeNumber(next.ai, DEFAULT_LAYOUT.ai), 0.45, 1.9);
  next.translation = clamp(safeNumber(next.translation, DEFAULT_LAYOUT.translation), 0.4, 1.6);
  next.translationCollapsed = Boolean(next.translationCollapsed);
  next.collapsed.viewer = Boolean(next.collapsed.viewer);
  next.collapsed.ocr = Boolean(next.collapsed.ocr);
  next.collapsed.ai = Boolean(next.collapsed.ai);

  return next;
}

function isOcrOnlyWorkspace() {
  return !els.appShell?.classList.contains("translation-workflow");
}

function applyWorkspaceLayout() {
  state.layout = normalizeWorkspaceLayout(state.layout);
  const ocrOnly = isOcrOnlyWorkspace();
  const collapsed = state.layout.collapsed;
  if (ocrOnly) {
    state.layout.translationCollapsed = true;
    els.workspace.classList.add("ocr-only-mode");
    els.appShell?.classList.add("ocr-only-mode");
  } else {
    els.workspace.classList.remove("ocr-only-mode");
    els.appShell?.classList.remove("ocr-only-mode");
  }

  els.workspace.style.setProperty("--viewer-min", collapsed.viewer ? "52px" : "300px");
  els.workspace.style.setProperty("--ocr-min", collapsed.ocr ? "52px" : "240px");
  els.workspace.style.setProperty("--ai-ocr-min", collapsed.ai ? "52px" : "240px");
  els.workspace.style.setProperty("--viewer-width", collapsed.viewer ? "52px" : `${state.layout.viewer}fr`);
  els.workspace.style.setProperty(
    "--proofread-viewer-width",
    collapsed.viewer ? "52px" : `${state.layout.proofreadViewer}fr`,
  );
  els.workspace.style.setProperty("--ocr-width", collapsed.ocr ? "52px" : `${state.layout.ocr}fr`);
  els.workspace.style.setProperty("--ai-ocr-width", collapsed.ai ? "52px" : `${state.layout.ai}fr`);
  els.workspace.style.setProperty(
    "--translation-width",
    state.layout.translationCollapsed || ocrOnly ? "0px" : `${state.layout.translation}fr`,
  );
  els.workspace.classList.toggle("translation-collapsed", state.layout.translationCollapsed || ocrOnly);
  els.workspace.classList.toggle("translation-enabled", !ocrOnly);
  els.workspace.classList.toggle("translation-workflow", !ocrOnly && state.activeWorkflow === "translation");
  els.workspace.classList.toggle("viewer-collapsed", collapsed.viewer);
  els.workspace.classList.toggle("ocr-collapsed", collapsed.ocr);
  els.workspace.classList.toggle("ai-collapsed", collapsed.ai);
  updatePaneCollapseButtons();
  els.toggleTranslationPaneButton.setAttribute(
    "aria-label",
    state.layout.translationCollapsed ? "展开藏译汉结果栏" : "折叠藏译汉结果栏",
  );
  els.toggleTranslationPaneButton.setAttribute(
    "aria-expanded",
    String(!state.layout.translationCollapsed),
  );
  const icon = els.toggleTranslationPaneButton.querySelector("[data-lucide]");
  if (icon) {
    icon.setAttribute(
      "data-lucide",
      state.layout.translationCollapsed ? "panel-right-open" : "panel-right-close",
    );
  }
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function togglePaneCollapsed(pane) {
  if (!["viewer", "ocr", "ai"].includes(pane)) return;
  state.layout.collapsed[pane] = !state.layout.collapsed[pane];
  applyWorkspaceLayout();
  persistWorkspaceLayout();
  window.requestAnimationFrame(renderSourceBlockOverlay);
}

function updatePaneCollapseButtons() {
  const labels = {
    viewer: ["原文栏", "panel-left"],
    ocr: ["Gemini OCR 栏", "panel-left"],
    ai: ["Gemini 栏", "panel-right"],
  };
  [...(els.paneCollapseButtons || []), els.viewerDividerToggle].filter(Boolean).forEach((button) => {
    const pane = button.dataset.collapsePane;
    const collapsed = Boolean(state.layout.collapsed[pane]);
    const [label, iconBase] = labels[pane] || ["边栏", "panel-left"];
    const action = pane === "viewer" && isOcrOnlyWorkspace()
      ? (collapsed ? "显示" : "隐藏") : (collapsed ? "展开" : "折叠");
    button.setAttribute("aria-label", `${action}${label}`);
    button.setAttribute("title", `${action}${label}`);
    const toggleLabel = button.querySelector("[data-viewer-toggle-label]");
    if (toggleLabel) toggleLabel.textContent = `${action}${label}`;
    button.setAttribute("aria-expanded", String(!collapsed));
    const icon = button.querySelector("[data-lucide]");
    if (icon) {
      const direction = collapsed ? "open" : "close";
      icon.setAttribute("data-lucide", `${iconBase}-${direction}`);
    }
  });
}

function setTranslationCollapsed(collapsed) {
  state.layout.translationCollapsed = Boolean(collapsed);
  applyWorkspaceLayout();
  persistWorkspaceLayout();
}

function wireWorkspaceResizers() {
  const minimums = {
    viewer: 300,
    ocr: 260,
    ai: 260,
    mergedResult: 420,
    translation: 280,
  };

  els.resizers.forEach((resizer) => {
    resizer.addEventListener("pointerdown", (event) => {
      if (
        resizer.dataset.resizer === "ai-translation" &&
        event.target.closest(".translation-toggle")
      ) {
        return;
      }

      const workspaceRect = els.workspace.getBoundingClientRect();
      const translationVisible = !state.layout.translationCollapsed && !isOcrOnlyWorkspace();
      const mergedViewerResize =
        resizer.dataset.resizer === "viewer-ocr" &&
        els.workspace.classList.contains("proofread-merged-view");
      const viewerRect = mergedViewerResize
        ? els.workspace.querySelector(".viewer-pane")?.getBoundingClientRect()
        : null;
      const mergedResultRect = mergedViewerResize
        ? els.workspace.querySelector(".ocr-pane")?.getBoundingClientRect()
        : null;
      const mergedPairWidth = (viewerRect?.width || 0) + (mergedResultRect?.width || 0);
      const visibleResizerCount = translationVisible ? 3 : 2;
      const visibleGridColumnCount = translationVisible ? 7 : 5;
      const gapCount = Math.max(0, visibleGridColumnCount - 1);
      const collapsed = state.layout.collapsed;
      const collapsedWidth =
        (collapsed.viewer ? 52 : 0) +
        (collapsed.ocr ? 52 : 0) +
        (collapsed.ai ? 52 : 0);
      const flexWidth = workspaceRect.width - visibleResizerCount * 8 - gapCount * 16 - collapsedWidth;
      let startX = event.clientX;
      const totalFlex =
        (collapsed.viewer ? 0 : state.layout.viewer) +
        (collapsed.ocr ? 0 : state.layout.ocr) +
        (collapsed.ai ? 0 : state.layout.ai) +
        (translationVisible ? state.layout.translation : 0);
      if (totalFlex <= 0 || flexWidth <= 0) return;
      const startViewer = collapsed.viewer ? 0 : (flexWidth * state.layout.viewer) / totalFlex;
      const startOcr = collapsed.ocr ? 0 : (flexWidth * state.layout.ocr) / totalFlex;
      const startAi = collapsed.ai ? 0 : (flexWidth * state.layout.ai) / totalFlex;
      const startTranslation = translationVisible
        ? (flexWidth * state.layout.translation) / totalFlex
        : 0;

      event.preventDefault();
      document.body.classList.add("is-resizing-panes");

      const onMove = (moveEvent) => {
        const delta = moveEvent.clientX - startX;

        if (mergedViewerResize) {
          if (collapsed.viewer || collapsed.ocr || !viewerRect || mergedPairWidth <= 0) return;
          const nextViewer = clamp(
            viewerRect.width + delta,
            minimums.viewer,
            mergedPairWidth - minimums.mergedResult,
          );
          const nextMergedResult = mergedPairWidth - nextViewer;
          state.layout.proofreadViewer = nextViewer / nextMergedResult;
          applyWorkspaceLayout();
          return;
        }

        if (resizer.dataset.resizer === "viewer-ocr") {
          if (collapsed.viewer || collapsed.ocr) return;
          const nextViewer = clamp(
            startViewer + delta,
            minimums.viewer,
            flexWidth - minimums.ocr - startAi - startTranslation,
          );
          const nextOcr = flexWidth - nextViewer - startAi - startTranslation;
          state.layout.viewer = nextViewer / flexWidth;
          state.layout.ocr = nextOcr / flexWidth;
          applyWorkspaceLayout();
          return;
        }

        if (resizer.dataset.resizer === "ocr-ai") {
          if (collapsed.ocr || collapsed.ai) return;
          const nextOcr = clamp(
            startOcr + delta,
            minimums.ocr,
            flexWidth - startViewer - minimums.ai - startTranslation,
          );
          const nextAi = flexWidth - startViewer - nextOcr - startTranslation;
          state.layout.ocr = nextOcr / flexWidth;
          state.layout.ai = nextAi / flexWidth;
          applyWorkspaceLayout();
          return;
        }

        if (resizer.dataset.resizer === "ai-translation" && translationVisible) {
          if (collapsed.ai) return;
          const nextAi = clamp(
            startAi + delta,
            minimums.ai,
            flexWidth - startViewer - startOcr - minimums.translation,
          );
          const nextTranslation = flexWidth - startViewer - startOcr - nextAi;
          state.layout.ai = nextAi / flexWidth;
          state.layout.translation = nextTranslation / flexWidth;
          applyWorkspaceLayout();
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.classList.remove("is-resizing-panes");
        persistWorkspaceLayout();
        renderSourceBlockOverlay();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });
}

function setOcrFontSize(size, persist = true) {
  state.ocrFontSize = clamp(
    Math.round(Number(size) || 22),
    OCR_FONT_SIZE_MIN,
    OCR_FONT_SIZE_MAX,
  );
  const ocrPane = els.ocrLineCompare.closest(".ocr-pane");
  ocrPane.style.setProperty("--ocr-font-size", `${state.ocrFontSize}px`);
  ocrPane.style.setProperty("--proofread-ocr-font-size", `${state.ocrFontSize}px`);
  els.decreaseOcrFontButton.disabled = state.ocrFontSize <= OCR_FONT_SIZE_MIN;
  els.increaseOcrFontButton.disabled = state.ocrFontSize >= OCR_FONT_SIZE_MAX;
  els.decreaseOcrFontButton.title = `缩小右栏识别文字（当前 ${state.ocrFontSize}px）`;
  els.increaseOcrFontButton.title = `放大右栏识别文字（当前 ${state.ocrFontSize}px）`;
  els.ocrLineCompare.querySelectorAll(".ocr-line-editor, .proofread-editor").forEach(resizeLineEditor);
  if (persist) {
    window.localStorage.setItem(OCR_FONT_SIZE_KEY, String(state.ocrFontSize));
  }
}

function setSourcePreviewScale(scale, persist = true, rerender = false) {
  const nextScale = clamp(
    Math.round((Number(scale) || 1) * 100) / 100,
    SOURCE_PREVIEW_SCALE_MIN,
    SOURCE_PREVIEW_SCALE_MAX,
  );
  state.sourcePreviewScale = nextScale;
  document.documentElement.style.setProperty("--source-preview-scale", String(nextScale));
  document.documentElement.style.setProperty(
    "--source-preview-min-height",
    `${Math.round(88 * nextScale)}px`,
  );
  document.documentElement.style.setProperty(
    "--source-preview-max-height",
    `${Math.round(116 * nextScale)}px`,
  );
  if (persist) {
    window.localStorage.setItem(SOURCE_PREVIEW_SCALE_KEY, String(nextScale));
  }
  if (rerender && state.ocrView === "proofread") {
    const scrollTop = els.ocrLineCompare.scrollTop;
    renderCurrentOcrView();
    els.ocrLineCompare.scrollTop = scrollTop;
    return;
  }
  updateSourcePreviewScaleButtons();
}

function setSourcePageZoom(zoom) {
  state.sourcePageZoom = clamp(
    Math.round((Number(zoom) || 1) * 100) / 100,
    SOURCE_PAGE_ZOOM_MIN,
    SOURCE_PAGE_ZOOM_MAX,
  );
  applySourcePageZoom();
}

function applySourcePageZoom() {
  const zoom = state.sourcePageZoom || 1;
  els.viewerZoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  els.viewerZoomOutButton.disabled = zoom <= SOURCE_PAGE_ZOOM_MIN;
  els.viewerZoomInButton.disabled = zoom >= SOURCE_PAGE_ZOOM_MAX;
  const image = els.imagePage;
  if (image.style.display !== "none" && image.naturalWidth) {
    const fitWidth = Math.min(image.naturalWidth, Math.max(320, els.pageViewport.clientWidth - 36));
    image.style.maxWidth = "none";
    image.style.width = `${Math.round(fitWidth * zoom)}px`;
  }
  renderSourceBlockOverlay();
}

function updateSourcePreviewScaleButtons() {
  const currentPercent = Math.round(state.sourcePreviewScale * 100);
  document.querySelectorAll(".source-preview-scale-button").forEach((button) => {
    const action = button.dataset.scaleAction;
    const isDecrease = action === "decrease";
    const isIncrease = action === "increase";
    button.disabled =
      (isDecrease && state.sourcePreviewScale <= SOURCE_PREVIEW_SCALE_MIN) ||
      (isIncrease && state.sourcePreviewScale >= SOURCE_PREVIEW_SCALE_MAX);
    button.title = `${isDecrease ? "缩小" : "放大"}原文行预览（当前 ${currentPercent}%）`;
  });
}

async function loadSamplePdf() {
  try {
    setStatus("正在载入本地样本 PDF...", "warn");
    const response = await fetch(encodeURI(SAMPLE_PDF_URL));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const file = new File([blob], "天文历算学-本科教材 藏文40301698_部分.pdf", {
      type: "application/pdf",
    });
    await loadFile(file);
  } catch (error) {
    setStatus(`无法载入本地样本。请确认从项目根目录启动 HTTP 服务。${error.message}`, "error");
  }
}

async function loadFile(file, options = {}) {
  await initializeProofreadFallback();
  if (state.batchOcr?.running) throw new Error("请先停止批量识别，再加载其他文件。");
  if (!isSupportedSourceFile(file)) {
    throw new Error("只支持 PDF、图片、Markdown、TXT 或 DOCX 文件。");
  }
  const requestId = options.requestId ?? ++state.documentRequestId;
  if (requestId !== state.documentRequestId) return false;
  if (!options.skipRemoteUpload) state.remoteRestoreInFlight = false;

  setStatus(`正在载入 ${file.name || "所选文件"}...`, "warn");
  resetDocumentState();
  state.sourceName = file.name;
  state.sourceSize = file.size || 0;
  state.sourceMime = file.type || "";
  state.cacheKey = makeCacheKey(file);
  window.localStorage.setItem(ACTIVE_PROJECT_KEY, state.cacheKey);
  storeSourceFile(state.cacheKey, file).catch((error) => {
    console.warn("Failed to store source file locally", error);
  });
  if (options.remoteBookId) {
    state.remoteBookId = options.remoteBookId;
  }

  if (isCloudDeployment() && !options.skipRemoteUpload) {
    void createRemoteBook(file, requestId)
      .then(() => {
        if (requestId !== state.documentRequestId) return;
        saveCachedResults();
      })
      .catch((error) => {
        if (requestId !== state.documentRequestId) return;
        console.warn("Failed to create remote book; continuing with local file", error);
        setStatus(
          `文件已在当前浏览器载入，但云端书籍保存失败：${error.message || error}`,
          "warn"
        );
      });
  }

  if (isPdfFile(file)) {
    const loaded = await loadPdf(file, { requestId });
    if (!loaded || requestId !== state.documentRequestId) return false;
    saveCachedResults();
    return true;
  }

  if (isWordFile(file)) {
    await loadWord(file);
    if (requestId !== state.documentRequestId) return false;
    saveCachedResults();
    return true;
  }

  if (file.type.startsWith("image/")) {
    await loadImage(file);
    if (requestId !== state.documentRequestId) return false;
    saveCachedResults();
    return true;
  }

  if (isMarkdownFile(file)) {
    await loadMarkdown(file);
    if (requestId !== state.documentRequestId) return false;
    if (!state.remoteRestoreInFlight) saveCachedResults();
    return true;
  }

  throw new Error("只支持 PDF、图片、Markdown、TXT 或 DOCX 文件。");
}

function isSupportedSourceFile(file) {
  return Boolean(file) && (isPdfFile(file) || isWordFile(file) || file.type.startsWith("image/") || isMarkdownFile(file));
}

function hasActiveDocument() {
  return Boolean(state.pageCount || state.sourceName || state.cacheKey);
}

function newProject() {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再新建项目。", "warn");
    return false;
  }

  if (hasActiveDocument()) {
    const ok = window.confirm(
      `新建项目会关闭当前工作台中的“${state.sourceName || "未命名项目"}”。本地缓存不会被删除，源文件也不会被删除。是否继续？`
    );
    if (!ok) {
      setStatus("已取消新建项目。当前工作台保持不变。", "warn");
      return false;
    }
  }

  window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
  resetDocumentState();
  setStatus("已新建空白项目。请点击“加载文件”开始。", "ok");
  renderHomeDashboard();
  return true;
}

async function deleteCurrentProject() {
  if (state.isOcrBusy || state.isTranslateBusy) {
    setStatus("OCR 或翻译正在运行，请等当前任务结束后再删除项目。", "warn");
    return;
  }

  if (!hasActiveDocument()) {
    setStatus("当前没有可删除的项目。请先加载文件。", "warn");
    return;
  }

  const projectName = state.sourceName || "当前项目";
  const cacheKey = state.cacheKey;
  const ok = window.confirm(
    `删除项目会移除“${projectName}”的本地 OCR/译文缓存，并清空当前工作台。磁盘上的源文件不会被删除。是否继续？`
  );
  if (!ok) {
    setStatus("已取消删除项目。当前工作台保持不变。", "warn");
    return;
  }

  if (cacheKey) {
    await proofreadFallbackQueue.catch(() => {});
    if (proofreadFallbackRecords.has(cacheKey)) await writeProofreadFallback(cacheKey, null);
    window.localStorage.removeItem(cacheKey);
    if (window.localStorage.getItem(ACTIVE_PROJECT_KEY) === cacheKey) {
      window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }
  resetDocumentState();
  setStatus(`已删除“${projectName}”的本地项目缓存。源文件未删除。`, "ok");
  renderHomeDashboard();
}

function isMarkdownFile(file) {
  const name = file.name.toLowerCase();
  return file.type === "text/markdown" ||
    file.type === "text/plain" ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".txt");
}

function isPdfFile(file) {
  return file?.type === "application/pdf" || /\.pdf$/i.test(file?.name || "");
}

function isWordFile(file) {
  const name = file.name.toLowerCase();
  return file.type === DOCX_MIME || name.endsWith(".docx") || name.endsWith(".doc");
}

async function loadPdf(file, options = {}) {
  if (!window.pdfjsLib) {
    setStatus("PDF.js 未加载，无法解析 PDF。", "error");
    return;
  }

  state.pdfFile = file || null;
  state.pdfUrl = options.sourceUrl || URL.createObjectURL(file);
  const task = window.pdfjsLib.getDocument({
    url: state.pdfUrl,
    ...(options.httpHeaders ? { httpHeaders: options.httpHeaders } : {}),
    disableStream: Boolean(options.useRangeRequests),
    disableAutoFetch: Boolean(options.useRangeRequests),
    ...(options.useRangeRequests ? { rangeChunkSize: 64 * 1024 } : {}),
    disableFontFace: false,
    useSystemFonts: true,
    fontExtraProperties: true,
  });
  const pdfDoc = await task.promise;
  if (options.requestId !== undefined && options.requestId !== state.documentRequestId) {
    if (typeof task.destroy === "function") await task.destroy().catch(() => {});
    return false;
  }
  state.pdfDoc = pdfDoc;
  state.sourceType = "pdf";
  state.pageNum = 1;
  state.pageCount = state.pdfDoc.numPages;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "第 1 页 OCR";
  const restored = restoreCachedResults();
  setStatus(
    restored
      ? `已载入 ${state.sourceName}，共 ${state.pageCount} 页，并恢复本地暂存的 OCR/译文。`
      : `已载入 ${state.sourceName}，共 ${state.pageCount} 页。`,
    "ok"
  );
  refreshControls();
  await renderCurrentPage();
  if (options.requestId !== undefined && options.requestId !== state.documentRequestId) return false;
  const remoteMobilePdf = options.useRangeRequests && isCloudDeployment() && window.matchMedia("(max-width: 760px)").matches;
  if (remoteMobilePdf) {
    const loadedDoc = state.pdfDoc;
    scheduleIdleWork(() => {
      if (state.pdfDoc === loadedDoc) void primeCurrentPageDirectText();
    });
  } else {
    await primeCurrentPageDirectText("load");
  }
  if (options.requestId !== undefined && options.requestId !== state.documentRequestId) return false;
  const loadedDoc = state.pdfDoc;
  scheduleIdleWork(() => {
    if (state.pdfDoc === loadedDoc) {
      buildPdfThumbnails();
    }
  });
  return true;
}

async function loadImage(file) {
  state.sourceType = "image";
  state.imageBlob = file;
  state.imageUrl = URL.createObjectURL(file);
  state.pageNum = 1;
  state.pageCount = 1;

  await new Promise((resolve, reject) => {
    els.imagePage.onload = resolve;
    els.imagePage.onerror = reject;
    els.imagePage.src = state.imageUrl;
  });

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "图片 OCR";
  const restored = restoreCachedResults();
  setStatus(
    restored
      ? `已载入图片 ${state.sourceName}，并恢复本地暂存的 OCR/译文。`
      : `已载入图片 ${state.sourceName}。`,
    "ok"
  );
  refreshControls();
  renderCurrentPage();
  buildImageThumbnail();
}

async function loadMarkdown(file) {
  const text = await file.text();
  const name = file.name.toLowerCase();
  const isPlainText = name.endsWith(".txt") || file.type === "text/plain";
  state.sourceType = isPlainText ? "text" : "markdown";
  state.markdownText = text;
  state.documentText = text;
  state.pageNum = 1;
  state.pageCount = 1;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = isPlainText ? "文本文件" : "Markdown 文本";
  const restored = state.remoteRestoreInFlight ? false : restoreCachedResults();
  const hasRestoredResult = state.ocrResults.has(1);
  if (!hasRestoredResult) {
    state.ocrResults.set(1, {
      text,
      lines: text.split("\n").map((line, index) => ({ text: line, bbox: null, index })),
      source: isPlainText ? "text-file" : "markdown",
      updatedAt: new Date().toISOString(),
    });
  }
  if (!restored && !state.remoteRestoreInFlight) {
    saveCachedResults();
  }
  setStatus(
    restored && hasRestoredResult
      ? `已载入 ${isPlainText ? "文本" : "Markdown"} ${state.sourceName}，并恢复本地暂存的 OCR/译文。`
      : `已载入 ${isPlainText ? "文本" : "Markdown"} ${state.sourceName}，可直接校对或翻译。`,
    "ok"
  );
  refreshControls();
  renderCurrentPage();
  setOcrView("text");
  buildTextThumbnail(isPlainText ? "TXT" : "MD");
}

async function loadWord(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".doc") && !name.endsWith(".docx")) {
    throw new Error("当前本地前端只支持 .docx 文本抽取；旧版 .doc 请先转为 .docx 或 PDF。");
  }

  const text = await extractDocxText(file);
  if (!text.trim()) {
    throw new Error("Word 文档没有提取到正文文本。");
  }

  state.sourceType = "word";
  state.documentText = text;
  state.markdownText = text;
  state.pageNum = 1;
  state.pageCount = 1;

  els.sourceTitle.textContent = state.sourceName;
  els.ocrTitle.textContent = "Word 文本";
  const restored = restoreCachedResults();
  const hasRestoredResult = state.ocrResults.has(1);
  if (!hasRestoredResult) {
    state.ocrResults.set(1, makeTextResult(text, "word-text"));
  }
  if (!restored) {
    saveCachedResults();
  }
  setStatus(
    restored && hasRestoredResult
      ? `已载入 Word ${state.sourceName}，并恢复本地暂存的 OCR/译文。`
      : `已载入 Word ${state.sourceName}，已直接提取文本，可直接翻译。`,
    "ok"
  );
  refreshControls();
  renderCurrentPage();
  setOcrView("text");
  buildTextThumbnail("DOCX");
}

function resetDocumentState() {
  state.batchOcr = null;
  state.thumbnailToken += 1;
  clearSourceBlockOverlay();

  if (state.pdfUrl) {
    URL.revokeObjectURL(state.pdfUrl);
  }
  if (state.pdfPageRenderUrl) {
    URL.revokeObjectURL(state.pdfPageRenderUrl);
  }
  state.pdfPageRenderCache.forEach((entry) => {
    if (entry?.url) {
      URL.revokeObjectURL(entry.url);
    }
  });
  if (state.imageUrl) {
    URL.revokeObjectURL(state.imageUrl);
  }

  state.pdfDoc = null;
  state.remoteServerPdf = false;
  state.remoteFirstPageDeadline = 0;
  state.remotePreviewError = "";
  state.remoteRestoreComplete = false;
  state.remoteStateLoadError = "";
  if (els.sourceRetryButton) els.sourceRetryButton.hidden = true;
  state.pdfUrl = "";
  state.pdfFile = null;
  state.pdfPageRenderUrl = "";
  state.pdfPageRenderCache.clear();
  state.imageUrl = "";
  state.imageBlob = null;
  state.markdownText = "";
  state.documentText = "";
  state.sourceName = "";
  state.sourceSize = 0;
  state.sourceMime = "";
  state.cacheKey = "";
  state.sourceType = "";
  state.activeFolderProjectId = "";
  state.pageNum = 1;
  state.pageCount = 0;
  state.ocrResults.clear();
  state.ocrProfile = DEFAULT_OCR_PROFILE;
  state.translationResults.clear();
  state.ocrQualityReviews = [];
  state.remoteBookId = "";
  state.remotePageRevisions = {};
  state.remotePageSnapshots = {};
  state.remoteDeferredPages = new Set();
  if (state.remoteSaveTimer) {
    window.clearTimeout(state.remoteSaveTimer);
    state.remoteSaveTimer = null;
  }
  state.remoteSavePromise = null;
  state.remotePendingPayload = null;
  state.localCacheQuotaExceeded = false;
  state.localProofreadSavePending = false;
  state.renderToken += 1;

  els.thumbnailList.innerHTML = "";
  els.ocrText.value = "";
  els.translationText.value = "";
  els.imagePage.removeAttribute("src");
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "none";
  els.emptyState.style.display = "grid";
  els.emptyState.innerHTML = EMPTY_STATE_HTML;
  els.sourceTitle.textContent = "未载入文件";
  updateFileOcrStatus();
  els.ocrTitle.textContent = "等待识别";
  els.aiOcrTitle.textContent = "等待智能识别";
  els.translationTitle.textContent = "等待翻译";
  syncPageControls(false);
  els.ocrMeta.textContent = "未识别";
  els.aiOcrMeta.textContent = "未返回";
  els.translationMeta.textContent = "未翻译";
  refreshControls();
  updateSummary();
  updateTranslationSummary();
  if (els.ocrProfileSelect) {
    els.ocrProfileSelect.value = DEFAULT_OCR_PROFILE;
  }
}

function makeCacheKey(file) {
  const type = file.type || "unknown";
  const size = file.size || 0;
  return `${CACHE_PREFIX}${encodeURIComponent(file.name)}:${size}:${encodeURIComponent(type)}`;
}

function sanitizeCachedSourceLines(lines, layoutVersion) {
  const records = Array.isArray(lines) ? lines : [];
  return records.map((line, index) => ({
    ...line,
    bbox: normalizeBbox(line?.bbox),
    bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
    index,
  }));
}

function sanitizeCachedSourceCoordinates(compare, layoutVersion) {
  const normalized = normalizeOcrCompare(compare);
  if (!normalized) return normalized;
  const clearSide = (side) => side ? {
    ...side,
    lines: (side.lines || []).map((line, index) => ({
      ...line,
      bbox: normalizeBbox(line?.bbox),
      bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
      index,
    })),
    regions: normalizeOcrRegions(side.regions),
  } : side;
  return {
    ...normalized,
    bdrc: clearSide(normalized.bdrc),
    llm: clearSide(normalized.llm),
  };
}

// Independent durable fallback: never evict proofreading to make localStorage space.
const proofreadFallbackRecords = new Map();
let proofreadFallbackQueue = Promise.resolve();
let proofreadFallbackReady = null;
let localProofreadSaveSequence = 0;
function openProofreadFallback() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("浏览器不支持校对后备存储"));
    const request = window.indexedDB.open("tibetan-proofreading-results", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("results");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开校对后备存储"));
    request.onblocked = () => reject(new Error("校对后备存储被其他页面占用"));
  });
}
function initializeProofreadFallback() {
  if (proofreadFallbackReady) return proofreadFallbackReady;
  proofreadFallbackReady = (async () => {
    const db = await openProofreadFallback();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("results", "readonly");
        const cursor = tx.objectStore("results").openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (row) { proofreadFallbackRecords.set(row.key, row.value); row.continue(); }
        };
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || new Error("读取校对后备存储失败"));
      });
    } finally { db.close(); }
  })().catch(error => { console.warn("Could not load proofreading fallback", error); });
  return proofreadFallbackReady;
}
function writeProofreadFallback(key, raw) {
  const operation = proofreadFallbackQueue.catch(() => {}).then(async () => {
    const db = await openProofreadFallback();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("results", "readwrite");
        if (raw === null) tx.objectStore("results").delete(key);
        else tx.objectStore("results").put(raw, key);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || new Error("校对后备存储写入失败"));
      });
      if (raw === null) proofreadFallbackRecords.delete(key);
      else proofreadFallbackRecords.set(key, raw);
    } finally { db.close(); }
  });
  proofreadFallbackQueue = operation;
  return operation;
}
function readProofreadCache(key) {
  const fallback = proofreadFallbackRecords.get(key);
  let legacy = null;
  try { legacy = window.localStorage.getItem(key); } catch (_) { /* fallback remains readable */ }
  if (!fallback) return legacy;
  if (!legacy) return fallback;
  let fallbackPayload, legacyPayload;
  try { fallbackPayload = JSON.parse(fallback); } catch (_) { return legacy; }
  try { legacyPayload = JSON.parse(legacy); } catch (_) { return fallback; }
  if (!fallbackPayload || typeof fallbackPayload !== "object") return legacy;
  if (!legacyPayload || typeof legacyPayload !== "object") return fallback;
  return (Date.parse(legacyPayload.updatedAt) || 0) > (Date.parse(fallbackPayload.updatedAt) || 0) ? legacy : fallback;
}
function updateLocalProofreadSaveFeedback(pending, failed = false) {
  for (const status of els.ocrLineCompare?.querySelectorAll?.(".proofread-autosave-status") || []) {
    status.textContent = pending ? "正在保存到本机…" : failed ? "本机保存失败，请保留页面" : "已保存到本机";
    status.classList.toggle("is-error", failed);
  }
}

function restoreCachedResults(payloadOverride = null) {
  if (!state.cacheKey || !state.pageCount) return false;

  try {
    const raw = payloadOverride ? null : readProofreadCache(state.cacheKey);
    if (!payloadOverride && !raw) return false;

    const payload = payloadOverride || JSON.parse(raw);
    if (payload.pageCount && payload.pageCount !== state.pageCount) {
      return false;
    }

    state.ocrResults.clear();
    state.translationResults.clear();
    if (OCR_PROFILES[payload.ocrProfile]) {
      state.ocrProfile = payload.ocrProfile;
      if (els.ocrProfileSelect) els.ocrProfileSelect.value = state.ocrProfile;
    }
    state.ocrQualityReviews = normalizeOcrQualityReviews(payload.ocrQualityReviews);

    let droppedBadPdfTextCount = 0;
    for (const [page, result] of Object.entries(payload.ocrResults || {})) {
      const pageNum = Number(page);
      if (!isValidPageNumber(pageNum) || typeof result?.text !== "string") continue;
      if (result.source === "pdf-text" && !isUsablePdfDirectText(result.text)) {
        droppedBadPdfTextCount += 1;
        continue;
      }
      state.ocrResults.set(pageNum, {
        text: result.text,
        raw: result.raw || null,
        compare: sanitizeCachedSourceCoordinates(result.compare, result.layoutVersion),
        lines: sanitizeCachedSourceLines(result.lines, result.layoutVersion),
        regions: normalizeOcrRegions(result.regions),
        regionOrder: normalizeRegionOrder(result.regionOrder),
        layoutVersion: Number(result.layoutVersion) === SOURCE_LAYOUT_VERSION ? SOURCE_LAYOUT_VERSION : 0,
        sourceAlignmentVersion: Number(result.sourceAlignmentVersion) || 0,
        ocrProfile: OCR_PROFILES[result.ocrProfile] ? result.ocrProfile : "",
        source: result.source || "cache",
        updatedAt: result.updatedAt || payload.updatedAt || "",
      });
    }
    // Ignore unusable extracted text without deleting saved model results.

    for (const [page, result] of Object.entries(payload.translationResults || {})) {
      const pageNum = Number(page);
      if (!isValidPageNumber(pageNum) || typeof result?.text !== "string") continue;
      state.translationResults.set(pageNum, {
        text: result.text,
        source: result.source || "cache",
        updatedAt: result.updatedAt || payload.updatedAt || "",
      });
    }

    updateSummary();
    updateTranslationSummary();
    return state.ocrResults.size > 0 || state.translationResults.size > 0;
  } catch (error) {
    console.warn("Failed to restore cached OCR state", error);
    return false;
  }
}

function saveCachedResults(options = {}) {
  if (!state.cacheKey || !state.pageCount) return false;

  try {
    const payload = {
      sourceName: state.sourceName,
      sourceSize: state.sourceSize,
      sourceMime: state.sourceMime,
      pageCount: state.pageCount,
      updatedAt: new Date().toISOString(),
      remoteBookId: state.remoteBookId,
      ocrProfile: state.ocrProfile,
      ocrResults: serializeResultMap(state.ocrResults),
      translationResults: serializeResultMap(state.translationResults),
      ocrQualityReviews: state.ocrQualityReviews,
    };
    const key = state.cacheKey;
    const serialized = JSON.stringify(payload);
    const sequence = ++localProofreadSaveSequence;
    const documentRequestId = state.documentRequestId;
    try {
      window.localStorage.setItem(key, serialized);
      state.localCacheQuotaExceeded = false;
      state.localProofreadSavePending = false;
    } catch (error) {
      state.localCacheQuotaExceeded = true;
      if (!window.indexedDB) throw error;
      state.localProofreadSavePending = true;
      updateLocalProofreadSaveFeedback(true);
      const pending = writeProofreadFallback(key, serialized).then(async () => {
        if (state.cacheKey !== key || state.documentRequestId !== documentRequestId || sequence !== localProofreadSaveSequence) return true;
        if (sequence === localProofreadSaveSequence) {
          state.localCacheQuotaExceeded = false;
          state.localProofreadSavePending = false;
          updateLocalProofreadSaveFeedback(false);
          setStatus("校对已保存到本机后备存储；云端同步状态请查看协作栏。", "ok");
        }
        await scheduleRemoteStateSave(payload, options.immediateRemote);
        return true;
      }).catch(error => {
        console.warn("Failed to persist proofreading fallback", error);
        if (state.cacheKey === key && state.documentRequestId === documentRequestId && sequence === localProofreadSaveSequence) {
          state.localProofreadSavePending = false;
          updateLocalProofreadSaveFeedback(false, true);
          setStatus("本机校对保存失败：修改仅保留在当前页面，请勿刷新，请先导出备份。", "error");
        }
        return false;
      });
      return pending;
    }
    const remoteSave = scheduleRemoteStateSave(payload, options.immediateRemote);
    if (els.homeView && !els.homeView.hidden) renderHomeDashboard();
    return remoteSave ?? true;
  } catch (error) {
    console.warn("Failed to save cached OCR state", error);
    return false;
  }
}

async function createRemoteBook(file, requestId = state.documentRequestId) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(`${window.location.origin}/api/books`, { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.book_id) {
    throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
  }
  if (requestId !== state.documentRequestId) return;
  state.remoteBookId = payload.book_id;
  state.remotePageRevisions = {};
  state.remotePageSnapshots = {};
  state.remoteDeferredPages = new Set();
  state.remoteRestoreComplete = true;
  const url = new URL(window.location.href);
  url.searchParams.set("book_id", state.remoteBookId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function scheduleRemoteStateSave(payload, immediate = false) {
  if (!isCloudDeployment() || !state.remoteBookId || state.remoteRestoreInFlight || !state.remoteRestoreComplete) return;
  if (state.remoteSaveTimer) window.clearTimeout(state.remoteSaveTimer);
  state.remotePendingPayload = payload;
  if (immediate || state.remoteSavePromise) return flushRemoteStateSaves();
  state.remoteSaveTimer = window.setTimeout(() => void flushRemoteStateSaves(), 500);
}

async function flushRemoteStateSaves() {
  state.remoteSaveTimer = null;
  if (state.remoteSavePromise) return state.remoteSavePromise;
  const bookId = state.remoteBookId;
  const drain = (async () => {
    while (state.remotePendingPayload && state.remoteBookId === bookId && state.remoteRestoreComplete) {
      const payload = state.remotePendingPayload;
      state.remotePendingPayload = null;
      const changedPages = findChangedRemotePages(payload, state.remotePageSnapshots);
      if (!changedPages.length) continue;
      try {
        const { ocrResults, translationResults, ocrQualityReviews, ...metadata } = payload;
        const changed = new Set(changedPages);
        const pickPages = (results) => Object.fromEntries(changedPages
          .filter((page) => Object.prototype.hasOwnProperty.call(results || {}, page))
          .map((page) => [page, results[page]]));
        const pageReviews = Array.isArray(ocrQualityReviews)
          ? ocrQualityReviews.filter((row) => changed.has(String(row.pageNum ?? row.page_num)))
          : pickPages(ocrQualityReviews);
        const response = await fetch(`${window.location.origin}/api/books/${encodeURIComponent(bookId)}/state`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(90000) : undefined,
          body: JSON.stringify({
            ...metadata,
            book_id: bookId,
            ocr_results: pickPages(ocrResults),
            translation_results: pickPages(translationResults),
            ocrQualityReviews: pageReviews,
            base_page_revisions: state.remotePageRevisions || {},
            changed_pages: changedPages,
          }),
        });
        const responsePayload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = typeof responsePayload.detail === "object" ? responsePayload.detail.message : responsePayload.detail;
          if (response.status === 409 && Array.isArray(responsePayload.detail?.pages)) {
            throw new Error(`第 ${responsePayload.detail.pages.join("、")} 页有其他协作者的新修改，请重新加载后复核；本地内容已保留。`);
          }
          throw new Error(detail || `HTTP ${response.status}`);
        }
        if (state.remoteBookId !== bookId) break;
        state.remotePageRevisions = responsePayload.page_revisions || state.remotePageRevisions;
        for (const page of changedPages) {
          state.remotePageSnapshots[page] = remotePageFingerprint(payload, page);
          state.remoteDeferredPages.delete(page);
        }
        if (/云端校对状态暂时无法加载|云端校对状态同步失败|正在同步云端|已保留本机第|待复核同步|当前页各行的修改已自动保存/.test(els.statusBar.textContent || "")) {
          setStatus(state.remoteDeferredPages.size
            ? `当前修改已同步；本机第 ${[...state.remoteDeferredPages].join("、")} 页仍待复核同步。`
            : "云端校对状态已同步。", state.remoteDeferredPages.size ? "warn" : "ok");
        }
        if (els.collabRetrySync) {
          els.collabRetrySync.hidden = !state.remoteDeferredPages.size;
          els.collabRetrySync.textContent = state.remoteDeferredPages.size ? "同步本机校对" : "重试云端同步";
        }
        setCollaborationFeedback("");
      } catch (error) {
        if (state.remoteBookId !== bookId) break;
        console.warn("Failed to save remote OCR state", error);
        state.remotePendingPayload = null;
        state.remoteRestoreComplete = false;
        if (els.sourceRetryButton) {
          els.sourceRetryButton.textContent = "重试云端校对状态";
          els.sourceRetryButton.hidden = false;
        }
        const timeout = error.name === "TimeoutError" || /signal timed out|请求超时/i.test(String(error.message || ""));
        const detail = timeout ? "云端同步请求超时" : (error.message || String(error));
        setStatus(`${state.localCacheQuotaExceeded ? "修改仍保留在当前页面，请勿刷新" : "本机已保存"}，但${detail}。请点击协作栏的“重试云端同步”。`, "warn");
        setCollaborationFeedback(`${detail}；点击“重试云端同步”。`, true);
        if (els.collabRetrySync) els.collabRetrySync.hidden = false;
        break;
      }
    }
  })();
  state.remoteSavePromise = drain;
  try { await drain; }
  finally {
    if (state.remoteSavePromise === drain) state.remoteSavePromise = null;
  }
}

async function retryCollaborationSync() {
  if (!state.remoteBookId || state.remoteSavePromise || !els.collabRetrySync) return;
  const bookId = state.remoteBookId;
  els.collabRetrySync.disabled = true;
  setCollaborationFeedback("正在核对云端版本并重试同步…");
  try {
    const response = await fetch(`${window.location.origin}/api/books/${encodeURIComponent(bookId)}/state`, {
      credentials: "same-origin",
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(45000) : undefined,
    });
    const remote = await response.json().catch(() => ({}));
    if (!response.ok || remote.collaboration_degraded) throw new Error(remote.detail || "协作数据库暂不可用");
    if (state.remoteBookId !== bookId) return;
    const current = {
      ocrResults: serializeResultMap(state.ocrResults),
      translationResults: serializeResultMap(state.translationResults),
      ocrQualityReviews: state.ocrQualityReviews,
    };
    const changed = findChangedRemotePages(current, state.remotePageSnapshots);
    const revisions = remote.page_revisions || {};
    const conflicts = changed.filter((page) => {
      if (Number(revisions[page] || 0) === Number(state.remotePageRevisions[page] || 0)) return false;
      if (remotePageFingerprint(remote, page) === remotePageFingerprint(current, page)) {
        state.remotePageSnapshots[page] = remotePageFingerprint(current, page);
        return false;
      }
      return true;
    });
    if (conflicts.length) throw new Error(`第 ${conflicts.join("、")} 页已有其他协作者的新修改；当前页面内容仍保留，请先复核冲突。`);
    state.remotePageRevisions = {
      ...state.remotePageRevisions,
      ...Object.fromEntries(changed.map((page) => [page, revisions[page] || 0])),
    };
    state.remoteRestoreComplete = true;
    const saved = saveCachedResults({ immediateRemote: true });
    if (saved === false) throw new Error("当前修改未能保存，请保持页面打开并重试。");
    if (await saved === false) throw new Error("本机后备存储保存失败，请保留页面并导出备份。");
    if (!state.remoteRestoreComplete) return;
    els.collabRetrySync.hidden = true;
    els.collabRetrySync.textContent = "重试云端同步";
    if (els.sourceRetryButton) {
      els.sourceRetryButton.hidden = true;
      els.sourceRetryButton.textContent = "重试加载当前页";
    }
    setCollaborationFeedback("");
    setStatus("云端校对状态已同步。", "ok");
  } catch (error) {
    state.remoteRestoreComplete = false;
    setCollaborationFeedback(`重试失败：${error.message || error}`, true);
  } finally {
    els.collabRetrySync.disabled = false;
  }
}

function remotePageFingerprint(payload, page) {
  const reviews = Array.isArray(payload.ocrQualityReviews)
    ? payload.ocrQualityReviews.filter((row) => String(row.pageNum ?? row.page_num ?? "") === String(page))
    : (payload.ocrQualityReviews?.[page] || []);
  return JSON.stringify({
    ocr: (payload.ocrResults || payload.ocr_results || {})[page] ?? null,
    translation: (payload.translationResults || payload.translation_results || {})[page] ?? null,
    reviews,
  });
}

function makeRemotePageSnapshots(payload) {
  const maps = [payload.ocr_results || payload.ocrResults || {}, payload.translation_results || payload.translationResults || {}];
  const pages = new Set(maps.flatMap((map) => Object.keys(map)));
  const reviews = payload.ocrQualityReviews || payload.ocr_quality_reviews || [];
  if (Array.isArray(reviews)) reviews.forEach((row) => { const page = row.pageNum ?? row.page_num; if (page != null) pages.add(String(page)); });
  else if (reviews && typeof reviews === "object") Object.keys(reviews).forEach((page) => pages.add(page));
  return Object.fromEntries([...pages].map((page) => [page, remotePageFingerprint(payload, page)]));
}

function findChangedRemotePages(payload, snapshots) {
  const current = makeRemotePageSnapshots(payload);
  const pages = new Set([...Object.keys(current), ...Object.keys(snapshots || {})]);
  return [...pages].filter((page) => current[page] !== (snapshots || {})[page]).sort((a, b) => Number(a) - Number(b));
}

function serializeResultMap(map) {
  const output = {};
  for (const [pageNum, result] of map.entries()) {
    const text = result?.text || "";
    output[pageNum] = {
      text,
      raw: result.raw || null,
      lines: (result.lines || []).map((line, index) => ({
        text: line.text || "",
        adoptedProvider: line.adoptedProvider || "",
        deleted: Boolean(line?.deleted),
        bbox: normalizeBbox(line.bbox),
        bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
        regionId: line?.regionId || line?.region_id || "",
        regionLabel: line?.regionLabel || line?.region_label || "",
        manualBaselineText: typeof line?.manualBaselineText === "string" ? line.manualBaselineText : undefined,
        manuallyEdited: Boolean(line?.manuallyEdited),
        manualErrorChars: Math.max(0, Number(line?.manualErrorChars || 0)),
        manualEditRanges: getManualEditRanges(line),
        error: Boolean(line?.error),
        missing: Boolean(line?.missing),
        diagnostic: Boolean(line?.diagnostic),
        index,
      })),
      regions: normalizeOcrRegions(result.regions),
      regionOrder: normalizeRegionOrder(result.regionOrder),
      layoutVersion: Number(result.layoutVersion) || 0,
      sourceAlignmentVersion: Number(result.sourceAlignmentVersion) || 0,
      ocrProfile: OCR_PROFILES[result.ocrProfile] ? result.ocrProfile : "",
      compare: normalizeOcrCompare(result.compare),
      source: result.source || "manual",
      updatedAt: result.updatedAt || "",
    };
  }
  return output;
}

function isValidPageNumber(pageNum) {
  return Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= state.pageCount;
}

function restoreTranslationRoles() {
  let customRoles = [];
  try {
    const raw = window.localStorage.getItem(TRANSLATION_ROLES_KEY);
    customRoles = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(customRoles)) {
      throw new Error("translation roles must be an array");
    }
  } catch (error) {
    console.warn("Failed to restore translation roles", error);
    window.localStorage.removeItem(TRANSLATION_ROLES_KEY);
    setStatus("翻译角色配置已损坏，已回退到内置“学术直译”。", "warn");
    customRoles = [];
  }

  const normalizedCustomRoles = customRoles.map(normalizeTranslationRole).filter(Boolean);
  state.translationRoles = [
    ...BUILT_IN_TRANSLATION_ROLES.map((role) => ({ ...role })),
    ...normalizedCustomRoles,
  ];
  const modelOverrides = readTranslationModelOverrides();
  state.translationRoles.forEach((role) => {
    if (role.builtIn && modelOverrides[role.id]) role.model = modelOverrides[role.id];
  });
  state.activeTranslationRoleId = window.localStorage.getItem(ACTIVE_TRANSLATION_ROLE_KEY) || "academic-literal";
  if (!state.translationRoles.some((role) => role.id === state.activeTranslationRoleId)) {
    state.activeTranslationRoleId = "academic-literal";
    saveActiveTranslationRole();
  }
  state.editingRoleId = state.activeTranslationRoleId;
}

function normalizeTranslationRole(role) {
  if (!role || typeof role !== "object") return null;
  const id = String(role.id || "").trim();
  const name = String(role.name || "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    sourceLang: String(role.sourceLang || "bo"),
    targetLang: String(role.targetLang || "zh"),
    model: String(role.model || DEFAULT_TRANSLATION_MODEL),
    systemPrompt: String(role.systemPrompt || BUILT_IN_TRANSLATION_ROLES[0].systemPrompt),
    userPromptTemplate: String(role.userPromptTemplate || BUILT_IN_TRANSLATION_ROLES[0].userPromptTemplate),
    temperature: clamp(Number(role.temperature ?? 0.2), 0, 2),
    maxTokens: Math.max(256, Number(role.maxTokens || 2048)),
    builtIn: false,
  };
}

function getCustomTranslationRoles() {
  return state.translationRoles.filter((role) => !role.builtIn);
}

function saveCustomTranslationRoles() {
  const customRoles = getCustomTranslationRoles().map(({ builtIn, ...role }) => role);
  window.localStorage.setItem(TRANSLATION_ROLES_KEY, JSON.stringify(customRoles));
}

function saveActiveTranslationRole() {
  window.localStorage.setItem(ACTIVE_TRANSLATION_ROLE_KEY, state.activeTranslationRoleId);
}

function readTranslationModelOverrides() {
  try {
    const value = JSON.parse(window.localStorage.getItem(TRANSLATION_MODEL_OVERRIDES_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function getActiveTranslationRole() {
  const role = state.translationRoles.find((item) => item.id === state.activeTranslationRoleId);
  if (role) return role;
  state.activeTranslationRoleId = "academic-literal";
  saveActiveTranslationRole();
  renderTranslationRoleOptions();
  setStatus("当前翻译角色不存在，已回退到内置“学术直译”。", "warn");
  return BUILT_IN_TRANSLATION_ROLES[0];
}

function renderTranslationRoleOptions() {
  if (!els.translationRoleSelect) return;
  els.translationRoleSelect.innerHTML = "";
  state.translationRoles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role.id;
    option.textContent = role.builtIn ? role.name : `${role.name}（自定义）`;
    els.translationRoleSelect.appendChild(option);
  });
  els.translationRoleSelect.value = state.activeTranslationRoleId;
  if (els.translationRoleSelect.value !== state.activeTranslationRoleId) {
    state.activeTranslationRoleId = "academic-literal";
    els.translationRoleSelect.value = state.activeTranslationRoleId;
    saveActiveTranslationRole();
  }
}

function renderActiveTranslationRoleMeta() {
  const role = getActiveTranslationRole();
  if (els.translationRoleModel) {
    setModelSelectValue(els.translationRoleModel, role.model || DEFAULT_TRANSLATION_MODEL);
    els.translationRoleModel.title = `${role.name} · ${role.sourceLang} → ${role.targetLang}`;
  }
}

function openRoleManager() {
  state.editingRoleId = state.activeTranslationRoleId;
  renderRoleList();
  loadRoleForm(getActiveTranslationRole());
  els.roleManagerModal.classList.remove("is-hidden");
  window.setTimeout(() => els.roleNameInput.focus(), 0);
  if (window.lucide) window.lucide.createIcons();
}

function closeRoleManager() {
  els.roleManagerModal.classList.add("is-hidden");
}

function renderRoleList() {
  els.roleList.innerHTML = "";
  state.translationRoles.forEach((role) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "role-list-item";
    button.classList.toggle("active", role.id === state.editingRoleId);
    button.innerHTML = `
      <strong>${escapeHtml(role.name)}</strong>
      <span>${escapeHtml(role.model || DEFAULT_TRANSLATION_MODEL)}</span>
      <em>${role.builtIn ? "内置" : "自定义"}</em>
    `;
    button.addEventListener("click", () => {
      state.editingRoleId = role.id;
      renderRoleList();
      loadRoleForm(role);
    });
    els.roleList.appendChild(button);
  });
}

function loadRoleForm(role) {
  const target = role || BUILT_IN_TRANSLATION_ROLES[0];
  els.roleNameInput.value = target.name || "";
  els.roleIdInput.value = target.id || "";
  els.roleSourceLangInput.value = target.sourceLang || "bo";
  els.roleTargetLangInput.value = target.targetLang || "zh";
  setModelSelectValue(els.roleModelInput, target.model || DEFAULT_TRANSLATION_MODEL);
  els.roleTemperatureInput.value = String(target.temperature ?? 0.2);
  els.roleMaxTokensInput.value = String(target.maxTokens ?? 2048);
  els.roleSystemPromptInput.value = target.systemPrompt || "";
  els.roleUserPromptTemplateInput.value = target.userPromptTemplate || "";
  els.deleteRoleButton.disabled = Boolean(target.builtIn);
}

function setModelSelectValue(select, model) {
  if (!select) return;
  const hasModelOption = Array.from(select.options).some((option) => option.value === model);
  if (!hasModelOption) {
    const legacyOption = document.createElement("option");
    legacyOption.value = model;
    legacyOption.textContent = `当前配置：${model}`;
    select.prepend(legacyOption);
  }
  select.value = model;
}

function createDraftTranslationRole() {
  state.editingRoleId = "";
  renderRoleList();
  loadRoleForm({
    id: "",
    name: "",
    sourceLang: "bo",
    targetLang: "zh",
    model: DEFAULT_TRANSLATION_MODEL,
    systemPrompt: BUILT_IN_TRANSLATION_ROLES[0].systemPrompt,
    userPromptTemplate: BUILT_IN_TRANSLATION_ROLES[0].userPromptTemplate,
    temperature: 0.2,
    maxTokens: 2048,
    builtIn: false,
  });
}

function saveRoleFromForm(event) {
  event.preventDefault();
  const roleName = els.roleNameInput.value.trim();
  if (!roleName) {
    setStatus("请先填写翻译角色显示名称。", "warn");
    return;
  }

  const currentRole = state.translationRoles.find((role) => role.id === state.editingRoleId);
  const baseId = els.roleIdInput.value.trim() || slugifyRoleId(roleName);
  const roleId = currentRole?.builtIn ? `custom-${baseId}` : baseId;
  const role = normalizeTranslationRole({
    id: ensureUniqueRoleId(roleId, currentRole?.builtIn ? "" : state.editingRoleId),
    name: roleName,
    sourceLang: els.roleSourceLangInput.value,
    targetLang: els.roleTargetLangInput.value,
    model: els.roleModelInput.value.trim() || DEFAULT_TRANSLATION_MODEL,
    systemPrompt: els.roleSystemPromptInput.value.trim(),
    userPromptTemplate: els.roleUserPromptTemplateInput.value.trim(),
    temperature: Number(els.roleTemperatureInput.value || 0.2),
    maxTokens: Number(els.roleMaxTokensInput.value || 2048),
  });
  if (!role) {
    setStatus("翻译角色配置无效，未保存。", "error");
    return;
  }

  const existingIndex = state.translationRoles.findIndex((item) => item.id === state.editingRoleId && !item.builtIn);
  if (existingIndex >= 0) {
    state.translationRoles.splice(existingIndex, 1, role);
  } else {
    state.translationRoles.push(role);
  }
  state.activeTranslationRoleId = role.id;
  state.editingRoleId = role.id;
  saveCustomTranslationRoles();
  saveActiveTranslationRole();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  renderRoleList();
  loadRoleForm(role);
  setStatus(`已保存翻译角色：${role.name}。`, "ok");
}

function deleteEditingTranslationRole() {
  const role = state.translationRoles.find((item) => item.id === state.editingRoleId);
  if (!role || role.builtIn) return;
  state.translationRoles = state.translationRoles.filter((item) => item.id !== role.id);
  if (state.activeTranslationRoleId === role.id) {
    state.activeTranslationRoleId = "academic-literal";
    saveActiveTranslationRole();
  }
  state.editingRoleId = state.activeTranslationRoleId;
  saveCustomTranslationRoles();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  renderRoleList();
  loadRoleForm(getActiveTranslationRole());
  setStatus(`已删除自定义翻译角色：${role.name}。`, "ok");
}

function resetCustomTranslationRoles() {
  state.translationRoles = BUILT_IN_TRANSLATION_ROLES.map((role) => ({ ...role }));
  state.activeTranslationRoleId = "academic-literal";
  state.editingRoleId = "academic-literal";
  window.localStorage.removeItem(TRANSLATION_ROLES_KEY);
  window.localStorage.removeItem(TRANSLATION_MODEL_OVERRIDES_KEY);
  saveActiveTranslationRole();
  renderTranslationRoleOptions();
  renderActiveTranslationRoleMeta();
  renderRoleList();
  loadRoleForm(getActiveTranslationRole());
  setStatus("已重置自定义翻译角色，当前使用“学术直译”。", "ok");
}

function ensureUniqueRoleId(roleId, currentId = "") {
  let nextId = roleId;
  let suffix = 2;
  while (state.translationRoles.some((role) => role.id === nextId && role.id !== currentId)) {
    nextId = `${roleId}-${suffix}`;
    suffix += 1;
  }
  return nextId;
}

function slugifyRoleId(value) {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `custom-role-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isDirectTextSource(source) {
  return DIRECT_TEXT_SOURCES.has(source || "");
}

function splitTextIntoLineRecords(text) {
  return String(text || "")
    .split("\n")
    .map((line, index) => ({ text: line, bbox: null, index }));
}

function makeTextResult(text, source, extra = {}) {
  return {
    text,
    lines: splitTextIntoLineRecords(text),
    source,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

function shouldReplaceExistingWithPdfText(existing, existingText, overwrite) {
  if (overwrite) return true;
  if (!existingText) return true;
  // Text-layer discovery is a fallback for an empty page, never a replacement
  // for an explicit OCR or manually corrected result on that page.
  return false;
}

function discardCurrentBadPdfTextResult() {
  const existing = state.ocrResults.get(state.pageNum);
  if (existing?.source !== "pdf-text") return false;
  if (isUsablePdfDirectText(existing.text || "")) return false;
  state.ocrResults.delete(state.pageNum);
  els.ocrText.value = "";
  saveCachedResults();
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
  return true;
}

function getResultSourceLabel(result) {
  switch (result?.source) {
    case "pdf-text":
      return "PDF 文本层";
    case "word-text":
      return "Word 文本";
    case "markdown":
      return "Markdown 文本";
    case "text-file":
      return "文本文件";
    case "manual":
      return "人工校对文本";
    case "bdrc":
      return "BDRC OCR";
    case "ai-vision":
      return "Gemini";
    case "bdrc-ai":
      return "智能识别";
    default:
      return result?.text ? "校对文本" : "";
  }
}

async function renderCurrentPage() {
  if (!state.pageCount) {
    return;
  }

  if (state.sourceType === "image") {
    await renderImagePage();
    return;
  }

  if (state.sourceType === "markdown" || state.sourceType === "text" || state.sourceType === "word") {
    renderTextDocumentPage();
    return;
  }

  const token = ++state.renderToken;
  try {
    if (state.remoteServerPdf || (isCloudDeployment() && state.remoteBookId && window.matchMedia("(max-width: 760px)").matches)) {
      if (await renderCurrentPdfPageWithLocalService(token)) {
        if (state.remoteServerPdf) state.remoteFirstPageDeadline = 0;
        syncPageControls(true);
        renderActiveSourceHighlight();
        updateOcrPanelForPage();
        updateTranslationPanelForPage();
        updateThumbnailState();
        deferCurrentPageSourceHydration(state.pageNum, token);
        return;
      }
    }
    const page = await state.pdfDoc.getPage(state.pageNum);
    if (token !== state.renderToken) return;

    const baseViewport = page.getViewport({ scale: 1 });
    const requestedZoom = els.zoomInput.value;
    const availableWidth = Math.max(320, els.pageViewport.clientWidth - 40);
    const scale = requestedZoom === "fit"
      ? Math.min(availableWidth / baseViewport.width, 2.2)
      : Number(requestedZoom);

    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const canvas = els.pdfCanvas;
    const context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, viewport.width, viewport.height);

    await page.render({ canvasContext: context, viewport }).promise;
    if (token !== state.renderToken) return;

    els.pdfCanvas.style.display = "block";
    els.imagePage.style.display = "none";
    els.emptyState.style.display = "none";
    syncPageControls(true);
    renderActiveSourceHighlight();
    updateOcrPanelForPage();
    updateTranslationPanelForPage();
    updateThumbnailState();
    deferCurrentPageSourceHydration(state.pageNum, token);
  } catch (error) {
    if (token !== state.renderToken) return;
    if (state.remoteServerPdf) {
      state.remotePreviewError = error.name === "AbortError" ? "请求超时" : String(error.message || error);
      els.pdfCanvas.style.display = "none";
      els.imagePage.style.display = "none";
      els.emptyState.style.display = "grid";
      els.emptyState.textContent = `第 ${state.pageNum} 页加载失败：${error.name === "AbortError" ? "请求超时" : error.message || error}。请点下方按钮重试。`;
      if (els.sourceRetryButton) els.sourceRetryButton.hidden = false;
      setStatus(`原文页加载失败：${error.name === "AbortError" ? "请求超时" : error.message || error}`, "error");
      throw error;
    }
    console.warn("Browser PDF render unavailable, falling back to server", error);
    if (!await renderCurrentPdfPageWithLocalService(token)) throw error;
    syncPageControls(true);
    renderActiveSourceHighlight();
    updateOcrPanelForPage();
    updateTranslationPanelForPage();
    updateThumbnailState();
    deferCurrentPageSourceHydration(state.pageNum, token);
  }
}

function deferCurrentPageSourceHydration(pageNum, renderToken = state.renderToken) {
  scheduleIdleWork(() => hydrateCurrentPageSourceCoordinates().then(() => {
    if (pageNum !== state.pageNum || renderToken !== state.renderToken) return;
    renderActiveSourceHighlight();
    updateOcrPanelForPage();
  }));
}

async function renderCurrentPdfPageWithLocalService(token) {
  if (!state.pdfFile && !(isCloudDeployment() && state.remoteBookId)) return false;
  try {
    const previewDpi = state.remoteServerPdf && window.matchMedia("(max-width: 760px)").matches ? 144 : 180;
    const previewFormat = state.remoteServerPdf ? "jpeg" : "png";
    const blob = await getRenderedPdfPageBlobWithCache(state.pageNum, previewDpi, previewFormat);
    if (token !== state.renderToken) return true;
    const cacheKey = makePdfPageRenderCacheKey(state.pageNum, previewDpi, previewFormat);
    const cached = state.pdfPageRenderCache.get(cacheKey);
    state.pdfPageRenderUrl = cached?.url || URL.createObjectURL(blob);
    if (cached && !cached.url) {
      cached.url = state.pdfPageRenderUrl;
    }
    els.imagePage.onload = null;
    els.imagePage.onerror = null;
    els.imagePage.src = state.pdfPageRenderUrl;
    if (typeof els.imagePage.decode === "function") {
      await decodeSourcePreview(els.imagePage);
      if (token !== state.renderToken) return true;
    }
    els.imagePage.style.display = "block";
    state.remotePreviewError = "";
    els.pdfCanvas.style.display = "none";
    els.emptyState.style.display = "none";
    if (els.sourceRetryButton && !state.remoteStateLoadError) els.sourceRetryButton.hidden = true;
    applySourcePageZoom();
    return true;
  } catch (error) {
    console.warn("Local Poppler PDF render unavailable, falling back to PDF.js", error);
    if (state.remoteServerPdf) throw error;
    return false;
  }
}

async function decodeSourcePreview(image, timeoutMs = 15000) {
  let timer;
  try {
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("图片解码超时，请重试加载当前页")), timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function makePdfPageRenderCacheKey(pageNum, dpi, format = "png") {
  return `${state.sourceName}:${state.sourceSize}:${pageNum}:${dpi}:${format}`;
}

async function getRenderedPdfPageBlobWithCache(pageNum, dpi, format = "png") {
  if ((state.batchOcr?.running || getSelectedOcrProfile().id === "traditional") && state.pdfDoc && state.pdfFile) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    dpi = getBatchPdfRenderDpi(viewport.width, viewport.height, dpi);
  }
  const cacheKey = makePdfPageRenderCacheKey(pageNum, dpi, format);
  const cached = state.pdfPageRenderCache.get(cacheKey);
  if (cached?.blob) return cached.blob;
  if (cached?.pending) return cached.pending;
  const pending = renderPdfPageBlobWithLocalService(pageNum, dpi, format);
  state.pdfPageRenderCache.set(cacheKey, { pending, url: "" });
  try {
    const blob = await pending;
    state.pdfPageRenderCache.set(cacheKey, { blob, url: "" });
    return blob;
  } catch (error) {
    state.pdfPageRenderCache.delete(cacheKey);
    throw error;
  }
}

function getBatchPdfRenderDpi(width, height, requestedDpi) {
  // Oversized scan page metadata must not inflate the OCR input to 14k pixels.
  // For ordinary PDF pages, retain the user's requested resolution.
  return Math.min(requestedDpi, Math.max(72, Math.floor(4200 * 72 / Math.max(width, height, 1))));
}

async function renderPdfPageBlobWithLocalService(pageNum, dpi, format = "png") {
  if (!state.pdfFile && isCloudDeployment() && state.remoteBookId) {
    const timeoutMs = state.remoteFirstPageDeadline
      ? Math.max(1, state.remoteFirstPageDeadline - Date.now()) : 120000;
    const response = await fetchWithCloudTimeout(`${window.location.origin}/api/books/${encodeURIComponent(state.remoteBookId)}/pages/${pageNum}/preview?dpi=${dpi}&format=${format}`, {
      credentials: "same-origin",
    }, timeoutMs);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw Object.assign(new Error(payload.detail || `云端单页预览 HTTP ${response.status}`), { status: response.status });
    }
    return response.blob();
  }
  const formData = new FormData();
  formData.append("file", state.pdfFile, state.pdfFile.name || "source.pdf");
  formData.append("page", String(pageNum));
  formData.append("dpi", String(dpi));
  const response = await fetch(`${window.location.origin}/api/render-pdf-page`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.blob();
}

async function renderImagePage() {
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "block";
  els.emptyState.style.display = "none";
  applySourcePageZoom();
  syncPageControls(true);
  renderActiveSourceHighlight();
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
  deferCurrentPageSourceHydration(state.pageNum);
}

function renderTextDocumentPage() {
  const label = state.sourceType === "word"
    ? "Word"
    : state.sourceType === "text"
      ? "文本"
      : "Markdown";
  const text = state.documentText || state.markdownText || "";
  els.pdfCanvas.style.display = "none";
  els.imagePage.style.display = "none";
  els.emptyState.style.display = "grid";
  els.emptyState.innerHTML = `
    <i data-lucide="file-text"></i>
    <p>已载入 ${label} 文本，请在中栏校对内容。</p>
    <pre class="markdown-source-preview">${escapeHtml(text.slice(0, 2400))}</pre>
  `;
  if (window.lucide) {
    window.lucide.createIcons();
  }
  syncPageControls(true);
  clearSourceLineHighlight();
  updateOcrPanelForPage();
  updateTranslationPanelForPage();
  updateThumbnailState();
}

async function buildPdfThumbnails() {
  els.thumbnailList.innerHTML = "";

  const count = state.pageCount;
  const token = ++state.thumbnailToken;
  let nextPage = 1;

  const appendChunk = (deadline) => {
    if ((!state.pdfDoc && !state.remoteServerPdf) || token !== state.thumbnailToken) return;

    const fragment = document.createDocumentFragment();
    let appended = 0;

    while (
      nextPage <= count &&
      appended < 48 &&
      (!deadline || deadline.timeRemaining() > 4 || appended < 8)
    ) {
      const button = createThumbnailButton(nextPage);
      fragment.appendChild(button);
      nextPage += 1;
      appended += 1;
    }

    els.thumbnailList.appendChild(fragment);

    updateThumbnailState();

    if (nextPage <= count) {
      scheduleIdleWork(appendChunk);
    }
  };

  appendChunk();
}

function createThumbnailButton(pageNum) {
  const button = document.createElement("button");
  button.className = "thumbnail-button";
  button.type = "button";
  button.dataset.page = String(pageNum);
  button.innerHTML = `<span class="page-nav-number">${pageNum}</span>`;
  button.addEventListener("click", () => goToPage(pageNum));
  return button;
}

function scheduleIdleWork(callback) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout: 500 });
  } else {
    window.setTimeout(() => callback(), 16);
  }
}

function buildImageThumbnail() {
  els.thumbnailList.innerHTML = "";
  const button = document.createElement("button");
  button.className = "thumbnail-button active";
  button.type = "button";
  button.dataset.page = "1";
  const span = document.createElement("span");
  span.textContent = "1";
  span.className = "page-nav-number";
  button.append(span);
  els.thumbnailList.appendChild(button);
}

function buildMarkdownThumbnail() {
  buildTextThumbnail("MD");
}

function buildTextThumbnail(label) {
  els.thumbnailList.innerHTML = "";
  const button = document.createElement("button");
  button.className = "thumbnail-button active recognized direct-text";
  button.type = "button";
  button.dataset.page = "1";
  button.innerHTML = `<span class="page-nav-type">${escapeHtml(label)}</span><span class="page-nav-number">1</span>`;
  els.thumbnailList.appendChild(button);
}

async function goToPage(pageNum, options = {}) {
  if (state.batchOcr?.running && !options.batch) return;
  if (!state.pageCount) return;
  const nextPage = clamp(Math.trunc(pageNum), 1, state.pageCount);
  if (nextPage === state.pageNum) {
    syncPageControls(true);
    return;
  }
  state.pageNum = nextPage;
  updateCollaborationPageNumber();
  clearSourceLineHighlight();
  if (state.remoteServerPdf) {
    refreshControls();
    updateOcrPanelForPage();
    updateTranslationPanelForPage();
    updateThumbnailState();
    els.pdfCanvas.style.display = "none";
    els.imagePage.style.display = "none";
    els.emptyState.style.display = "grid";
    els.emptyState.textContent = `正在读取第 ${nextPage} 页原文，请稍候…`;
    if (els.sourceRetryButton) els.sourceRetryButton.hidden = true;
    setStatus(`正在加载第 ${nextPage} / ${state.pageCount} 页原文…`, "warn");
  }
  try {
    await renderCurrentPage();
  } catch (error) {
    if (!state.remoteServerPdf) throw error;
    updateOcrPanelForPage();
    updateTranslationPanelForPage();
    updateThumbnailState();
    refreshControls();
    return;
  }
  scheduleIdleWork(() => primeCurrentPageDirectText("page"));
  refreshControls();
  if (state.remoteServerPdf && state.pageNum === nextPage) {
    setStatus(`第 ${nextPage} / ${state.pageCount} 页原文已加载。`, "ok");
  }
}

async function syncPageInputBeforeAction() {
  const typedPage = Number(els.pageInput.value);
  if (Number.isFinite(typedPage) && Math.trunc(typedPage) !== state.pageNum) {
    await goToPage(typedPage);
  }
}

async function runOcrForCurrentPage(options = {}) {
  if (state.isOcrBusy && !options.skipBusy) return;
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  if (!options.skipPageSync) {
    await syncPageInputBeforeAction();
  }

  discardCurrentBadPdfTextResult();

  const profile = getSelectedOcrProfile();
  const endpoint = els.aiOcrEndpointInput.value.trim();
  const engineLabel = "Gemini";
  if (!endpoint) {
    setStatus("请填写 Gemini OCR 接口地址。", "warn");
    return;
  }

  try {
    if (!options.skipBusy) {
      setBusy(true);
    }
    setStatus(`正在生成第 ${state.pageNum} 页 OCR 图片...`, "warn");
    const blob = await getCurrentPageImageBlob();

    if (profile.id === "traditional" && getOcrSourceCompare(state.ocrResults.get(state.pageNum))?.bdrc?.lines?.length) {
      await runTraditionalGeminiLines(endpoint, blob, getSelectedGeminiModel());
      return;
    }

    setStatus(`正在调用 ${engineLabel} OCR 接口...`, "warn");
    const parsed = await callOcrEndpoint(endpoint, blob, {
      engine: "ai_vision",
      mode: profile.id,
      ocr_profile: profile.id,
      prompt: buildAiOcrPrompt("", profile.id),
      model: getSelectedGeminiModel(),
    });
    saveOcrResultFromParsed(
      parsed,
      "ai-vision",
      `第 ${state.pageNum} 页 ${engineLabel} 识别完成。${parsed.raw?.failed_line_count ? ` ${parsed.raw.failed_line_count} 行失败或未返回文字，请逐行重新识别。` : ""}`,
      [], parsed.raw?.line_ocr ? "proofread" : "lines"
    );
  } catch (error) {
    setStatus(
      `${engineLabel} OCR 调用失败：${formatNetworkError(error, endpoint, "ai-ocr")}`,
      "error"
    );
    throw error;
  } finally {
    if (!options.skipBusy) {
      setBusy(false);
    }
  }
}

async function runTraditionalGeminiLines(endpoint, blob, selectedModel = "") {
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const original = state.ocrResults.get(pageNum);
  const before = JSON.stringify(original);
  const previous = getOcrSourceCompare(original);
  let baseLines = previous?.bdrc?.lines?.length ? getEffectiveOcrSideLines(previous.bdrc) : [];
  // Earlier whole-page OCR blocks and later Qwen physical rows can occupy
  // different indexes. Use the reviewed physical boxes when all are present.
  const physicalRows = (previous?.qwenReviews || [])
    .filter((line) => Number.isInteger(line?.index) && line.index >= 0
      && String(line?.text || "").trim() && normalizeBbox(line?.bbox))
    .map((line) => ({index: line.index, bbox: normalizeBbox(line.bbox), region_id: "center"}));
  const uniquePhysicalRows = new Map(physicalRows.map((row) => [row.index, row]));
  const usePhysicalRows = uniquePhysicalRows.size >= 2
    && uniquePhysicalRows.size === physicalRows.length
    && uniquePhysicalRows.size >= (original?.lines?.length || 0);
  let rows = usePhysicalRows ? [...uniquePhysicalRows.values()] :
    (baseLines.length ? collectCenterPageReviewRows(original) : null);
  if (!rows?.length) {
    setStatus("正在定位中间栏文字行…", "warn");
    const layout = await callOcrEndpoint(endpoint.replace(/\/ocr\/?$/, "/line-layout"), blob);
    baseLines = getParsedOcrLines(layout);
    rows = baseLines.map((line, index) => {
      if (isPeripheralProofreadRegion(line)) return null;
      const bbox = normalizeBbox(line.bbox);
      if (!bbox) throw new Error("中间栏文字行定位失败，原结果保留。");
      return {index, bbox, region_id: "center"};
    }).filter(Boolean);
  }
  if (!rows.length) throw new Error("未检测到中间栏文字行，原结果保留。");
  if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，请返回原页重试。");
  setStatus(`Gemini 正在读取整页原图并识别中间栏 ${rows.length} 行…`, "warn");
  const payload = await requestWholePageReview(endpoint.replace(/\/(?:ai-)?ocr\/?$/, "/gemini-page-review"), blob, rows, selectedModel);
  const reviewed = mergePageReviews([], payload, rows, "gemini");
  if (state.pageNum !== pageNum || state.cacheKey !== sourceKey || state.ocrResults.get(pageNum) !== original || JSON.stringify(original) !== before) {
    throw new Error("页面或校对结果已改变，未覆盖原结果。");
  }
  const byIndex = new Map(reviewed.map(line => [line.index, line]));
  if (original) {
    const compare = getOcrSourceCompare(original) || makeEmptyOcrCompare(original);
    const oldLines = compare.llm.lines || [];
    const rowCount = Math.max(baseLines.length, oldLines.length, ...rows.map(row => row.index + 1));
    compare.llm.lines = Array.from({length: rowCount}, (_, index) => {
      const line = baseLines[index] || oldLines[index] || {index, text: ""};
      const oldLine = oldLines[index];
      const candidate = byIndex.get(index);
      if (oldLine?.manuallyEdited || oldLine?.manualEditRanges?.length || oldLine?.manualErrorChars) {
        return oldLine;
      }
      if (candidate) return {...line, ...candidate, deleted: false,
        missing: false, error: false, diagnostic: false};
      if (!usePhysicalRows) return oldLine || {...line, text: "", missing: true};
      const oldText = String(oldLine?.text || "").trim();
      const duplicate = !oldText || reviewed.some((item) => reviewLineSimilarity(oldText, item.text) >= 0.45);
      return duplicate ? {...line, ...oldLine, deleted: true} : (oldLine || {...line, text: "", missing: true});
    });
    compare.llm.text = joinActiveOcrLines(compare.llm.lines);
    compare.llm.model = payload.model;
    compare.llm.provider = "gemini";
    compare.llm.returnedLineCount = reviewed.length;
    original.compare = compare;
    original.updatedAt = new Date().toISOString();
  } else {
    const lines = baseLines.map((line, index) => byIndex.has(index)
      ? {...line, ...byIndex.get(index), missing: false, error: false}
      : {...line, text: "", missing: true});
    const text = joinActiveOcrLines(lines);
    state.ocrResults.set(pageNum, {text, lines, raw: payload, source: "ai-vision",
      ocrProfile: "traditional", updatedAt: new Date().toISOString(),
      compare: normalizeOcrCompare({bdrc: {label:"BDRC", text:"", lines:[]},
        llm: {label:"Gemini", text, lines, model:payload.model, provider:"gemini"}})});
  }
  const saved = saveCachedResults({immediateRemote: true});
  if (saved === false) throw new Error("本地保存失败，识别结果未能保存。");
  if (isCloudDeployment() && state.remoteBookId && !saved) {
    throw new Error("本地已保存，但云端校对状态尚未就绪，请重试云端校对状态。");
  }
  await saved;
  if (isCloudDeployment() && state.remoteBookId && !state.remoteRestoreComplete) {
    throw new Error("本地已保存，但云端同步失败；请重试云端校对状态。");
  }
  if (state.pageNum === pageNum) updateOcrPanelForPage();
  updateSummary();
  setStatus(`第 ${pageNum} 页 Gemini 整页识别已保存（中间栏 ${reviewed.length} 行）。`, "ok");
}

function hasValidPageOcr(result) {
  if (Number(result?.raw?.failed_line_count) > 0) return false;
  if (!String(result?.text || "").trim()) return false;
  if (isDirectTextSource(result.source)) return true;
  const lines = getExistingResultLines(result);
  return lines.some((line) => !line.deleted && !line.error && !line.diagnostic && !isMissingOcrTranscription(line)
    && /[\u0f00-\u0fff0-9]/.test(String(line.text || "")));
}

function hasValidGeminiPageOcr(result) {
  const side = getOcrSourceCompare(result)?.llm;
  const activeLines = (side?.lines || []).filter((line) => !line.deleted);
  return Boolean(side && !side.error && Number(result?.raw?.failed_line_count || 0) === 0
    && isCurrentGeminiResult(side) && activeLines.length
    && activeLines.every((line) => !line.error && !line.diagnostic
      && !isMissingOcrTranscription(line) && /[\u0f00-\u0fff0-9]/.test(String(line.text || ""))));
}

function updateBatchOcrProgress() {
  if (!els.batchOcrProgress) return;
  const progressKey = state.cacheKey ? `tibetan-ocr-batch:${state.cacheKey}` : "";
  if (!state.batchOcr && progressKey) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(progressKey) || "null");
      if (saved?.total === state.pageCount && Array.isArray(saved.pages)
        && Array.isArray(saved.success) && Array.isArray(saved.failed)) {
        state.batchOcr = { ...saved, running: false, cancelled: saved.cancelled || saved.running };
      }
    } catch (error) { console.warn("Failed to restore batch progress", error); }
  }
  const job = state.batchOcr;
  els.cancelBatchOcrButton.hidden = !job?.running;
  els.cancelBatchOcrButton.disabled = Boolean(job?.cancelled);
  els.batchOcrButton.disabled = !state.pageCount || state.isOcrBusy || state.activeProjectRestoreInFlight || state.sourceType !== "pdf";
  if (!job) {
    els.batchOcrProgress.textContent = "";
    return;
  }
  const remaining = job.pages.length - job.success.length - job.failed.length;
  const label = job.running ? (job.cancelled ? "正在停止，等待当前页保存" : `正在处理第 ${job.currentPage} 页`)
    : job.cancelled ? "批量已停止" : "批量已结束";
  const summary = `${label} · 共 ${job.total} 页 · 已有 ${job.skipped} 页 · 本次成功 ${job.success.length} 页 · 失败 ${job.failed.length} 页 · 剩余 ${remaining} 页${job.failed.length ? `；失败页：${job.failed.map((item) => item.page).join("、")}` : ""}`;
  els.batchOcrProgress.textContent = summary;
  els.batchOcrProgress.title = job.failed.map((item) => `第 ${item.page} 页：${item.error}`).join("\n") || summary;
  if (progressKey) {
    try { window.localStorage.setItem(progressKey, JSON.stringify(job)); }
    catch (error) { console.warn("Failed to save batch progress", error); }
  }
}

async function runOcrForRemainingPages() {
  if (state.isOcrBusy || state.activeProjectRestoreInFlight || state.sourceType !== "pdf" || !state.pageCount) return;
  const originalPage = state.pageNum;
  const sourceKey = state.cacheKey;
  const pages = Array.from({ length: state.pageCount }, (_, index) => index + 1)
    .filter((page) => !hasValidGeminiPageOcr(state.ocrResults.get(page)));
  const job = { running: true, cancelled: false, currentPage: 0, total: state.pageCount,
    pages, skipped: state.pageCount - pages.length, success: [], failed: [] };
  state.batchOcr = job;
  setBusy(true);
  refreshControls();
  try {
    for (const page of pages) {
      if (job.cancelled || sourceKey !== state.cacheKey) { job.cancelled = true; break; }
      job.currentPage = page;
      updateBatchOcrProgress();
      try {
        await goToPage(page, { batch: true });
        await runOcrForCurrentPage({ skipBusy: true, skipPageSync: true, mode: getOcrMode() });
        if (isCloudDeployment() && state.remoteBookId && !state.remoteRestoreComplete) {
          throw new Error("本机识别结果已保留，但云端同步失败；请重试云端校对状态后再继续批量识别。");
        }
        if (!hasValidGeminiPageOcr(state.ocrResults.get(page))) throw new Error("未返回有效 Gemini OCR 文字");
        await saveCachedResults({ immediateRemote: true });
        if (isCloudDeployment() && state.remoteBookId && !state.remoteRestoreComplete) {
          throw new Error("本机识别结果已保留，但云端同步失败；请重试云端校对状态后再继续批量识别。");
        }
        job.success.push(page);
      } catch (error) {
        job.failed.push({ page, error: String(error.message || error) });
        if (isCloudDeployment() && state.remoteBookId && !state.remoteRestoreComplete) job.cancelled = true;
      }
      updateBatchOcrProgress();
    }
  } finally {
    job.running = false;
    setBusy(false);
    try {
      if (sourceKey === state.cacheKey) await goToPage(originalPage, { batch: true });
    } catch (error) {
      setStatus(`结果已保存，但原页面恢复失败：${error.message || error}`, "warn");
    }
    refreshControls();
    updateBatchOcrProgress();
    setStatus(job.cancelled && isCloudDeployment() && !state.remoteRestoreComplete
      ? `批量已停止：云端同步失败。本机结果已保留，请重试云端校对状态；本轮成功 ${job.success.length} 页、失败 ${job.failed.length} 页。`
      : `批量${job.cancelled ? "已停止" : "完成"}：成功 ${job.success.length} 页，失败 ${job.failed.length} 页。已完成结果已保存。`, job.failed.length ? "warn" : "ok");
  }
}

function getOcrMode() {
  return "ai";
}

function getSelectedOcrProfile() {
  const id = els.ocrProfileSelect?.value || state.ocrProfile || DEFAULT_OCR_PROFILE;
  const profile = OCR_PROFILES[id] || OCR_PROFILES[DEFAULT_OCR_PROFILE];
  return { id: OCR_PROFILES[id] ? id : DEFAULT_OCR_PROFILE, ...profile };
}

async function callOcrEndpoint(endpoint, blob, fields = {}) {
  const formData = new FormData();
  formData.append("file", blob, makePageImageName());
  formData.append("lang", "bo");
  formData.append("page", String(state.pageNum));
  formData.append("source_name", state.sourceName);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(key, String(value));
    }
  });

  const response = await fetchOcrWithTransientRetry(endpoint, formData, fields.engine === "ai_vision");
  const parsed = await parseOcrResponse(response);
  if (!response.ok) {
    throw new Error(parsed.error || `HTTP ${response.status}`);
  }
  if (fields.engine === "ai_vision") {
    assertSupportedAiVisionResponse(parsed);
  }
  return parsed;
}

async function fetchOcrWithTransientRetry(endpoint, formData, retryTransient) {
  const maxRetries = retryTransient ? 3 : 0;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(endpoint, { method: "POST", body: formData });
      if (retryTransient && [502, 503].includes(response.status) && attempt < maxRetries) {
        await waitForOcrRetry(attempt);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!retryTransient || !isTransientOcrNetworkError(error) || attempt >= maxRetries) {
        throw error;
      }
      await waitForOcrRetry(attempt);
    }
  }

  throw lastError || new Error("OCR 请求失败");
}

function isTransientOcrNetworkError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("network error")
    || message.includes("econnrefused")
    || message.includes("connection reset");
}

function waitForOcrRetry(attempt) {
  const delay = Math.min(3200, 800 * (2 ** attempt));
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function getExistingResultLines(result) {
  if (Array.isArray(result?.lines) && result.lines.length) return result.lines;
  return makeOcrLinesFromText(result?.text || "");
}

function needsSourceCoordinateHydration(result) {
  const lines = getExistingResultLines(result);
  return lines.length > 0 && lines.some((line) => !normalizeBbox(line?.bbox));
}

function getAiVisionLayoutEndpoint() {
  const endpoint = els.aiOcrEndpointInput.value.trim();
  return endpoint.replace(/\/(?:ai-)?ocr\/?$/, "/layout");
}

function getAiVisionLineReviewEndpoint() {
  const endpoint = els.aiOcrEndpointInput.value.trim();
  return endpoint.replace(/\/(?:ai-)?ocr\/?$/, "/line-review");
}

async function callAiVisionLineReviewEndpoint(endpoint, blob, bbox, draftText = "", model = "", reviewImage = null, regionId = "", primaryLine = false) {
  const formData = new FormData();
  formData.append("file", blob, makePageImageName());
  formData.append("lang", "bo");
  formData.append("page", String(state.pageNum));
  formData.append("source_name", state.sourceName);
  formData.append("bbox", JSON.stringify(bbox));
  formData.append("ocr_text", String(draftText || ""));
  if (reviewImage) formData.append("review_image", JSON.stringify(reviewImage));
  if (regionId) formData.append("region_id", regionId);
  if (primaryLine) formData.append("primary_line", "1");
  if (model) formData.append("model", model);

  // A line review can incur a model charge: never silently replay a failed POST.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 75000);
  try {
    const response = await fetch(endpoint, {method: "POST", body: formData, signal: controller.signal});
    const parsed = await parseOcrResponse(response);
    if (!response.ok) throw new Error(parsed.error || `HTTP ${response.status}`);
    assertSupportedAiVisionResponse(parsed);
    return parsed;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("本次单行识别等待已超过 75 秒，已停止等待，原结果保留。上游可能仍在处理，请勿连续重试。");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function mergeSourceCoordinates(lines, layoutLines) {
  return lines.map((line, index) => {
    const layoutLine = layoutLines[index] || {};
    return {
      ...line,
      bbox: normalizeBbox(line?.bbox) || normalizeBbox(layoutLine?.bbox),
      bboxApproximate: Boolean(
        line?.bboxApproximate ||
        line?.bbox_approximate ||
        layoutLine?.bboxApproximate ||
        layoutLine?.bbox_approximate
      ),
      index,
    };
  });
}

async function hydrateCurrentPageSourceCoordinates() {
  const result = state.ocrResults.get(state.pageNum);
  if (!needsSourceCoordinateHydration(result)) return;

  const pageNum = state.pageNum;
  if (state.layoutHydrationInFlight.has(pageNum)) {
    await state.layoutHydrationInFlight.get(pageNum);
    return;
  }

  const task = (async () => {
    const existingLines = getExistingResultLines(result);
    const endpoint = getAiVisionLayoutEndpoint();
    if (!endpoint) return;

    try {
      const blob = await getCurrentPageImageBlob();
      const formData = new FormData();
      formData.append("file", blob, makePageImageName());
      formData.append("line_count", String(existingLines.length));
      formData.append("ocr_profile", getSelectedOcrProfile().id);
      const response = await fetch(endpoint, { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const layoutLines = extractOcrLines(payload);
      if (!layoutLines.length || pageNum !== state.pageNum) return;

      const updated = state.ocrResults.get(pageNum);
      if (!updated) return;
      updated.lines = mergeSourceCoordinates(getExistingResultLines(updated), layoutLines);
      if (updated.compare?.llm?.lines?.length) {
        updated.compare.llm.lines = mergeSourceCoordinates(updated.compare.llm.lines, layoutLines);
      }
      updated.layoutVersion = SOURCE_LAYOUT_VERSION;
      updated.updatedAt = new Date().toISOString();
      state.ocrResults.set(pageNum, updated);
      saveCachedResults();
    } catch (error) {
      console.warn("Failed to hydrate source preview coordinates", error);
    }
  })();

  state.layoutHydrationInFlight.set(pageNum, task);
  try {
    await task;
  } finally {
    state.layoutHydrationInFlight.delete(pageNum);
  }
}

function assertSupportedAiVisionResponse(parsed) {
  const model = getOcrResponseModel(parsed?.raw).toLowerCase();
  const provider = getOcrResponseProvider(parsed?.raw).toLowerCase();
  if (provider === "mathpix" || model.includes("mathpix")) {
    throw new Error(
      "Gemini 已拒绝 Mathpix 结果：Mathpix 主要用于数学公式，不适合作为藏文 OCR 模型。请使用 Gemini 重新识别。"
    );
  }
}

// Match stored results to physical source rows, never to the current crop version.
function matchStoredOcrRow(line, rows, used = new Set()) {
  const a = normalizeBbox(line?.bbox);
  if (!a) return -1;
  const matches = rows.map((row, index) => {
    const b = normalizeBbox(row?.bbox);
    if (!b || used.has(index) || (line.regionId && row.regionId && line.regionId !== row.regionId)) return null;
    const overlapY = Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    const overlapX = Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
    if (overlapY < Math.min(a.height,b.height)*.5 || overlapX <= 0) return null;
    return { index, distance: Math.abs(a.y+a.height/2-b.y-b.height/2) };
  }).filter(Boolean).sort((a,b)=>a.distance-b.distance);
  if (matches.length > 1 && Math.abs(matches[0].distance-matches[1].distance) < .001) return -1;
  return matches[0]?.index ?? -1;
}

function mergeRecognizedModelResults(previous, incoming, source, incomingLines, incomingText) {
  const target = source === 'bdrc' ? 'bdrc' : 'llm';
  const fresh = normalizeOcrCompare(incoming) || normalizeOcrCompare({
    [target]: {label: target === 'bdrc' ? 'BDRC' : 'Gemini', text: incomingText, lines: incomingLines},
  });
  if (!previous || !fresh) return fresh;
  const rows = incomingLines.map(line=>({...line}));
  const oldRows = Array.from({length:Math.max(previous.bdrc.lines.length, previous.llm.lines.length)}, (_,i)=> {
    const a=previous.bdrc.lines[i], b=previous.llm.lines[i];
    return a?.bbox ? a : b || a || {};
  });
  const used = new Set();
  const mapping = oldRows.map((line,index)=> {
    let next = matchStoredOcrRow(line, rows, used);
    if (next < 0 && !normalizeBbox(line.bbox) && rows.length === oldRows.length && !normalizeBbox(rows[index]?.bbox) && !used.has(index)) next=index;
    if (next < 0) { next=rows.length; rows.push({...line, text:''}); }
    used.add(next); return next;
  });
  const merged = {...previous, ...fresh};
  for (const side of ['bdrc','llm']) {
    const replace = source === 'bdrc-ai' || side === target;
    const saved = rows.map((row,index)=>({...row,text:'',index,missing:true}));
    previous[side].lines.forEach((line,index)=>{saved[mapping[index]]={...line,index:mapping[index]};});
    if (replace) fresh[side].lines.forEach((line,index)=> {
      // A failed recognition is not a new transcription.
      if ((!line.error && !line.missing && line.text?.trim()) || !saved[index]?.text) saved[index]={...line,index};
    });
    merged[side]={...(replace ? fresh[side] : previous[side]),lines:saved,text:joinActiveOcrLines(saved)};
  }
  for (const key of ['qwenReviews','openaiReviews']) {
    merged[key]=(previous[key]||[]).map(review=>({...review,index:mapping[review.index] ?? review.index}));
  }
  merged.sharedErrors=(previous.sharedErrors||[]).map(mark=> {
    const index=mapping[mark.blockIndex] ?? mark.blockIndex;
    const result={...mark,blockIndex:index};
    for(const side of ['bdrc','llm']) {
      if ((source==='bdrc-ai'||side===target) && merged[side].lines[index]?.text !== previous[side].lines[mark.blockIndex]?.text) result[`${side}Ranges`]=[];
    }
    return result;
  });
  return merged;
}

function saveOcrResultFromParsed(parsed, source, statusMessage, fallbackLines = [], preferredView = "lines") {
  const text = getParsedOcrText(parsed);
  const rawLines = getParsedOcrLines(parsed);
  const lines = rawLines.length ? rawLines : makeOcrLinesFromText(text, fallbackLines);
  const recognizedAt = new Date().toISOString();
  const previous = getOcrSourceCompare(state.ocrResults.get(state.pageNum));
  const compare = mergeRecognizedModelResults(previous, parsed.compare, source, lines, text);
  if (source === "ai-vision" && compare?.llm) {
    compare.llm.model = getOcrResponseModel(parsed.raw);
    compare.llm.provider = getOcrResponseProvider(parsed.raw);
  }
  if (compare?.llm && !compare.llm.recognizedAt) {
    compare.llm.recognizedAt = recognizedAt;
  }
  state.ocrResults.set(state.pageNum, {
    text,
    raw: parsed.raw,
    compare,
    lines,
    regions: normalizeOcrRegions(parsed.regions || parsed.raw?.regions),
    regionOrder: normalizeRegionOrder(parsed.region_order || parsed.regionOrder),
    layoutVersion: SOURCE_LAYOUT_VERSION,
    ocrProfile: getSelectedOcrProfile().id,
    source,
    updatedAt: recognizedAt,
  });
  saveCachedResults();
  els.ocrText.value = text;
  setOcrView(preferredView === "proofread" ? "proofread" : preferredView === "compare" && compare ? "compare" : "lines");
  const statusType = statusMessage.includes("失败") || statusMessage.includes("未填写") ? "warn" : "ok";
  setStatus(statusMessage, statusType);
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
}

function saveSmartOcrCompareResult({ bdrcParsed, aiParsed = null, aiError = "", bdrcError = "", aiPending = false, statusMessage, statusType = "ok" }) {
  const bdrcText = getParsedOcrText(bdrcParsed);
  const bdrcRawLines = getParsedOcrLines(bdrcParsed);
  const bdrcLines = bdrcRawLines.length
    ? bdrcRawLines
    : bdrcError
      ? [{
          text: `BDRC 当前不可用：${bdrcError}`,
          bbox: null,
          index: 0,
          error: true,
        }]
      : makeOcrLinesFromText(bdrcText);
  const aiText = getParsedOcrText(aiParsed);
  const aiRawLines = getParsedOcrLines(aiParsed);
  const aiModel = getOcrResponseModel(aiParsed?.raw);
  const aiProvider = getOcrResponseProvider(aiParsed?.raw);
  const hasAiContent = Boolean(aiText || aiRawLines.some((line) => String(line?.text || "").trim()));
  const aiLines = hasAiContent
    ? (aiRawLines.length ? aiRawLines : makeOcrLinesFromText(aiText))
    : aiPending
      ? [{
          text: "Gemini 正在识别...",
          bbox: null,
          index: 0,
          diagnostic: true,
          pending: true,
        }]
    : [{
        text: aiError || "Gemini 未返回文本。",
        bbox: null,
        index: 0,
        error: true,
      }];
  const result = {
    raw: {
      source: "smart",
      bdrc: bdrcParsed.raw,
      bdrc_error: bdrcError || "",
      ai: aiParsed?.raw || null,
      ai_error: aiError || "",
    },
    text: aiText || bdrcText,
    compare: {
      note: bdrcError
        ? "BDRC 初稿不可用，已在左栏显示原因；右栏为 Gemini 识别结果。"
        : aiError
        ? "右栏 Gemini / LLM 未返回可用文本，已显示失败原因；左栏 BDRC 初稿仍可继续人工校对。"
        : "左栏为 BDRC OCR 初稿，右栏为 Gemini / LLM 识别或复核结果。",
      bdrc: {
        label: "BDRC",
        text: bdrcText,
        lines: bdrcLines,
        error: Boolean(bdrcError),
      },
      llm: {
        label: "Gemini / LLM",
        text: aiText,
        lines: aiLines,
        error: Boolean(aiError),
        pending: aiPending,
        model: aiModel,
        provider: aiProvider,
        expectedLineCount: countNonEmptyOcrLines(bdrcLines),
        returnedLineCount: hasAiContent ? countNonEmptyOcrLines(aiLines) : 0,
      },
    },
  };
  saveOcrResultFromParsed(result, "bdrc-ai", statusMessage, bdrcLines, "compare");
  if (statusType !== "ok") {
    setStatus(statusMessage, statusType);
  }
}

function makeOcrLinesFromText(text, fallbackLines = []) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeOcrTextSpacing(line.trim()))
    .filter(Boolean)
    .map((line, index) => ({
      text: line,
      bbox: fallbackLines[index]?.bbox || null,
      index,
    }));
}

function countNonEmptyOcrLines(lines) {
  return (lines || []).filter((line) => !line?.deleted && String(line?.text || "").trim()).length;
}

function countTextLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .length;
}

function countParsedOcrLines(parsed) {
  const rawLines = getParsedOcrLines(parsed);
  return rawLines.length ? countNonEmptyOcrLines(rawLines) : countTextLines(parsed?.text || "");
}

function getParsedOcrLines(parsed) {
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : parsed?.raw ? extractOcrLines(parsed.raw) : [];
  return lines.map((line) => ({
        ...line,
        text: normalizeOcrTextSpacing(line?.text || ""),
      }));
}

function getParsedOcrText(parsed) {
  if (!parsed) return "";
  const text = normalizeOcrTextSpacing(String(parsed.text || "").trim());
  if (text) return text;
  return getParsedOcrLines(parsed)
    .map((line) => line.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getOcrResponseModel(raw) {
  if (!raw || typeof raw !== "object") return "";
  return String(raw.model || raw.modelRef || raw.model_ref || raw.raw?.model || raw.raw?.modelRef || "").trim();
}

function getOcrResponseProvider(raw) {
  if (!raw || typeof raw !== "object") return "";
  return String(raw.provider || raw.raw?.provider || "").trim();
}

function normalizeOcrCompare(compare) {
  if (!compare || typeof compare !== "object") return null;
  const bdrc = normalizeOcrCompareSide(compare.bdrc || compare.bdrC || compare.left);
  const llm = normalizeOcrCompareSide(compare.llm || compare.ai || compare.right);
  if (!bdrc.text && !llm.text && !compare.qwenReviews?.length && !compare.openaiReviews?.length) return null;
  return {
    note: String(compare.note || ""),
    bdrc,
    llm,
    openaiReviews: Array.isArray(compare.openaiReviews) ? compare.openaiReviews.filter((review) => Number.isInteger(review?.index) && typeof review?.text === "string" && review?.model !== "ChatGPT 对话复核") : [],
    qwenReviews: Array.isArray(compare.qwenReviews) ? compare.qwenReviews.filter((review) => Number.isInteger(review?.index) && typeof review?.text === "string") : [],
    qwenReviewArchive: Array.isArray(compare.qwenReviewArchive)
      ? compare.qwenReviewArchive.filter((review) => Number.isInteger(review?.originalIndex) && typeof review?.text === "string") : [],
    sharedErrors: normalizeSharedErrorMarks(compare.sharedErrors || compare.commonErrors || compare.sharedErrorMarks),
  };
}

function normalizeSharedErrorMarks(marks) {
  if (!Array.isArray(marks)) return [];
  return marks
    .map((mark, index) => {
      if (!mark || typeof mark !== "object") return null;
      const blockIndex = Number(mark.blockIndex ?? mark.rowIndex ?? mark.index);
      if (!Number.isInteger(blockIndex) || blockIndex < 0) return null;
      const normalized = {
        id: String(mark.id || `shared-error-${blockIndex}-${index}`),
        blockIndex,
        text: String(mark.text || ""),
        bdrcRanges: normalizeTextRanges(mark.bdrcRanges || mark.bdrc || mark.leftRanges),
        llmRanges: normalizeTextRanges(mark.llmRanges || mark.aiRanges || mark.ai || mark.rightRanges),
        model: String(mark.model || mark.llmModel || ""),
        provider: String(mark.provider || mark.llmProvider || ""),
        requestId: String(mark.requestId || mark.request_id || ""),
        ocrRunAt: String(mark.ocrRunAt || mark.recognizedAt || ""),
        createdAt: String(mark.createdAt || ""),
      };
      return normalized.bdrcRanges.length || normalized.llmRanges.length ? normalized : null;
    })
    .filter(Boolean);
}

function normalizeTextRanges(ranges) {
  if (!Array.isArray(ranges)) return [];
  return mergeRanges(ranges.map((range) => ({
    start: Number(range?.start),
    end: Number(range?.end),
  })));
}

function normalizeOcrQualityReviews(reviews) {
  if (!Array.isArray(reviews)) return [];
  return reviews
    .map((review, index) => {
      if (!review || typeof review !== "object") return null;
      const pageNum = Number(review.pageNum);
      const blockIndex = Number(review.blockIndex);
      const reviewedChars = Number(review.reviewedChars);
      const errorChars = Number(review.errorChars);
      if (!Number.isInteger(pageNum) || pageNum < 1 || !Number.isInteger(blockIndex) || blockIndex < 0) return null;
      if (!Number.isFinite(reviewedChars) || reviewedChars < 0 || !Number.isFinite(errorChars) || errorChars < 0) return null;
      return {
        id: String(review.id || `quality-review-${pageNum}-${blockIndex}-${index}`),
        pageNum,
        blockIndex,
        model: String(review.model || "未知模型"),
        provider: String(review.provider || ""),
        requestId: String(review.requestId || review.request_id || ""),
        ocrRunAt: String(review.ocrRunAt || ""),
        reviewedAt: String(review.reviewedAt || ""),
        reviewedChars: Math.round(reviewedChars),
        errorChars: Math.min(Math.round(errorChars), Math.round(reviewedChars)),
      };
    })
    .filter(Boolean);
}

function normalizeOcrCompareSide(side) {
  if (!side || typeof side !== "object") {
    return { label: "", text: "", lines: [] };
  }
  const lines = Array.isArray(side.lines)
    ? side.lines.map((line, index) => {
        if (typeof line === "string") {
          return { text: normalizeOcrTextSpacing(line), bbox: null, index };
        }
        return {
          text: normalizeOcrTextSpacing(line?.text || line?.content || line?.value || ""),
          bbox: normalizeBbox(line?.bbox || line?.box || line?.bounding_box),
          bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
          regionId: line?.regionId || line?.region_id || line?.id || "",
          regionLabel: line?.regionLabel || line?.region_label || line?.label || "",
          regionRole: line?.regionRole || line?.region_role || line?.role || "",
          regionDirection: line?.regionDirection || line?.region_direction || line?.direction || "",
          regionRotation: line?.regionRotation || line?.region_rotation || line?.ocr_rotation || "",
          regionLineCount: Number(line?.regionLineCount || line?.region_line_count || line?.line_count || line?.lineCount || line?.lines?.length || 0) || 0,
          manualBaselineText: typeof line?.manualBaselineText === "string" ? line.manualBaselineText : undefined,
          manuallyEdited: Boolean(line?.manuallyEdited),
          manualErrorChars: Math.max(0, Number(line?.manualErrorChars || 0)),
          manualEditRanges: getManualEditRanges(line),
          index,
          error: Boolean(line?.error),
          missing: Boolean(line?.missing),
          diagnostic: Boolean(line?.diagnostic),
          deleted: Boolean(line?.deleted),
          model: String(line?.model || ""),
          provider: String(line?.provider || ""),
        };
      })
    : [];
  const lineText = joinActiveOcrLines(lines);
  const text = String(
    side.text ||
    side.ocr_text ||
    side.ocrText ||
    side.markdown ||
    side.answer ||
    side.content ||
    side.output ||
    lineText ||
    ""
  ).trim();
  const normalizedText = normalizeOcrTextSpacing(text);
  return {
    label: String(side.label || ""),
    text: normalizedText,
    lines: lines.length ? lines : makeOcrLinesFromText(normalizedText),
    regions: normalizeOcrRegions(side.regions),
    regionOrder: normalizeRegionOrder(side.region_order || side.regionOrder),
    error: Boolean(side.error),
    pending: Boolean(side.pending || side.isPending),
    model: String(side.model || ""),
    provider: String(side.provider || ""),
    recognizedAt: String(side.recognizedAt || side.ocrRunAt || ""),
    expectedLineCount: Number(side.expectedLineCount || 0),
    returnedLineCount: Number(side.returnedLineCount || 0),
  };
}

function getUniqueHighRiskClustersFromText(text) {
  const seen = new Set();
  return getHighRiskClusterScan(text)
    .filter((cluster) => cluster.highRisk)
    .map((cluster) => cluster.text)
    .filter((cluster) => {
      if (seen.has(cluster)) return false;
      seen.add(cluster);
      return true;
    });
}

function buildAiOcrPrompt(bdrcText, profileId = state.ocrProfile) {
  const profile = OCR_PROFILES[profileId] || OCR_PROFILES[DEFAULT_OCR_PROFILE];
  const bdrcLineCount = countTextLines(bdrcText);
  return [
    `请识别图片中的藏文文字。资料类型：${profile.label}。`,
    profile.prompt,
    "重点检查上加字、下加字、元音符号和堆叠字，不要根据语义自由扩写。",
    "如果提供了 BDRC OCR 文本，请只在图像证据支持时修正它。",
    bdrcLineCount
      ? `BDRC OCR 初稿共有 ${bdrcLineCount} 行。请必须输出 ${bdrcLineCount} 行，用换行逐行分隔；不得只输出前几行。看不清或无法确认的行，请保留 BDRC 原行，只修正有图像证据的字。`
      : "请完整输出整页所有藏文行，用换行逐行分隔；不得只输出前几行。",
    "只输出纯藏文文本，不要输出编号、解释、Markdown 表格或代码块。",
    bdrcText ? `BDRC OCR 初稿：\n${bdrcText}` : "",
  ].filter(Boolean).join("\n\n");
}

async function extractCurrentPdfPageText() {
  if (state.remoteServerPdf && state.remoteBookId) {
    const bookId = state.remoteBookId;
    const pageNum = state.pageNum;
    const response = await fetchWithCloudTimeout(
      `${window.location.origin}/api/books/${encodeURIComponent(bookId)}/pages/${pageNum}/text`,
      { credentials: "same-origin" }, 30000,
    );
    const payload = await response.json().catch(() => ({}));
    if (bookId !== state.remoteBookId || pageNum !== state.pageNum) throw new Error("页面已切换，丢弃过期的 PDF 文本层结果");
    if (!response.ok) throw new Error(payload.detail || `PDF 文本层 HTTP ${response.status}`);
    const text = String(payload.text || "").trim();
    return {
      text,
      raw: { source: "pdf-text", page: pageNum },
      lines: (Array.isArray(payload.lines) ? payload.lines : text.split("\n"))
        .filter(Boolean).map((line, index) => ({ text: line, bbox: null, index })),
    };
  }
  if (!state.pdfDoc) return { text: "", raw: null, lines: [] };
  const page = await state.pdfDoc.getPage(state.pageNum);
  const content = await page.getTextContent();
  const items = Array.isArray(content.items) ? content.items : [];
  const rows = groupPdfTextItemsIntoLines(items);
  const text = rows.map((row) => row.text).filter(Boolean).join("\n").trim();
  return {
    text,
    raw: { source: "pdf-text", items, page: state.pageNum },
    lines: rows.map((row, index) => ({ text: row.text, bbox: null, index })),
  };
}

async function primeCurrentPageDirectText(mode = "silent") {
  if (state.sourceType !== "pdf") return null;

  try {
    const directText = await ensureCurrentPageDirectText({ updatePanel: true });
    if (!directText?.text) {
      if (mode === "load") {
        setStatus(`已载入 ${state.sourceName}，第 1 页未发现可直接提取文本；如果是扫描件，请点“识别”。`, "warn");
      }
      return directText;
    }

    if (mode === "load") {
      setStatus(`已识别源文档属性：可编辑文字 PDF。已直接提取第 1 页文本，可直接翻译，无需 OCR。`, "ok");
    } else if (mode === "page" && directText.persisted) {
      setStatus(`第 ${state.pageNum} 页已从 PDF 文本层直接提取，可直接翻译。`, "ok");
    }
    return directText;
  } catch (error) {
    if (mode === "load") {
      setStatus(`已载入 PDF，但文本层检查失败：${error.message || error}。可继续使用 OCR。`, "warn");
    }
    return null;
  }
}

async function ensureCurrentPageDirectText(options = {}) {
  const { overwrite = false, updatePanel = false } = options;
  const targetPage = state.pageNum;
  const targetBookId = state.remoteBookId;
  const targetCacheKey = state.cacheKey;
  const existing = state.ocrResults.get(state.pageNum);
  const existingText = (existing?.text || "").trim();

  if (!overwrite && existing?.source === "manual" && existingText) {
    return {
      text: existingText,
      source: "manual",
      label: getResultSourceLabel(existing),
      persisted: false,
      fromExisting: true,
    };
  }

  if (state.sourceType !== "pdf") {
    if (existingText && isDirectTextSource(existing?.source)) {
      return {
        text: existingText,
        source: existing.source,
        label: getResultSourceLabel(existing),
        persisted: false,
        fromExisting: true,
      };
    }
    return { text: "", source: "", label: "", persisted: false };
  }

  if (!overwrite && existing?.source === "pdf-text" && existingText) {
    if (!isUsablePdfDirectText(existingText)) {
      state.ocrResults.delete(state.pageNum);
      saveCachedResults();
      if (updatePanel) {
        els.ocrText.value = "";
        updateOcrPanelForPage();
        updateSummary();
        updateThumbnailState();
      }
    } else {
      return {
        text: existingText,
        source: "pdf-text",
        label: getResultSourceLabel(existing),
        persisted: false,
        fromExisting: true,
      };
    }
  }

  if (!overwrite && existing?.source === "pdf-text" && existingText && isUsablePdfDirectText(existingText)) {
    return {
      text: existingText,
      source: "pdf-text",
      label: getResultSourceLabel(existing),
      persisted: false,
      fromExisting: true,
    };
  }

  const pdfTextResult = await extractCurrentPdfPageText();
  if (targetPage !== state.pageNum || targetBookId !== state.remoteBookId || targetCacheKey !== state.cacheKey ||
      state.ocrResults.get(targetPage) !== existing ||
      (state.ocrResults.get(targetPage)?.text || "").trim() !== existingText) {
    return { text: "", source: "pdf-text", label: "PDF 文本层", persisted: false, stale: true };
  }
  if (!pdfTextResult.text) {
    return { text: "", source: "pdf-text", label: "PDF 文本层", persisted: false };
  }

  if (!isUsablePdfDirectText(pdfTextResult.text)) {
    if (existing?.source === "pdf-text") {
      state.ocrResults.delete(state.pageNum);
      saveCachedResults();
      if (updatePanel) {
        els.ocrText.value = "";
        updateOcrPanelForPage();
        updateSummary();
        updateThumbnailState();
      }
    }
    return {
      text: "",
      source: "pdf-text",
      label: "PDF 文本层",
      persisted: false,
      rejected: true,
      reason: "PDF 文本层疑似字体编码乱码",
    };
  }

  const shouldPersist = shouldReplaceExistingWithPdfText(existing, existingText, overwrite);

  if (shouldPersist) {
    state.ocrResults.set(state.pageNum, {
      text: pdfTextResult.text,
      raw: pdfTextResult.raw,
      lines: pdfTextResult.lines,
      source: "pdf-text",
      updatedAt: new Date().toISOString(),
    });
    saveCachedResults();
    if (updatePanel) {
      els.ocrText.value = pdfTextResult.text;
      updateOcrPanelForPage();
      updateSummary();
      updateThumbnailState();
    }
  }

  return {
    text: pdfTextResult.text,
    source: "pdf-text",
    label: "PDF 文本层",
    persisted: shouldPersist,
  };
}

function isUsablePdfDirectText(text) {
  const value = String(text || "").trim();
  if (!value) return false;

  const visibleChars = [...value].filter((char) => !/\s/.test(char));
  if (visibleChars.length < 12) return false;

  const tibetanCount = visibleChars.filter((char) => /[\u0F00-\u0FFF]/u.test(char)).length;
  const cjkCount = visibleChars.filter((char) => /[\u3400-\u9FFF]/u.test(char)).length;
  const latinExtendedCount = visibleChars.filter((char) => /[\u00C0-\u024F]/u.test(char)).length;
  const replacementCount = visibleChars.filter((char) => char === "\uFFFD").length;
  const controlCount = visibleChars.filter((char) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(char)).length;
  const readableScriptCount = tibetanCount + cjkCount;
  const suspiciousCount = latinExtendedCount + replacementCount + controlCount;
  const tibetanRatio = tibetanCount / visibleChars.length;
  const cjkRatio = cjkCount / visibleChars.length;
  const latinExtendedRatio = latinExtendedCount / visibleChars.length;
  const suspiciousRatio = suspiciousCount / visibleChars.length;

  if (tibetanCount >= 8) {
    if (latinExtendedCount >= 4 && latinExtendedRatio >= 0.04) {
      return false;
    }
    return tibetanRatio >= 0.65 && suspiciousRatio < 0.08;
  }

  if (latinExtendedCount >= 4 && latinExtendedCount > tibetanCount + cjkCount) {
    return false;
  }

  if (cjkCount >= 10 && cjkRatio >= 0.5 && suspiciousRatio < 0.08) {
    return true;
  }

  if (suspiciousCount >= 5 && suspiciousCount > readableScriptCount) {
    return false;
  }

  const plainLatinCount = visibleChars.filter((char) => /[A-Za-z0-9.,;:!?'"()[\]{}\-_/]/.test(char)).length;
  return plainLatinCount >= 20 && suspiciousCount / visibleChars.length < 0.08;
}

function groupPdfTextItemsIntoLines(items) {
  const rows = [];
  items.forEach((item) => {
    const text = String(item.str || "").trim();
    if (!text) return;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const y = Number(transform[5] || 0);
    const x = Number(transform[4] || 0);
    let row = rows.find((candidate) => Math.abs(candidate.y - y) < 4);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text });
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({
      text: row.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join("")
        .trim(),
    }))
    .filter((row) => row.text);
}

async function extractDocxText(file) {
  const buffer = await file.arrayBuffer();
  const documentXmlBytes = await readZipEntry(buffer, "word/document.xml");
  const xml = new TextDecoder("utf-8").decode(documentXmlBytes);
  return extractTextFromDocxXml(xml);
}

async function readZipEntry(buffer, expectedName) {
  const view = new DataView(buffer);
  const decoder = new TextDecoder("utf-8");
  const eocdOffset = findZipEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("DOCX ZIP central directory is invalid");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));

    if (name === expectedName) {
      return extractZipLocalFile(buffer, localHeaderOffset, method, compressedSize);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`DOCX 中缺少 ${expectedName}`);
}

function findZipEndOfCentralDirectory(view) {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("DOCX ZIP end record not found");
}

async function extractZipLocalFile(buffer, localHeaderOffset, method, compressedSize) {
  const view = new DataView(buffer);
  if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
    throw new Error("DOCX ZIP local file header is invalid");
  }

  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset = localHeaderOffset + 30 + nameLength + extraLength;
  const data = new Uint8Array(buffer, dataOffset, compressedSize);

  if (method === 0) {
    return data;
  }
  if (method === 8) {
    return inflateZipDeflate(data);
  }
  throw new Error(`DOCX 压缩格式不支持：${method}`);
}

async function inflateZipDeflate(data) {
  if (!("DecompressionStream" in window)) {
    throw new Error("当前浏览器不支持 DOCX 解压，请先转为 PDF 或 Markdown。");
  }

  const formats = ["deflate-raw", "deflate"];
  let lastError = null;
  for (const format of formats) {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`DOCX 解压失败：${lastError?.message || lastError || "unknown error"}`);
}

function extractTextFromDocxXml(xml) {
  const documentXml = new DOMParser().parseFromString(xml, "application/xml");
  if (documentXml.getElementsByTagName("parsererror").length) {
    throw new Error("DOCX XML 解析失败");
  }

  const paragraphs = Array.from(documentXml.getElementsByTagNameNS("*", "p"));
  const lines = paragraphs
    .map((paragraph) => extractDocxParagraphText(paragraph).trim())
    .filter(Boolean);

  return lines.join("\n").trim();
}

function extractDocxParagraphText(paragraph) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const localName = node.localName;
      if (localName === "t") {
        parts.push(node.textContent || "");
        return;
      }
      if (localName === "tab") {
        parts.push("\t");
        return;
      }
      if (localName === "br" || localName === "cr") {
        parts.push("\n");
        return;
      }
    }
    node.childNodes.forEach(walk);
  };
  walk(paragraph);
  return parts.join("");
}

async function checkOcrService() {
  const endpoint = els.endpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写 BDRC OCR 接口地址。", "warn");
    return;
  }

  const healthUrl = endpoint.replace(/\/ocr\/?$/, "/health");
  try {
    setStatus("正在检查本地 BDRC OCR 服务...", "warn");
    const response = await fetch(healthUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json().catch(() => ({}));
    const model = payload.model || "BDRC";
    setStatus(`BDRC OCR 服务可用，当前模型：${model}。`, "ok");
  } catch (error) {
    setStatus(`BDRC OCR 服务不可用：${formatNetworkError(error, healthUrl)}`, "error");
  }
}

async function checkTranslateService() {
  const endpoint = els.translateEndpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写藏译汉接口地址。", "warn");
    return;
  }

  const healthUrl = getTranslateHealthUrl(endpoint);
  try {
    setStatus("正在检查本地藏译汉服务...", "warn");
    const payload = await fetchTranslateHealth(endpoint);
    const model = payload.model || payload.engine || "translate";
    const status = payload.status || (payload.loaded ? "ready" : "unknown");
    if (payload.loaded || status === "ready") {
      if (payload.provider === "model_aggregator") {
        setStatus(`藏译汉服务可用，模型聚合服务已连接，当前模型：${model}。`, "ok");
      } else {
        setStatus(`藏译汉服务可用，当前模型：${model}。`, "ok");
      }
    } else if (status === "loading") {
      setStatus(`藏译汉服务已启动，模型 ${model} 正在下载/加载。请稍后再点“检查翻译”。`, "warn");
    } else if (status === "error") {
      throw new Error(payload.error || "模型加载失败");
    } else {
      setStatus(`藏译汉服务已启动，但模型尚未就绪：${status}。`, "warn");
    }
  } catch (error) {
    setStatus(`藏译汉服务不可用：${formatNetworkError(error, healthUrl, "translate")}`, "error");
  }
}

async function fetchTranslateHealth(endpoint) {
  const healthUrl = getTranslateHealthUrl(endpoint);
  const response = await fetch(healthUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

function getTranslateHealthUrl(endpoint) {
  const url = new URL(endpoint, window.location.origin);
  const endpointPath = url.pathname.replace(/\/+$/, "");
  if (endpointPath.endsWith("/api/translate")) {
    url.pathname = `${endpointPath}/health`;
  } else if (endpointPath.endsWith("/translate")) {
    url.pathname = `${endpointPath.slice(0, -"/translate".length)}/health`;
  } else {
    url.pathname = `${endpointPath}/health`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function ensureTranslateReady(endpoint) {
  const payload = await fetchTranslateHealth(endpoint);
  const status = payload.status || (payload.loaded ? "ready" : "unknown");
  if (payload.loaded || status === "ready") {
    return true;
  }
  const model = payload.model || "translate";
  if (status === "loading") {
    setStatus(`藏译汉模型 ${model} 正在下载/加载，暂时不能翻译。请稍后点“检查翻译”。`, "warn");
    return false;
  }
  if (status === "error") {
    throw new Error(payload.error || "模型加载失败");
  }
  setStatus(`藏译汉模型尚未就绪：${status}。请先点“检查翻译”。`, "warn");
  return false;
}

async function runTranslateForCurrentPage() {
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  await syncPageInputBeforeAction();
  const translationPageNum = state.pageNum;
  const documentRequestId = state.documentRequestId;

  const endpoint = els.translateEndpointInput.value.trim();
  if (!endpoint) {
    setStatus("请填写藏译汉接口地址。", "warn");
    return;
  }

  if (state.sourceType === "pdf") {
    setStatus(`正在检查第 ${state.pageNum} 页 PDF 文本层...`, "warn");
  }
  const sourceInput = await resolveCurrentSourceTextForTranslation();
  if (state.pageNum !== translationPageNum || state.documentRequestId !== documentRequestId) {
    setStatus("页面已切换，请在需要翻译的页重新点击“翻译”。", "warn");
    return;
  }
  if (!sourceInput.text) {
    const message = state.sourceType === "pdf"
      ? "当前 PDF 页没有可提取文本，也没有 OCR/人工校对文本；如果是扫描件，请先点“识别”。"
      : "当前页还没有可翻译文本，请先导入文本、识别 OCR 或手动粘贴校对文本。";
    setStatus(message, "warn");
    return;
  }

  const role = getActiveTranslationRole();

  try {
    setTranslateBusy(true);
    const ready = await ensureTranslateReady(endpoint);
    if (!ready) {
      return;
    }
    setStatus(`正在翻译第 ${translationPageNum} 页${sourceInput.label || "源文本"}...`, "warn");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: sourceInput.text,
        source_text: sourceInput.text,
        source_kind: sourceInput.source,
        source_label: sourceInput.label,
        source_lang: role.sourceLang || "bo",
        target_lang: role.targetLang || "zh",
        src_lang: "bod_Tibt",
        tgt_lang: "zho_Hans",
        page: translationPageNum,
        source_name: state.sourceName,
        role_id: role.id,
        role_name: role.name,
        system_prompt: role.systemPrompt,
        user_prompt_template: role.userPromptTemplate,
        model: role.model || DEFAULT_TRANSLATION_MODEL,
        temperature: Number(role.temperature ?? 0.2),
        max_tokens: Number(role.maxTokens ?? 2048),
      }),
    });

    const parsed = await awaitTranslationResponse(response, endpoint);

    const text = parsed.text.trim();
    if (!text) throw new Error("翻译模型没有返回译文，请检查模型服务日志。");
    if (state.documentRequestId !== documentRequestId) {
      setStatus(`第 ${translationPageNum} 页翻译完成，但已切换项目；结果未写入当前项目。`, "warn");
      return;
    }
    state.translationResults.set(translationPageNum, {
      text,
      raw: parsed.raw,
      source: "api",
      roleId: role.id,
      roleName: role.name,
      updatedAt: new Date().toISOString(),
    });
    saveCachedResults();
    if (state.pageNum === translationPageNum) {
      els.translationText.value = text;
      updateTranslationPanelForPage();
    }
    const modelNote = parsed.raw?.fallback_used
      ? "；所选模型繁忙，已改用 Gemini 3.6 Flash"
      : "";
    setStatus(`第 ${translationPageNum} 页藏译汉完成${modelNote}${state.pageNum === translationPageNum ? "" : "，返回该页查看"}。`, "ok");
    updateTranslationSummary();
    updateThumbnailState();
  } catch (error) {
    setStatus(`藏译汉调用失败：${formatNetworkError(error, endpoint, "translate")}`, "error");
  } finally {
    setTranslateBusy(false);
  }
}

async function awaitTranslationResponse(response, endpoint) {
  let parsed = await parseTranslationResponse(response);
  if (!response.ok) throw new Error(parsed.error || `HTTP ${response.status}`);
  if (response.status !== 202) return parsed;

  const statusPath = parsed.raw?.status_url;
  if (!statusPath) throw new Error("翻译服务未返回任务查询地址。");
  const statusUrl = new URL(statusPath, endpoint);
  if (statusUrl.origin !== new URL(endpoint, window.location.origin).origin
      || !statusUrl.pathname.startsWith("/api/translate/jobs/")) {
    throw new Error("翻译服务返回了无效的任务查询地址。");
  }
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const poll = await fetch(statusUrl.toString(), { cache: "no-store" });
    parsed = await parseTranslationResponse(poll);
    if (!poll.ok) throw new Error(parsed.error || `HTTP ${poll.status}`);
    if (parsed.raw?.status === "queued" || parsed.raw?.status === "running") {
      if (parsed.raw.total > 0) {
        setStatus(`正在翻译当前页：已完成 ${parsed.raw.completed}/${parsed.raw.total} 段。`, "warn");
      }
      continue;
    }
    if (!parsed.raw || typeof parsed.raw !== "object"
        || !("translation" in parsed.raw || "translated_text" in parsed.raw || "text" in parsed.raw)) {
      throw new Error("翻译服务返回了无效的任务结果，请检查服务日志。");
    }
    return parsed;
  }
  throw new Error("翻译任务等待超过 20 分钟，请检查服务状态后重试。");
}

async function resolveCurrentSourceTextForTranslation() {
  const result = state.ocrResults.get(state.pageNum);
  const editorText = (els.ocrText.value || "").trim();

  if (result?.source === "manual" && editorText) {
    return {
      text: editorText,
      source: "manual",
      label: getResultSourceLabel(result),
    };
  }

  if (state.sourceType === "pdf") {
    try {
      const directText = await ensureCurrentPageDirectText({ updatePanel: true });
      if (directText.text) {
        return directText;
      }
    } catch (error) {
      setStatus(`PDF 文本层提取失败，回落 OCR/校对文本：${error.message || error}`, "warn");
    }
  }

  const fallbackText = editorText || (result?.text || "").trim();
  if (fallbackText) {
    return {
      text: fallbackText,
      source: result?.source || "ocr",
      label: getResultSourceLabel(result) || "OCR/校对文本",
    };
  }

  return { text: "", source: "", label: "" };
}

async function parseOcrResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const raw = await response.json();
    return {
      raw,
      text: extractTextFromJson(raw),
      error: raw.error || raw.message || raw.detail,
    };
  }

  const text = await response.text();
  return { raw: text, text, error: response.ok ? "" : text };
}

async function parseTranslationResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const raw = await response.json();
    return {
      raw,
      text: extractTranslationFromJson(raw),
      error: raw.error || raw.message || raw.detail,
    };
  }

  const text = await response.text();
  return { raw: text, text, error: response.ok ? "" : text };
}

function extractTextFromJson(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  const direct = (
    payload.text ||
    payload.ocr_text ||
    payload.ocrText ||
    payload.result_text ||
    payload.resultText ||
    payload.full_text ||
    payload.fullText ||
    payload.markdown ||
    payload.answer ||
    payload.content ||
    payload.value ||
    payload.output
  );
  if (typeof direct === "string") return direct;

  const choiceText = extractOpenAiChoiceText(payload.choices);
  if (choiceText) return choiceText;

  const candidateText = extractGeminiCandidateText(payload.candidates);
  if (candidateText) return candidateText;

  if (payload.result) {
    const nested = extractTextFromJson(payload.result);
    if (nested) return nested;
  }

  for (const key of ["data", "response", "payload", "output"]) {
    if (payload[key] && typeof payload[key] === "object") {
      const nested = extractTextFromJson(payload[key]);
      if (nested) return nested;
    }
  }

  const lines = payload.lines || payload.blocks || payload.items;
  if (Array.isArray(lines)) {
    const text = lines
      .map((line) => {
        if (typeof line === "string") return line;
        return line.text || line.ocr_text || line.ocrText || line.content || line.value || "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  return JSON.stringify(payload, null, 2);
}

function extractOpenAiChoiceText(choices) {
  if (!Array.isArray(choices)) return "";
  const chunks = [];
  choices.forEach((choice) => {
    if (!choice || typeof choice !== "object") return;
    const message = choice.message || choice.delta || {};
    const content = message.content || choice.text || "";
    if (typeof content === "string") {
      chunks.push(content);
      return;
    }
    if (Array.isArray(content)) {
      content.forEach((part) => {
        if (typeof part === "string") {
          chunks.push(part);
        } else if (part && typeof part.text === "string") {
          chunks.push(part.text);
        }
      });
    }
  });
  return chunks.join("\n").trim();
}

function extractGeminiCandidateText(candidates) {
  if (!Array.isArray(candidates)) return "";
  const chunks = [];
  candidates.forEach((candidate) => {
    const parts = candidate?.content?.parts || candidate?.parts || [];
    if (!Array.isArray(parts)) return;
    parts.forEach((part) => {
      if (typeof part === "string") {
        chunks.push(part);
      } else if (part && typeof part.text === "string") {
        chunks.push(part.text);
      }
    });
  });
  return chunks.join("\n").trim();
}

function extractOcrLines(payload) {
  if (!payload || typeof payload === "string") return [];
  const regionLines = flattenTraditionalRegionLines(payload.regions);
  if (regionLines.length) return regionLines;
  const candidates = payload.regions || payload.lines || payload.blocks || payload.items;
  if (!Array.isArray(candidates)) {
    for (const key of ["result", "data", "response", "payload", "output"]) {
      if (payload[key] && typeof payload[key] === "object") {
        const nested = extractOcrLines(payload[key]);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  return candidates
    .map((line, index) => {
      if (typeof line === "string") {
        return { text: line, image: "", index };
      }
      return {
        text: line?.text || line?.ocr_text || line?.ocrText || line?.content || line?.value || "",
        bbox: normalizeBbox(line?.bbox || line?.box || line?.bounding_box),
        bboxApproximate: Boolean(line?.bbox_approximate || line?.bboxApproximate),
        reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
        regionId: line?.region_id || line?.regionId || line?.id || "",
        regionLabel: line?.region_label || line?.regionLabel || line?.label || "",
        regionRole: line?.region_role || line?.regionRole || line?.role || "",
        regionDirection: line?.region_direction || line?.regionDirection || line?.direction || "",
        regionLineCount: Number(line?.line_count ?? line?.lineCount ?? line?.lines?.length ?? 0) || 0,
        index,
        error: Boolean(line?.error),
        missing: Boolean(line?.missing),
        diagnostic: Boolean(line?.diagnostic),
      };
    })
    .filter((line) => line.text || line.bbox);
}

function flattenTraditionalRegionLines(regions) {
  if (!Array.isArray(regions) || !regions.length) return [];
  const normalizedRegions = normalizeOcrRegions(regions);
  const output = [];

  normalizedRegions.forEach((region) => {
    const sourceLines = region.lines?.length
      ? region.lines
      : String(region.text || "")
        .split(/\r?\n/)
        .map((text) => ({ text, bbox: region.bbox, bboxApproximate: true }));

    sourceLines.forEach((line, regionLineIndex) => {
      const text = normalizeOcrTextSpacing(String(line?.text || "").trim());
      if (!text) return;
      output.push({
        text,
        bbox: normalizeBbox(line?.bbox) || region.bbox,
        bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
        regionId: region.id,
        regionLabel: region.label,
        regionRole: region.role,
        regionDirection: region.direction,
        regionRotation: region.ocrRotation,
        regionLineCount: region.lineCount || sourceLines.length,
        regionLineIndex,
        index: output.length,
      });
    });
  });

  return output;
}

function formatOcrLineDisplayNumber(line, index) {
  const regionPrefix = {
    左侧: "左",
    中间: "中",
    右侧: "右",
  }[line?.regionLabel];
  if (regionPrefix) {
    return `${regionPrefix}${String(Number(line.regionLineIndex || 0) + 1).padStart(2, "0")}`;
  }
  return String(index + 1).padStart(2, "0");
}

function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== "object") return null;
  const x = Number(bbox.x);
  const y = Number(bbox.y);
  const width = Number(bbox.width ?? bbox.w);
  const height = Number(bbox.height ?? bbox.h);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    width: clamp(width, 0, Math.max(0, 1 - clamp(x, 0, 1))),
    height: clamp(height, 0, Math.max(0, 1 - clamp(y, 0, 1))),
  };
}

function normalizeOcrRegions(regions) {
  if (!Array.isArray(regions)) return [];
  const canonicalRegions = CANONICAL_REGION_ORDER.map((id, index) => {
    const region = regions.find((candidate, candidateIndex) => normalizeRegionId(candidate, candidateIndex) === id);
    return { ...(region || {}), id, __canonicalIndex: index };
  });
  const sourceRegions = regions.some((region, index) => {
    const id = normalizeRegionId(region, index);
    return CANONICAL_REGION_ORDER.includes(id);
  }) ? canonicalRegions : regions;
  return sourceRegions.map((region, index) => {
    const regionId = normalizeRegionId(region, index);
    const defaults = CANONICAL_REGION_DEFAULTS[regionId] || {};
    const bbox = normalizeBbox(region?.bbox || region);
    const lines = Array.isArray(region?.lines)
      ? region.lines.map((line, lineIndex) => ({
          text: normalizeOcrTextSpacing(line?.text || line?.content || line?.value || ""),
          bbox: normalizeBbox(line?.bbox) || bbox,
          bboxApproximate: Boolean(line?.bboxApproximate || line?.bbox_approximate),
          reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
          index: lineIndex,
        })).filter((line) => line.text || line.bbox)
      : [];
    const text = normalizeOcrTextSpacing(
      String(region?.text || lines.map((line) => line.text).filter(Boolean).join("\n") || "")
    );
    return {
      id: regionId,
      label: String(region?.label || region?.region_label || defaults.label || ""),
      role: String(region?.role || region?.region_role || defaults.role || ""),
      direction: String(region?.direction || region?.region_direction || defaults.direction || ""),
      ocrRotation: String(region?.ocr_rotation || region?.ocrRotation || ""),
      textOrientation: String(region?.text_orientation || region?.textOrientation || defaults.textOrientation || ""),
      regionType: String(region?.region_type || region?.regionType || defaults.regionType || ""),
      bbox,
      text,
      lines,
      lineCount: Number(region?.line_count ?? region?.lineCount ?? lines.length) || 0,
      empty: Boolean(region?.empty) || !text,
      error: String(region?.error || ""),
    };
  });
}

function normalizeRegionId(region, index) {
  const raw = String(region?.id || region?.region_id || region?.label || region?.region_label || "")
    .trim()
    .toLowerCase();
  const aliases = {
    left: "left",
    "左": "left",
    "左侧": "left",
    "左欄": "left",
    center: "center",
    middle: "center",
    "中": "center",
    "中间": "center",
    "中間": "center",
    "正文": "center",
    "右": "right",
    "右侧": "right",
    "右欄": "right",
    right: "right",
  };
  return aliases[raw] || (CANONICAL_REGION_ORDER[index] || String(region?.id || region?.region_id || `region-${index + 1}`));
}

function normalizeRegionOrder(order) {
  void order;
  return CANONICAL_REGION_ORDER.slice();
}

function extractTranslationFromJson(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;

  const direct = (
    payload.translation ||
    payload.translated_text ||
    payload.translatedText ||
    payload.target_text ||
    payload.targetText ||
    payload.zh ||
    payload.text ||
    payload.output
  );
  if (typeof direct === "string") return direct;

  if (payload.result) {
    const nested = extractTranslationFromJson(payload.result);
    if (nested) return nested;
  }

  const candidates = payload.translations || payload.items || payload.lines;
  if (Array.isArray(candidates)) {
    const text = candidates
      .map((item) => {
        if (typeof item === "string") return item;
        return item.translation || item.translated_text || item.text || item.content || "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }

  return JSON.stringify(payload, null, 2);
}

async function getCurrentPageImageBlob() {
  if (state.sourceType === "image") {
    return state.imageBlob;
  }

  if (state.remoteServerPdf && state.remoteBookId) {
    return getRenderedPdfPageBlobWithCache(state.pageNum, Number(els.dpiInput.value) || 260);
  }

  if (state.pdfFile) {
    try {
      return await getRenderedPdfPageBlobWithCache(state.pageNum, Number(els.dpiInput.value) || 260);
    } catch (error) {
      console.warn("Local Poppler OCR render unavailable, falling back to PDF.js", error);
    }
  }

  const dpi = Number(els.dpiInput.value) || 260;
  const page = await state.pdfDoc.getPage(state.pageNum);
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法生成当前页 PNG。"));
    }, "image/png");
  });
}

async function getSourcePreviewPageBlob(pageNum) {
  if (state.sourceType === "image") return state.imageBlob;
  if (state.remoteServerPdf && state.remoteBookId) {
    return getRenderedPdfPageBlobWithCache(pageNum, Number(els.dpiInput.value) || 260, "jpeg");
  }
  const pdfDoc = state.pdfDoc;
  if (!pdfDoc) return getCurrentPageImageBlob();

  const page = await pdfDoc.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1 });
  const dpi = getBatchPdfRenderDpi(
    baseViewport.width, baseViewport.height, Number(els.dpiInput.value) || 260,
  );
  const cacheKey = `source-preview-client:${makePdfPageRenderCacheKey(pageNum, dpi)}`;
  const cached = state.pdfPageRenderCache.get(cacheKey);
  if (cached?.blob) return cached.blob;
  if (cached?.pending) return cached.pending;

  const pending = (async () => {
    try {
      const viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("无法创建预览画布");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成预览页图")), "image/jpeg", 0.92);
      });
    } catch (error) {
      if (state.pdfDoc !== pdfDoc) throw error;
      console.warn("Browser source preview render unavailable, falling back to server", error);
      return getRenderedPdfPageBlobWithCache(pageNum, dpi);
    }
  })();
  state.pdfPageRenderCache.set(cacheKey, { pending, url: "" });
  try {
    const blob = await pending;
    if (state.pdfDoc === pdfDoc) state.pdfPageRenderCache.set(cacheKey, { blob, url: "" });
    return blob;
  } catch (error) {
    state.pdfPageRenderCache.delete(cacheKey);
    throw error;
  }
}

async function downloadCurrentPageImage() {
  if (!state.pageCount) {
    setStatus("请先上传 PDF 或图片。", "warn");
    return;
  }

  try {
    await syncPageInputBeforeAction();
    const blob = await getCurrentPageImageBlob();
    downloadBlob(blob, makePageImageName());
    setStatus(`已导出第 ${state.pageNum} 页 PNG。`, "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function makePageImageName() {
  const safeName = (state.sourceName || "source")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "_");
  return `${safeName}_page_${String(state.pageNum).padStart(4, "0")}.png`;
}

async function copyCurrentText() {
  try {
    await navigator.clipboard.writeText(els.ocrText.value);
    setStatus("当前页 OCR 文本已复制。", "ok");
  } catch {
    els.ocrText.select();
    document.execCommand("copy");
    setStatus("当前页 OCR 文本已复制。", "ok");
  }
}

async function copyCurrentAiText() {
  const text = getCurrentAiOcrText();
  if (!text.trim()) {
    setStatus("当前页没有 Gemini OCR 文本可复制。", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus("当前页 Gemini OCR 文本已复制。", "ok");
  } catch {
    setStatus("浏览器剪贴板不可用，请在 Gemini 栏手动选择复制。", "warn");
  }
}

function getCurrentAiOcrText() {
  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result);
  if (compare?.llm?.text) return compare.llm.text;
  if (result?.source === "ai-vision") return result.text || "";
  return "";
}

async function copyCurrentTranslation() {
  try {
    await navigator.clipboard.writeText(els.translationText.value);
    setStatus("当前页译文已复制。", "ok");
  } catch {
    els.translationText.select();
    document.execCommand("copy");
    setStatus("当前页译文已复制。", "ok");
  }
}

function clearCurrentText() {
  if (!state.pageCount) return;
  state.ocrResults.delete(state.pageNum);
  els.ocrText.value = "";
  saveCachedResults();
  setStatus(`已清空第 ${state.pageNum} 页 OCR 文本。`, "ok");
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
}

function setOcrView(view) {
  state.ocrView = view === "text"
    ? "text"
    : view === "compare"
      ? "compare"
      : view === "proofread"
        ? "proofread"
        : "lines";
  const showLines = state.ocrView === "lines";
  const showCompare = state.ocrView === "compare";
  const showProofread = state.ocrView === "proofread";
  const showText = state.ocrView === "text";
  els.workspace.classList.toggle("proofread-merged-view", showProofread);
  els.ocrPaneEyebrow.textContent = showProofread ? "OCR 校对结果" : "OCR 识别结果";
  els.ocrLineCompare.classList.toggle("proofread-block-list", showProofread);
  els.ocrLineCompare.classList.toggle("is-hidden", showText);
  els.ocrText.classList.toggle("is-hidden", !showText);
  els.proofreadViewButton.classList.toggle("active", showProofread);
  els.compareViewButton.classList.toggle("active", showCompare);
  els.lineViewButton.classList.toggle("active", showLines);
  els.textViewButton.classList.toggle("active", showText);
  els.proofreadViewButton.setAttribute("aria-pressed", String(showProofread));
  els.compareViewButton.setAttribute("aria-pressed", String(showCompare));
  els.lineViewButton.setAttribute("aria-pressed", String(showLines));
  els.textViewButton.setAttribute("aria-pressed", String(showText));
  if (showProofread) {
    renderProofreadMergedView();
  } else if (showCompare) {
    renderOcrSourceCompareOnly();
  } else if (showLines) {
    renderOcrLineComparison();
  } else {
    clearSourceLineHighlight();
  }
  renderAiOcrPanelForPage();
}

function renderCurrentOcrView() {
  if (state.ocrView === "text") {
    clearSourceLineHighlight();
    renderAiOcrPanelForPage();
    return;
  }
  if (state.ocrView === "proofread") {
    renderProofreadMergedView();
    return;
  }
  if (state.ocrView === "compare") {
    renderOcrSourceCompareOnly();
    return;
  }
  renderOcrLineComparison();
}

function renderOcrSourceCompareOnly() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.remove("proofread-block-list");
  const compare = getVisibleServerCompare(getCurrentOcrCompareOrEmpty());
  const { side, peer, key } = getPrimaryOcrDisplay(compare);
  renderOcrSourceSide(els.ocrLineCompare, side, peer, key, compare);
  renderAiOcrPanelForPage(compare);
}

function renderOcrLineComparison() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.remove("proofread-block-list");
  if (!state.pageCount) {
    renderAiOcrPanelForPage();
    return;
  }

  const result = state.ocrResults.get(state.pageNum);
  const sourceCompare = getVisibleServerCompare(getOcrSourceCompare(result));
  if (sourceCompare) {
    const { side, peer, key } = getPrimaryOcrDisplay(sourceCompare);
    renderOcrSourceSide(els.ocrLineCompare, side, peer, key, sourceCompare);
    renderAiOcrPanelForPage(sourceCompare);
    return;
  }

  renderAiOcrPanelForPage();
  const lines = result?.lines || extractOcrLines(result?.raw);
  if (!lines?.length) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = result?.text
      ? "<strong>当前结果没有行坐标</strong><span>可切换到“文本”继续校对；重新识别当前页后可点击藏文定位原文。</span>"
      : "<strong>等待 OCR 识别</strong><span>识别完成后，这里会按行显示可编辑藏文；点击某行可在原页定位。</span>";
    els.ocrLineCompare.appendChild(empty);
    return;
  }

  lines.forEach((line, index) => {
    const row = document.createElement("section");
    row.className = "ocr-line-row";
    row.dataset.sourceRowIndex = String(index);
    row.dataset.sourceSide = "bdrc";
    row.classList.toggle("is-active", state.activeOcrLine === index);

    const rowHeader = document.createElement("div");
    rowHeader.className = "ocr-line-number";
    rowHeader.textContent = formatOcrLineDisplayNumber(line, index);
    if (line?.regionLabel) {
      rowHeader.title = `${line.regionLabel}第 ${Number(line.regionLineIndex || 0) + 1} 行`;
    }

    const saveStatus = document.createElement("span");
    saveStatus.className = "proofread-autosave-status";
    saveStatus.setAttribute("role", "status");
    saveStatus.setAttribute("aria-live", "polite");
    saveStatus.textContent = "修改自动保存";
    rowHeader.append(saveStatus);

    const content = document.createElement("div");
    content.className = "ocr-line-content";

    const preview = document.createElement("div");
    preview.className = "ocr-line-preview";
    if (line.deleted) preview.textContent = "此行的 OCR 结果已删除；可在校对视图撤销。";
    else renderOcrLineMarkup(preview, line.text || "", {manualEditRanges: getManualEditRanges(line)});

    const editor = document.createElement("textarea");
    editor.className = "ocr-line-editor";
    editor.rows = 1;
    editor.spellcheck = false;
    editor.value = line.deleted ? "" : line.text || "";
    editor.disabled = Boolean(line.deleted);
    editor.setAttribute("aria-label", `第 ${index + 1} 行 OCR 文本`);
    const activateLine = () => activateOcrLine(
      getSourceLineForRow(line, null),
      index,
      row,
    );
    row.addEventListener("click", activateLine);
    editor.addEventListener("focus", activateLine);
    editor.addEventListener("input", () => {
      updateManualEditTracking(line, editor.value || "", line.manualBaselineText ?? line.text ?? "");
      line.text = editor.value || "";
      renderOcrLineMarkup(preview, line.text, {manualEditRanges: getManualEditRanges(line)});
      resizeLineEditor(editor);
      const saved = syncLineEditorsToResult(lines);
      saveStatus.textContent = saved ? "已自动保存" : "保存失败，请重试";
      saveStatus.classList.toggle("is-error", !saved);
    });

    content.appendChild(preview);
    content.appendChild(editor);
    row.append(rowHeader, content);
    els.ocrLineCompare.appendChild(row);
    resizeLineEditor(editor);
  });
}

function renderAiOcrPanelForPage(compare = null) {
  if (!els.aiOcrLineCompare) return;
  const sourceCompare = getVisibleServerCompare(getAiOnlyDisplayCompare(compare || getCurrentOcrCompareOrEmpty()));
  renderOcrSourceSide(els.aiOcrLineCompare, sourceCompare.llm, sourceCompare.bdrc, "llm", sourceCompare);
  updateAiOcrPanelMeta(sourceCompare);
}

function getUnboundSavedParagraphs(result) {
  const stored = result?.lines || [];
  const paragraphs = String(result?.text || "").split(/\r?\n/).map(text => text.trim()).filter(Boolean);
  if (!stored.length || paragraphs.length <= stored.length || stored.some(line => line?.deleted)) return [];
  if (!stored.every((line, index) => String(line?.text || "").trim() === paragraphs[index])) return [];
  return paragraphs.slice(stored.length);
}

function renderProofreadMergedView() {
  els.ocrLineCompare.innerHTML = "";
  els.ocrLineCompare.classList.add("proofread-block-list");

  if (!state.pageCount) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = "<strong>等待加载文件</strong><span>加载 PDF 或图片后，这里会逐行显示原文和 Gemini 结果。</span>";
    els.ocrLineCompare.appendChild(empty);
    renderAiOcrPanelForPage();
    return;
  }

  const ensured = ensureProofreadCompareResult();
  const result = ensured.result;
  // The editor needs both candidates. Applying the AI-only display adapter
  // here erased the existing BDRC rows as soon as the user switched views.
  const compare = ensured.compare;
  renderAiOcrPanelForPage(compare);

  const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
  const aiLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
  const finalLines = result.lines?.length ? result.lines : makeOcrLinesFromText(result.text || "", bdrcLines);
  const rowCount = Math.max(bdrcLines.length, aiLines.length, finalLines.length);

  if (!rowCount) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    empty.innerHTML = "<strong>等待识别</strong><span>点击“识别”后，每行原文下方会出现可编辑的 Gemini 结果。</span>";
    els.ocrLineCompare.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  Array.from({ length: rowCount }, (_, index) => {
    const bdrcLine = bdrcLines[index] || { text: "", bbox: aiLines[index]?.bbox || finalLines[index]?.bbox || null, index };
    const rawAiLine = aiLines[index] || { text: "", bbox: bdrcLine.bbox || finalLines[index]?.bbox || null, index };
    const aiLine = makeProofreadAiLine(compare, rawAiLine, index, rawAiLine.bbox || bdrcLine.bbox || finalLines[index]?.bbox || null);
    const sourceLine =
      getSourceLineForRow(bdrcLine, aiLine) ||
      getSourceLineForRow(finalLines[index], null) ||
      makeEstimatedSourceLineForRow(index, rowCount);
    fragment.appendChild(renderProofreadBlockCard({
      index,
      bdrcLine,
      aiLine,
      finalLine: finalLines[index] || null,
      sourceLine,
      compare,
    }));
  });
  const unbound = getUnboundSavedParagraphs(result);
  if (unbound.length) {
    const notice = document.createElement("section");
    notice.className = "proofread-block-card";
    const title = document.createElement("strong");
    title.textContent = `另有 ${unbound.length} 段已保存校对文本，缺少分行绑定`;
    const detail = document.createElement("p");
    detail.textContent = "以下文字仍然保留。段落不等于原图物理行，暂以只读方式完整显示；未重新识别或覆盖任何校对。";
    notice.append(title, detail);
    unbound.forEach((text, index) => {
      const paragraph = document.createElement("textarea");
      paragraph.readOnly = true;
      paragraph.rows = 3;
      paragraph.value = text;
      paragraph.setAttribute("aria-label", `保留的未绑定校对段落 ${index + 1}`);
      paragraph.style.width = "100%";
      notice.append(paragraph);
    });
    fragment.append(notice);
  }
  els.ocrLineCompare.appendChild(fragment);
  if (window.lucide) {
    window.lucide.createIcons();
  }
  updateSourcePreviewScaleButtons();
}

function joinActiveOcrLines(lines) {
  return (lines || [])
    .filter((line) => !line?.deleted)
    .map((line) => String(line?.text || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function setProofreadBlockDeleted(index, deleted) {
  const result = state.ocrResults.get(state.pageNum);
  if (!result) return false;
  const compare = getOcrSourceCompare(result) || result.compare;
  if ((!Array.isArray(result.lines) || !result.lines.length) && compare) {
    const seed = compare.bdrc?.lines?.length ? compare.bdrc.lines : compare.llm?.lines || [];
    result.lines = seed.map((line, lineIndex) => ({ ...line, index: lineIndex }));
  }
  const arrays = [result.lines, compare?.bdrc?.lines, compare?.llm?.lines].filter(Array.isArray);
  const targets = arrays.map((lines) => lines[index]).filter(Boolean);
  if (!targets.length || targets.every((line) => Boolean(line.deleted) === Boolean(deleted))) return false;

  for (const line of targets) line.deleted = Boolean(deleted);
  result.text = joinActiveOcrLines(result.lines);
  if (compare?.bdrc) compare.bdrc.text = joinActiveOcrLines(compare.bdrc.lines);
  if (compare?.llm) {
    compare.llm.text = joinActiveOcrLines(compare.llm.lines);
    compare.llm.returnedLineCount = (compare.llm.lines || []).filter((line) => !line.deleted && String(line.text || "").trim()).length;
  }
  if (compare) result.compare = compare;
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  const saved = saveCachedResults() !== false;
  updateOcrPanelForPage();
  updateSummary();
  updateThumbnailState();
  setStatus(saved
    ? (deleted ? `已删除并自动保存第 ${index + 1} 行的 OCR 结果；原文保留，可撤销。` : `已恢复并自动保存第 ${index + 1} 行的 OCR 结果。`)
    : `第 ${index + 1} 行的删除状态未能保存，请重试。`, saved ? "ok" : "error");
  return saved;
}

function renderDeletedProofreadBlockCard(index) {
  const notice = document.createElement("div");
  notice.className = "proofread-deleted-block-notice";
  const message = document.createElement("span");
  message.textContent = "此行的 OCR 结果已从当前页文本中移除，原文与候选仍保留。";
  const restore = document.createElement("button");
  restore.className = "ghost-button compact proofread-restore-block-button";
  restore.type = "button";
  restore.innerHTML = '<i data-lucide="undo-2"></i><span>撤销删除</span>';
  restore.setAttribute("aria-label", `撤销删除第 ${index + 1} 行`);
  restore.addEventListener("click", (event) => {
    event.stopPropagation();
    setProofreadBlockDeleted(index, false);
  });
  notice.append(message, restore);
  return notice;
}

function renderDeleteProofreadBlockButton(index) {
  const button = document.createElement("button");
  button.className = "ghost-button compact proofread-delete-block-button";
  button.type = "button";
  button.innerHTML = '<i data-lucide="trash-2"></i><span>删除本行</span>';
  button.title = "从当前页 OCR 结果和导出文本中移除这一行；可在原位撤销";
  button.setAttribute("aria-label", `删除第 ${index + 1} 行识别结果`);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setProofreadBlockDeleted(index, true);
  });
  return button;
}

function isPeripheralProofreadRegion(line) {
  const regionKeys = [line?.regionId, line?.regionLabel]
    .map((value) => String(value || "").trim().toLowerCase());
  return regionKeys.some((region) => ["left", "左侧", "左", "right", "右侧", "右"].includes(region));
}

function showProofreadAutoSaveStatus(index, saved) {
  const card = Array.from(els.ocrLineCompare?.querySelectorAll?.(".proofread-block-card") || [])
    .find((item) => Number(item.dataset.proofreadBlock) === index);
  const status = card?.querySelector(".proofread-autosave-status");
  if (!status) return;
  status.textContent = state.localProofreadSavePending ? "正在保存到本机…" : saved ? "已保存到本机" : "保存失败，请重试";
  status.classList.toggle("is-error", !saved);
}

function renderProofreadBlockCard({ index, bdrcLine, aiLine, finalLine, sourceLine, compare }) {
  const card = document.createElement("section");
  card.className = "proofread-block-card";
  card.dataset.proofreadBlock = String(index);
  card.dataset.sourceRowIndex = String(index);
  const regionLabel = aiLine?.regionLabel || bdrcLine?.regionLabel || finalLine?.regionLabel || "";
  if (regionLabel) {
    card.dataset.region = regionLabel;
  }
  const hasPreciseSourceLine = Boolean(sourceLine?.bbox && !sourceLine.estimated);
  card.classList.toggle("has-source-line", hasPreciseSourceLine);
  card.title = hasPreciseSourceLine
    ? `点击同步左栏第 ${index + 1} 行${regionLabel ? `${regionLabel} ` : ""}原文`
    : "";
  card.classList.toggle("is-active", state.activeOcrLine === index);

  const deleted = Boolean(bdrcLine?.deleted || aiLine?.deleted || finalLine?.deleted);
  if (deleted) {
    card.classList.add("is-deleted");
    card.append(renderProofreadSourcePanel(sourceLine, index), renderDeletedProofreadBlockCard(index));
    return card;
  }

  if ([bdrcLine, aiLine, finalLine].some(isPeripheralProofreadRegion)) {
    const sourcePanel = renderProofreadSourcePanel(sourceLine, index);
    const notice = document.createElement("span");
    notice.textContent = "左右栏识别结果暂不显示";
    sourcePanel.append(notice);
    card.append(sourcePanel);
    return card;
  }

  const showGemini = isCurrentGeminiResult(compare?.llm);
  const savedSide = getProofreadDefaultChoice(finalLine, bdrcLine, aiLine);

  const options = document.createElement("div");
  options.className = "proofread-options proofread-block-actions";
  const choiceSelect = renderProofreadChoiceSelect(
    index,
    savedSide,
    aiLine.provider === "qwen" ? "千问候选" : aiLine.provider === "openai" ? "OpenAI 候选" : "Gemini",
    compare,
    showGemini,
  );
  const autoSaveStatus = document.createElement("span");
  autoSaveStatus.className = "proofread-autosave-status";
  autoSaveStatus.setAttribute("role", "status");
  autoSaveStatus.setAttribute("aria-live", "polite");
  autoSaveStatus.textContent = "修改与标错自动保存";
  choiceSelect.querySelector("select").addEventListener("change", (event) => {
    const previous = getProofreadDefaultChoice(
      state.ocrResults.get(state.pageNum)?.lines?.[index],
      bdrcLine,
      aiLine,
    );
    if (!saveProofreadBlockChoice(index, event.target.value, card)) event.target.value = previous;
  });
  options.append(choiceSelect, autoSaveStatus, renderDeleteProofreadBlockButton(index));

  const stack = document.createElement("div");
  stack.className = "proofread-editor-stack";
  if (showGemini) stack.append(
    renderProofreadEditorGroup({
      index,
      side: "llm",
      label: "Gemini 识别",
      line: aiLine,
      peerLine: bdrcLine,
      compare,
    }),
  );

  stack.querySelectorAll(".proofread-editor-group").forEach((group) => {
    decorateProofreadModelSection(group, index, group.classList.contains("is-bdrc") ? "bdrc" : "llm", card, sourceLine, aiLine, compare);
  });
  stack.append(
    decorateIndependentProofreadModelSection(renderQwenLineReview(index, sourceLine, bdrcLine, aiLine), index, "qwen", card),
  );

  const activate = () => {
    if (!hasPreciseSourceLine) return;
    const line = sourceLine || getSourceLineForRow(bdrcLine, aiLine);
    activateOcrSourceBlock(line, index, { scrollRows: false });
  };
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, textarea, input, label, select")) return;
    activate();
  });

  const sourcePanel = renderProofreadSourcePanel(sourceLine, index);
  card.append(sourcePanel, stack, options);
  if (state.isOcrBusy && state.ocrResults.get(state.pageNum)?.raw?.line_ocr) {
    card.querySelectorAll("button:not(.source-preview-scale-button), select").forEach((control) => { control.disabled = true; });
    card.querySelectorAll('[contenteditable="true"]').forEach((editor) => { editor.contentEditable = "false"; });
  }
  return card;
}

function makeProofreadAiLine(compare, rawAiLine, index, fallbackBbox = null) {
  const line = {
    text: String(rawAiLine?.text || ""),
    bbox: normalizeBbox(rawAiLine?.bbox) || normalizeBbox(fallbackBbox),
    bboxApproximate: Boolean(rawAiLine?.bboxApproximate),
    regionId: rawAiLine?.regionId || rawAiLine?.region_id || "",
    regionLabel: rawAiLine?.regionLabel || rawAiLine?.region_label || "",
    index,
    error: Boolean(rawAiLine?.error),
    missing: Boolean(rawAiLine?.missing),
    diagnostic: Boolean(rawAiLine?.diagnostic),
    deleted: Boolean(rawAiLine?.deleted),
    provider: String(rawAiLine?.provider || ""),
    model: String(rawAiLine?.model || ""),
    reviewImage: rawAiLine?.reviewImage || rawAiLine?.review_image || null,
    recognitionError: String(rawAiLine?.recognitionError || rawAiLine?.recognition_error || ""),
    regionLineIndex: Number(rawAiLine?.regionLineIndex ?? rawAiLine?.region_line_index ?? 0),
    manualBaselineText: typeof rawAiLine?.manualBaselineText === "string" ? rawAiLine.manualBaselineText : undefined,
    manuallyEdited: Boolean(rawAiLine?.manuallyEdited),
    manualErrorChars: Math.max(0, Number(rawAiLine?.manualErrorChars || 0)),
    manualEditRanges: getManualEditRanges(rawAiLine),
  };
  if (line.reviewImage || line.recognitionError) return line;
  if (shouldShowAiVisionDiagnostic(compare, line, index)) {
    return makeMissingAiVisionLine(compare, index, line.bbox || fallbackBbox);
  }
  return line;
}

function renderProofreadChoiceSelect(index, savedSide, candidateLabel = "Gemini", compare = null, showGemini = true) {
  const control = document.createElement("label");
  control.className = "proofread-choice-select-control";
  const label = document.createElement("span");
  label.textContent = "采用";
  const select = document.createElement("select");
  select.className = "proofread-choice-select";
  select.name = `proofread-choice-${state.pageNum}-${index}`;
  select.setAttribute("aria-label", `第 ${index + 1} 行采用版本`);
  const choices = showGemini ? [["llm", candidateLabel]] : [];
  if (compare?.qwenReviews?.some((review) => review.index === index && !["pending-review", "aligned-pending-review"].includes(review.alignmentStatus))) choices.push(["qwen", "千问候选"]);
  // OpenAI candidates remain stored, but are hidden until API access is enabled.
  if (!choices.length) choices.push(["none", "待识别"]);
  choices.forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  });
  select.value = choices.some(([value]) => value === savedSide) ? savedSide : choices[0][0];
  select.disabled = choices[0][0] === "none";
  control.append(label, select);
  return control;
}

function renderSharedErrorActionGroup(index, card, provider) {
  const group = document.createElement("div");
  group.className = "proofread-inline-action-group";
  group.setAttribute("aria-label", `${proofreadModelName(provider)}标错操作`);
  group.append(
    renderClearSharedErrorButton(index, card, provider),
    renderSharedErrorButton(index, card, provider),
  );
  return group;
}

function appendProofreadErrorActionsAfterModelSelector(controls, actions, fallbackHeader = null) {
  const selector = controls?.querySelector(".gemini-row-recognize-button") || controls?.querySelector(".review-model-select");
  if (selector) selector.insertAdjacentElement("afterend", actions);
  else if (fallbackHeader) {
    const title = fallbackHeader.querySelector("strong");
    if (title) title.insertAdjacentElement("afterend", actions);
    else fallbackHeader.append(actions);
  }
  else controls.append(actions);
}

const collapsedProofreadModels = new Set();

function proofreadModelName(provider) {
  return {bdrc:"BDRC", llm:"Gemini", qwen:"千问", openai:"OpenAI"}[provider] || provider;
}

function makeProofreadModelToggle(index, provider, content) {
  const key = JSON.stringify([state.cacheKey, state.pageNum, index, provider]);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button compact proofread-model-toggle";
  button.setAttribute("aria-label", `折叠${proofreadModelName(provider)}识别结果`);
  const sync = () => {
    const collapsed = collapsedProofreadModels.has(key);
    content.hidden = collapsed;
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}${proofreadModelName(provider)}识别结果`);
    button.title = `${collapsed ? "展开" : "折叠"}${proofreadModelName(provider)}识别结果`;
    button.innerHTML = `<i data-lucide="${collapsed ? "chevrons-down" : "chevrons-up"}"></i>`;
    if (window.lucide) window.lucide.createIcons({root: button});
  };
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (collapsedProofreadModels.has(key)) collapsedProofreadModels.delete(key);
    else collapsedProofreadModels.add(key);
    sync();
  });
  sync();
  return button;
}

function decorateProofreadModelSection(group, index, provider, card, sourceLine, aiLine, compare) {
  const header = group.querySelector(".proofread-editor-label");
  const content = group.querySelector(".proofread-editor-body");
  content.classList.add("proofread-model-content");
  let controls = header.querySelector(".review-provider-controls");
  if (provider === "llm") {
    controls = document.createElement("div");
    controls.className = "review-provider-controls";
    const recognizedModel = String(aiLine?.model || compare?.llm?.model || "").split(":").pop();
    const select = renderGeminiRowModelSelector(index, recognizedModel);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button compact gemini-row-recognize-button";
    button.textContent = "重新识别";
    button.setAttribute("aria-label", `使用所选 Gemini 模型重新识别第 ${index + 1} 行`);
    button.title = "只更新本行 Gemini 识别候选，保留已采用的校对文本。";
    const bbox = normalizeBbox(getSourceLineForRow(sourceLine, aiLine)?.bbox);
    select.dataset.hasSourceBbox = String(Boolean(bbox && !sourceLine?.estimated));
    controls.append(select, button);
    updateGeminiRowRecognizeButton(select);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void reRecognizeGeminiRow(index, select, sourceLine, aiLine);
    });
    header.querySelector("strong").insertAdjacentElement("afterend", controls);
  }
  const actions = renderSharedErrorActionGroup(index, card, provider);
  appendProofreadErrorActionsAfterModelSelector(controls, actions, controls ? null : header);
  header.prepend(makeProofreadModelToggle(index, provider, content));
  group.classList.add("proofread-model-section");
  return group;
}

function decorateIndependentProofreadModelSection(group, index, provider, card) {
  const header = document.createElement("div");
  header.className = "proofread-editor-label proofread-independent-label";
  const title = document.createElement("strong");
  title.textContent = `${proofreadModelName(provider)} 第 ${index + 1} 行识别`;
  const controls = group.querySelector(".review-provider-controls");
  const content = document.createElement("div");
  content.className = "proofread-model-content proofread-independent-content";
  while (group.firstChild) content.appendChild(group.firstChild);
  appendProofreadErrorActionsAfterModelSelector(controls, renderSharedErrorActionGroup(index, card, provider));
  header.append(title, controls);
  header.prepend(makeProofreadModelToggle(index, provider, content));
  group.classList.add("proofread-model-section", `is-${provider}`);
  group.replaceChildren(header, content);
  return group;
}

function renderReviewModelSelector(provider, index, onCatalog = null) {
  const select = document.createElement("select");
  select.className = "review-model-select";
  select.setAttribute("aria-label", `第 ${index + 1} 行 ${provider === "qwen" ? "千问" : "Gemini"}复核模型`);
  const preferenceKey = `tibetan-proofreading-app:review-model:${provider}:${state.cacheKey}:${state.pageNum}:${index}`;
  let preferred = "";
  try { preferred = window.localStorage.getItem(preferenceKey) || ""; } catch (_) { /* storage optional */ }
  const fill = (availableModels) => {
    const models = provider === "qwen"
      ? availableModels.filter((model) => model !== "qwen3.5-ocr")
      : availableModels.filter((model) => model !== "gemini-2.5-flash");
    const chosen = select.value || preferred;
    select.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    }
    select.value = models.includes(chosen) ? chosen : (models[0] || "");
    select.disabled = !models.length;
    select.dispatchEvent(new Event("change"));
  };
  select.addEventListener("change", () => {
    try { window.localStorage.setItem(preferenceKey, select.value); } catch (_) { /* storage optional */ }
  });
  fill(REVIEW_MODEL_DEFAULTS[provider]);
  if (typeof fetch === "function") {
    const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, "/review-models");
    if (!reviewCatalogRequests.has(endpoint)) {
      const request = fetch(endpoint).then(async (response) => {
        if (!response.ok) throw new Error(`模型列表 HTTP ${response.status}`);
        return response.json();
      });
      reviewCatalogRequests.set(endpoint, request);
      request.catch(() => reviewCatalogRequests.delete(endpoint));
    }
    reviewCatalogRequests.get(endpoint).then((catalog) => {
      if (!select.isConnected) return;
      if (Array.isArray(catalog[provider]?.models)) fill(catalog[provider].models);
      select.dataset.reviewConfigured = String(Boolean(catalog[provider]?.configured));
      if (onCatalog) onCatalog(catalog[provider]);
      select.title = provider === "qwen" && !catalog.qwen?.configured
        ? "当前 AI OCR 服务尚未读取到千问 API key 或接口地址；请检查服务状态与本地配置。"
        : (catalog[provider]?.billing_note || "模型权限及费用以服务商账号为准。");
    }).catch((error) => { select.title = `模型列表加载失败：${error.message}；当前显示默认模型。`; });
  }
  return select;
}

function getSelectedGeminiModel() {
  return REVIEW_MODEL_DEFAULTS.gemini[1] || REVIEW_MODEL_DEFAULTS.gemini[0];
}

function updateGeminiRowRecognizeButton(select) {
  const button = select.parentElement?.querySelector(".gemini-row-recognize-button");
  if (!button?.classList.contains("gemini-row-recognize-button")) return;
  button.hidden = !select.value || select.value === select.dataset.recognizedModel;
  button.disabled = state.isOcrBusy || pageReviewPending || select.dataset.hasSourceBbox !== "true";
}

function refreshGeminiRowModelSelectors() {
  els.ocrLineCompare?.querySelectorAll(".gemini-row-model-select").forEach((select) => {
    const chosen = select.value;
    select.replaceChildren(...geminiRowModels.map((model) => new Option(model, model)));
    select.value = geminiRowModels.includes(chosen) ? chosen :
      (geminiRowModels.includes(getSelectedGeminiModel()) ? getSelectedGeminiModel() : geminiRowModels[0] || "");
    select.disabled = state.isOcrBusy || pageReviewPending || !geminiRowModels.length;
    select.title = geminiRowModelTitle;
    updateGeminiRowRecognizeButton(select);
  });
}

function renderGeminiRowModelSelector(index, recognizedModel) {
  const select = document.createElement("select");
  select.className = "review-model-select gemini-row-model-select";
  select.setAttribute("aria-label", `第 ${index + 1} 行 Gemini 重新识别模型`);
  select.replaceChildren(...geminiRowModels.map((model) => new Option(model, model)));
  const key = JSON.stringify([state.cacheKey, state.pageNum, index]);
  const initialModel = recognizedModel || getSelectedGeminiModel();
  const requestedModel = pendingGeminiRowModels.get(key) || initialModel;
  select.value = geminiRowModels.includes(requestedModel) ? requestedModel :
    (geminiRowModels.includes(getSelectedGeminiModel()) ? getSelectedGeminiModel() : geminiRowModels[0] || "");
  select.dataset.recognizedModel = initialModel;
  select.disabled = state.isOcrBusy || pageReviewPending;
  select.title = geminiRowModelTitle;
  select.addEventListener("change", () => {
    if (select.value === initialModel) pendingGeminiRowModels.delete(key);
    else pendingGeminiRowModels.set(key, select.value);
    updateGeminiRowRecognizeButton(select);
  });
  return select;
}

function loadGeminiRowModelCatalog() {
  const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, "/review-models");
  fetch(endpoint).then(async (response) => {
    if (!response.ok) throw new Error(`模型列表 HTTP ${response.status}`);
    return response.json();
  }).then((catalog) => {
    const available = Array.isArray(catalog.gemini?.models)
      ? catalog.gemini.models.filter((model) => typeof model === "string" && model.startsWith("gemini-"))
      : [];
    if (available.length) geminiRowModels = available;
    geminiRowModelTitle = catalog.gemini?.billing_note || "所选模型用于本行 Gemini 重新识别。";
    refreshGeminiRowModelSelectors();
  }).catch((error) => {
    geminiRowModelTitle = `模型列表加载失败：${error.message}；当前显示默认模型。`;
    refreshGeminiRowModelSelectors();
  });
}

const geminiJobStorageKey = "tibetan-gemini-background-jobs-v1";
let geminiBackgroundJobs = [];
let geminiJobsPolling = false;
let geminiJobsRenderKey = "";

function persistGeminiJobs() {
  try { sessionStorage.setItem(geminiJobStorageKey, JSON.stringify(geminiBackgroundJobs)); }
  catch { setStatus("后台任务仍在运行，但浏览器无法保存任务记录，请保持本页打开。", "warn"); }
}

function initializeGeminiJobs() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(geminiJobStorageKey) || "[]");
    geminiBackgroundJobs = Array.isArray(saved) ? saved.filter(job => job && /^[a-f0-9]{32}$/.test(job.id)).slice(-20) : [];
  } catch { geminiBackgroundJobs = []; }
  for (const job of geminiBackgroundJobs) {
    if (job.status === "preparing") { job.status = "failed"; job.error = "准备图片时页面已刷新，任务尚未提交，原结果保留。"; }
  }
  window.setInterval(() => { void pollGeminiJobs(); renderGeminiJobs(); }, 4000);
  renderGeminiJobs();
  void pollGeminiJobs();
}

function geminiJobMatchesPage(job) {
  return job.actor === cloudLibrary.actor && job.sourceKey === state.cacheKey && job.page === state.pageNum;
}

function geminiJobRowSnapshot(result, index) {
  const compare = getOcrSourceCompare(result);
  return JSON.stringify({line: compare?.llm?.lines[index], errors: (compare?.sharedErrors || []).filter(mark => mark.blockIndex === index)});
}

function geminiJobCanApply(job) {
  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result);
  const line = compare?.llm?.lines[job.index];
  const protectedLine = line?.deleted || line?.manuallyEdited || line?.manualErrorChars > 0 ||
    line?.manualEditRanges?.length || line?.errorRanges?.length ||
    (compare?.sharedErrors || []).some(mark => mark.blockIndex === job.index && mark.llmRanges?.length);
  return !protectedLine && geminiJobMatchesPage(job) && geminiJobRowSnapshot(result, job.index) === job.baseline;
}

function renderGeminiJobs() {
  const panel = document.getElementById("geminiBackgroundJobs");
  if (!panel) return;
  const jobs = geminiBackgroundJobs.filter(job => job.actor === cloudLibrary.actor && job.sourceKey === state.cacheKey);
  const renderKey = JSON.stringify(jobs.map(job => [job.id, job.status, job.error, job.result, geminiJobMatchesPage(job), geminiJobCanApply(job)]));
  if (renderKey === geminiJobsRenderKey) return;
  geminiJobsRenderKey = renderKey;
  panel.replaceChildren();
  panel.hidden = jobs.length === 0;
  for (const job of jobs) {
    const row = document.createElement("div");
    row.style.cssText = "padding:10px 16px;border-bottom:1px solid #dce5df";
    const label = document.createElement("div");
    const names = {preparing:"准备原页图片", submitting:"正在提交", uncertain:"正在确认提交状态", queued:"后台排队中，可继续校对", running:"后台识别中，可继续校对", completed:"识别完成，等待你应用", failed:"识别未完成", applied:"已应用到 Gemini 候选"};
    label.textContent = `第 ${job.page} 页${job.rows ? "整页识别、分行候选" : `第 ${job.index + 1} 行`} · ${job.model} · ${names[job.status] || job.status}`;
    row.append(label);
    if (job.error) {
      const note = document.createElement("div"); note.textContent = job.error; row.append(note);
    }
    if (job.status === "completed") {
      for (const candidate of job.result.lines || [{index:job.index, text:job.result.text}]) {
        const title = document.createElement("div"); title.textContent = `第 ${candidate.index + 1} 行`;
        const text = document.createElement("textarea");
        text.readOnly = true; text.value = candidate.text;
        text.setAttribute("aria-label", `第 ${job.page} 页第 ${candidate.index + 1} 行后台识别候选`);
        text.style.cssText = "display:block;width:100%;min-height:70px;font-size:20px;margin:8px 0";
        row.append(title, text);
      }
      const apply = document.createElement("button");
      apply.type = "button"; apply.className = "ghost-button compact";
      apply.disabled = !geminiJobCanApply(job);
      apply.textContent = !geminiJobMatchesPage(job) ? `返回第 ${job.page} 页后应用` : !geminiJobCanApply(job) ? "该行有校对或标记，请手动核对候选" : `仅应用第 ${job.index + 1} 行候选（保留已采用校对文本）`;
      apply.onclick = () => { void applyGeminiJob(job); };
      row.append(apply);
    }
    if (["failed", "applied", "completed"].includes(job.status)) {
      const dismiss = document.createElement("button"); dismiss.type = "button"; dismiss.className = "ghost-button compact";
      dismiss.textContent = job.status === "completed" ? "保留现有结果，关闭此候选" : "关闭提示";
      dismiss.onclick = () => { geminiBackgroundJobs = geminiBackgroundJobs.filter(item => item !== job); persistGeminiJobs(); renderGeminiJobs(); };
      row.append(dismiss);
    }
    panel.append(row);
  }
}

async function pollGeminiJobs() {
  if (geminiJobsPolling || !cloudLibrary.actor) return;
  geminiJobsPolling = true;
  try {
    for (const job of geminiBackgroundJobs) {
      if (job.actor !== cloudLibrary.actor || !["queued", "running", "uncertain", "submitting"].includes(job.status)) continue;
      try {
        const response = await fetch(`${job.endpoint}/jobs/${job.id}`, {signal: AbortSignal.timeout(15000)});
        const parsed = await parseOcrResponse(response);
        const payload = {...parsed.raw, error: parsed.error};
        if (response.status === 401 || response.status === 403) continue;
        // A lost POST response may precede the server accepting the upload.
        if (response.status === 404 && Date.now() - job.created < 120000) continue;
        if (response.status === 404 || response.status === 410) {
          job.status = "failed"; job.error = payload.error || "任务不存在或已过期，原校对内容保留";
        } else if (!response.ok) {
          job.error = "任务状态暂时查询失败，将继续查询；不会重复提交识别。";
        } else {
          job.error = "";
          if (payload.status === "completed") {
            job.status = "failed"; // Invalid model/text must become terminal, never silently applied.
            const text = normalizeOcrTextSpacing(validateIndependentReviewText(payload.result?.text || ""));
            if (String(payload.result?.model || "").split(":").pop() !== job.model) throw new Error("返回模型与所选模型不一致，原结果保留。");
            let lines;
            if (job.rows) {
              lines = payload.result.lines;
              const expected = new Set(job.rows.map(row => row.index));
              if (!Array.isArray(lines) || lines.length !== expected.size ||
                  new Set(lines.map(row => row.index)).size !== expected.size ||
                  lines.some(row => !expected.has(row.index) || typeof row.text !== "string" || !row.text.trim())) {
                throw new Error("整页分行结果不完整，原校对内容保留。");
              }
              lines = lines.map(row => ({index:row.index, text:normalizeOcrTextSpacing(validateIndependentReviewText(row.text))}));
            }
            job.result = {text:lines ? lines.find(row => row.index === job.index).text : text,
              model:payload.result.model, ...(lines ? {lines} : {})}; job.status = "completed";
          } else if (payload.status === "failed") {
            job.status = "failed"; job.error = payload.error || "后台识别失败，原结果保留";
          } else if (["queued", "running"].includes(payload.status)) job.status = payload.status;
        }
      } catch (error) {
        job.error = `查询中断：${error.message || error}；原结果保留。`;
      }
      persistGeminiJobs(); renderGeminiJobs();
    }
  } finally { geminiJobsPolling = false; }
}

async function applyGeminiJob(job) {
  if (!geminiJobCanApply(job)) { renderGeminiJobs(); return; }
  const result = state.ocrResults.get(job.page);
  const compare = getOcrSourceCompare(result);
  const previous = compare.llm.lines[job.index];
  compare.llm.lines[job.index] = {
    ...previous, text: job.result.text, model: job.result.model, provider: "gemini",
    error: false, missing: false, diagnostic: false, recognitionError: "",
    manualBaselineText: undefined, manuallyEdited: false, manualErrorChars: 0, manualEditRanges: [],
  };
  compare.sharedErrors = normalizeSharedErrorMarks((compare.sharedErrors || []).map(mark =>
    mark.blockIndex === job.index ? {...mark, llmRanges: []} : mark
  ).filter(mark => mark.bdrcRanges?.length || mark.llmRanges?.length));
  compare.llm.text = joinActiveOcrLines(compare.llm.lines);
  compare.llm.returnedLineCount = countNonEmptyOcrLines(compare.llm.lines);
  result.compare = compare; result.updatedAt = new Date().toISOString();
  pendingGeminiRowModels.delete(JSON.stringify([job.sourceKey, job.page, job.index]));
  job.status = "applied"; persistGeminiJobs(); renderGeminiJobs();
  updateOcrPanelForPage();
  try {
    const saved = saveCachedResults({immediateRemote:true});
    if (saved === false) throw new Error("本地保存失败，请保留当前页面");
    await saved;
  } catch (error) {
    job.error = `候选已应用，保存未确认：${error.message || error}。请保留当前页面并重试云端同步。`;
    persistGeminiJobs(); renderGeminiJobs();
  }
}

async function reRecognizeGeminiRow(index, select, sourceLine, aiLine) {
  const endpoint = getAiVisionLineReviewEndpoint();
  // Keep the existing local service protocol; cloud deployments use jobs.
  if (new URL(endpoint, location.href).pathname !== "/api/line-review") {
    return reRecognizeGeminiRowLegacy(index, select, sourceLine, aiLine);
  }
  if (pageReviewPending || state.isOcrBusy || state.batchOcr?.running) return;
  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result);
  const source = getSourceLineForRow(sourceLine, compare?.llm?.lines[index] || aiLine);
  const bbox = normalizeBbox(source?.bbox);
  if (!bbox || source?.estimated) { setStatus("该行缺少准确原文位置，原结果保留。", "warn"); return; }
  if (geminiBackgroundJobs.some(job => geminiJobMatchesPage(job) && job.index === index && !["failed", "applied"].includes(job.status))) {
    setStatus("该行已有后台任务，请查看后台识别列表，避免重复调用。", "warn"); return;
  }
  if (geminiBackgroundJobs.length >= 20) { setStatus("请先关闭已完成或失败的后台任务提示。", "warn"); return; }
  const rows = (compare?.llm?.lines || []).map((line, rowIndex) => ({
    index:rowIndex, bbox:normalizeBbox(rowIndex === index ? bbox : line.bbox), region_id:line.regionId || "center",
  })).filter(row => row.region_id === "center");
  if (!rows.length || rows.some(row => !row.bbox) || !rows.some(row => row.index === index)) {
    setStatus("整页分行坐标尚不完整，原结果保留；请先加载整页原文。", "warn"); return;
  }
  const job = {
    rows,
    id: crypto.randomUUID().replaceAll("-", ""), actor: cloudLibrary.actor, endpoint,
    sourceKey: state.cacheKey, page: state.pageNum, index, model: select.value,
    baseline: geminiJobRowSnapshot(result, index), created: Date.now(), status:"preparing",
  };
  geminiBackgroundJobs.push(job); persistGeminiJobs(); renderGeminiJobs();
  // Lock only while capturing the current original, not while the model runs.
  pageReviewPending = true; setBusy(true);
  let blob;
  const cloudOriginal = state.remoteServerPdf && state.remoteBookId
    ? {bookId:state.remoteBookId, page:job.page, dpi:Number(els.dpiInput.value) || 260} : null;
  try {
    if (!cloudOriginal) blob = await getCurrentPageImageBlob();
    if (!geminiJobMatchesPage(job)) throw new Error("页面已切换，请重新提交");
  } catch (error) {
    job.status = "failed"; job.error = String(error.message || error);
    persistGeminiJobs(); renderGeminiJobs(); return;
  } finally { pageReviewPending = false; setBusy(false); }
  job.status = "submitting"; persistGeminiJobs(); renderGeminiJobs();
  const form = new FormData();
  if (cloudOriginal) {
    form.append("book_id", cloudOriginal.bookId);
    form.append("page_num", String(cloudOriginal.page));
    form.append("dpi", String(cloudOriginal.dpi));
  } else form.append("file", blob, "original-page.png");
  form.append("bbox", JSON.stringify(bbox));
  form.append("job_id", job.id); form.append("model", job.model);
  form.append("rows", JSON.stringify(job.rows));
  form.append("ocr_text", compare?.llm?.lines[index]?.text || "");
  form.append("region_id", source?.regionId || "center");
  try {
    const response = await fetch(`${endpoint}/jobs`, {method:"POST", body:form, signal:AbortSignal.timeout(75000)});
    const payload = await parseOcrResponse(response);
    if (!response.ok) {
      if (response.status >= 500) throw new Error(payload.error || `HTTP ${response.status}`);
      job.status = "failed"; job.error = payload.error || `HTTP ${response.status}`;
    } else if (["submitting", "uncertain"].includes(job.status)) { job.status = "queued"; job.error = ""; }
  } catch {
    job.status = "uncertain"; job.error = "提交响应中断，正在按任务编号确认；不会自动重复识别。";
  }
  persistGeminiJobs(); renderGeminiJobs(); void pollGeminiJobs();
}

async function reRecognizeGeminiRowLegacy(index, select, sourceLine, aiLine) {
  if (pageReviewPending || state.isOcrBusy || state.batchOcr?.running) return;
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const result = state.ocrResults.get(pageNum);
  const before = JSON.stringify(result);
  const compare = getOcrSourceCompare(result);
  const source = getSourceLineForRow(sourceLine, compare?.llm?.lines[index] || aiLine);
  const bbox = normalizeBbox(source?.bbox);
  const endpoint = getAiVisionLineReviewEndpoint();
  if (!bbox || source?.estimated) {
    setStatus(`第 ${index + 1} 行缺少准确原文位置，原结果保留。`, "warn");
    return;
  }
  if (!endpoint) {
    setStatus("Gemini OCR 接口地址未配置。", "warn");
    return;
  }
  const model = select.value;
  pageReviewPending = true;
  setBusy(true);
  const startedAt = Date.now();
  let stage = "正在准备原页图片";
  const showProgress = () => setStatus(
    `第 ${pageNum} 页第 ${index + 1} 行 · ${model} · ${stage} · 已等待 ${Math.floor((Date.now() - startedAt) / 1000)} 秒`, "warn");
  showProgress();
  const progressTimer = window.setInterval(showProgress, 1000);
  try {
    const blob = await getCurrentPageImageBlob();
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，原结果保留。");
    stage = "正在上传并等待模型响应（单次请求，最多等待 75 秒）";
    showProgress();
    const payload = await callAiVisionLineReviewEndpoint(endpoint, blob, bbox,
      compare?.llm?.lines[index]?.text || "", model, null, source?.regionId || "center");
    window.clearInterval(progressTimer);
    const text = normalizeOcrTextSpacing(validateIndependentReviewText(payload.text || payload.lines?.[0]?.text));
    if (payload.model && String(payload.model).split(":").pop() !== model) {
      throw new Error("返回模型与所选模型不一致，原结果保留。");
    }
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey || state.ocrResults.get(pageNum) !== result || JSON.stringify(result) !== before) {
      throw new Error("页面或校对结果已改变，原结果保留。");
    }
    const updated = getOcrSourceCompare(result);
    const previous = updated?.llm?.lines[index];
    if (!previous) throw new Error("本行 Gemini 候选不存在，原结果保留。");
    updated.llm.lines[index] = {
      ...previous, text, model: payload.model || `gemini:${model}`, provider: "gemini",
      error: false, missing: false, diagnostic: false, recognitionError: "",
      manualBaselineText: undefined, manuallyEdited: false, manualErrorChars: 0, manualEditRanges: [],
    };
    updated.sharedErrors = normalizeSharedErrorMarks((updated.sharedErrors || []).map((mark) =>
      mark.blockIndex === index ? {...mark, llmRanges: []} : mark
    ).filter((mark) => mark.bdrcRanges?.length || mark.llmRanges?.length));
    updated.llm.text = joinActiveOcrLines(updated.llm.lines);
    updated.llm.returnedLineCount = countNonEmptyOcrLines(updated.llm.lines);
    result.compare = updated;
    result.updatedAt = new Date().toISOString();
    pendingGeminiRowModels.delete(JSON.stringify([sourceKey, pageNum, index]));
    setStatus(`第 ${pageNum} 页第 ${index + 1} 行 Gemini 候选已用 ${model} 更新；已采用的校对文本保留。`, "ok");
    const saved = saveCachedResults({immediateRemote: true});
    if (saved === false) throw new Error("本地保存失败，请检查浏览器存储空间。");
    await saved;
    if (state.pageNum === pageNum) updateOcrPanelForPage();
  } catch (error) {
    window.clearInterval(progressTimer);
    setStatus(`第 ${pageNum} 页第 ${index + 1} 行重新识别失败：${error.message || error}`, "error");
  } finally {
    window.clearInterval(progressTimer);
    pageReviewPending = false;
    setBusy(false);
    refreshGeminiRowModelSelectors();
  }
}

function renderOpenAiLineReview(index, sourceLine, bdrcLine, aiLine) {
  return renderIndependentLineReview("openai", index, sourceLine, bdrcLine, aiLine);
}

function renderQwenLineReview(index, sourceLine, bdrcLine, aiLine) {
  return renderIndependentLineReview("qwen", index, sourceLine, bdrcLine, aiLine);
}

function renderIndependentLineReview(provider, index, sourceLine, bdrcLine, aiLine) {
  const label = provider === "qwen" ? "千问" : "OpenAI";
  const reviewKey = provider === "qwen" ? "qwenReviews" : "openaiReviews";
  const group = document.createElement("div");
  group.className = "provider-line-review openai-line-review";
  const controls = document.createElement("div");
  controls.className = "review-provider-controls";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button compact";
  button.textContent = provider === "qwen" ? "识别" : `${label}整页复核`;
  button.setAttribute("aria-label", provider === "qwen" ? `使用 qwen3.8-max 识别第 ${index + 1} 行` : `${label}整页复核，更新本页${label}结果`);
  button.title = provider === "qwen"
    ? "使用 qwen3.8-max 和完整原图识别本行；保留已采用的校对文本。"
    : `使用完整原图，一次复核并更新本页中间栏各行${label}结果；裁剪预览仅供人工对照。`;
  const targetLine = getSourceLineForRow(sourceLine, aiLine);
  button.disabled = !normalizeBbox(targetLine?.bbox) || Boolean(targetLine?.estimated);
  const feedback = document.createElement("div");
  feedback.className = "openai-review-feedback";
  feedback.setAttribute("role", "status");
  controls.append(button);
  group.append(controls, feedback);
  const candidate = getOcrSourceCompare(state.ocrResults.get(state.pageNum))?.[reviewKey]?.find((review) => review.index === index);
  if (candidate) {
    if (provider === "qwen" && candidate.alignmentStatus === "pending-review") {
      const warning = document.createElement("p");
      warning.setAttribute("role", "status");
      warning.textContent = "待复核：此千问候选可能错行，旧结果保留，暂不可直接采用。";
      group.append(warning);
    }
    if (provider === "qwen" && candidate.alignmentStatus === "aligned-pending-review") {
      const warning = document.createElement("p");
      warning.setAttribute("role", "status");
      warning.textContent = "已纠正千问候选的行对应；文字仍需对照原图复核，暂不可直接采用。";
      group.append(warning);
    }
    const text = document.createElement("div");
    text.className = provider === "qwen"
      ? "tibetan-text proofread-editor proofread-result-editor openai-review-candidate"
      : "tibetan-text openai-review-candidate";
    text.contentEditable = "true";
    text.spellcheck = false;
    text.setAttribute("role", "textbox");
    text.setAttribute("aria-multiline", "true");
    text.setAttribute("aria-label", `第 ${index + 1} 行 ${label}候选文字`);
    text.title = candidate.note
      ? `${label} · ${candidate.model || "未知模型"} · ${candidate.note}（可直接编辑）`
      : `${label} · ${candidate.model || "未知模型"}（可直接编辑）`;
    text.dataset.reviewProvider = provider;
    text.dataset.sourceRowIndex = String(index);
    renderOcrLineMarkup(text, candidate.text, {manualEditRanges: getManualEditRanges(candidate), sharedErrorRanges: candidate.errorRanges || [], sharedErrorTitle: `${label} 候选：人工标记的错误，需核对原图`});
    text.addEventListener("focus", () => {
      const source = getSourceLineForRow(sourceLine, bdrcLine);
      activateOcrSourceBlock(source, index, { scrollRows: false });
    });
    text.addEventListener("input", () => {
      updateIndependentReviewText(provider, index, text.textContent || "");
      updateCandidateQuality();
    });
    text.addEventListener("blur", () => {
      const current = getOcrSourceCompare(state.ocrResults.get(state.pageNum))?.[reviewKey]
        ?.find((review) => review.index === index);
      if (!current) return;
      renderOcrLineMarkup(text, current.text, {
        manualEditRanges: getManualEditRanges(current),
        sharedErrorRanges: current.errorRanges || [],
        sharedErrorTitle: `${label} 候选：人工标记的错误，需核对原图`,
      });
    });
    const quality = document.createElement("div");
    quality.className = "proofread-line-quality independent-line-quality";
    const updateCandidateQuality = () => {
      const current = getOcrSourceCompare(state.ocrResults.get(state.pageNum))?.[reviewKey]
        ?.find((review) => review.index === index) || candidate;
      const candidateText = String(current.text || "");
      const totalChars = countOcrCharacters(candidateText);
      const errorChars = Math.min(totalChars, countErrorRanges(candidateText, current.errorRanges || []));
      const manualChars = Math.max(0, Number(current.manualErrorChars || 0));
      quality.textContent = formatLineQualityStats({
        totalChars,
        errorChars: Math.max(errorChars, manualChars),
        manualChars,
        errorRate: totalChars ? Math.max(errorChars, manualChars) / totalChars : 0,
      });
    };
    updateCandidateQuality();
    if (provider === "qwen" && candidate.alignmentStatus === "pending-review") {
      const history = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "查看旧千问候选（行号待复核）";
      history.append(summary, text, quality);
      group.append(history);
    } else {
      group.append(text, quality);
    }
  }
  if (provider === "qwen") {
    const archived = getOcrSourceCompare(state.ocrResults.get(state.pageNum))?.qwenReviewArchive
      ?.filter((review) => review.originalIndex === index) || [];
    if (archived.length) {
      const history = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `查看 ${archived.length} 条无法可靠对齐的旧千问输出`;
      history.append(summary);
      for (const review of archived) {
        const oldText = document.createElement("p");
        oldText.className = "tibetan-text";
        oldText.textContent = review.text;
        history.append(oldText);
      }
      group.append(history);
    }
  }
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (state.batchOcr?.running) {
      feedback.textContent = "请先停止批量识别，再复核单行。";
      return;
    }
    if (provider === "qwen") await recognizeQwenRow(index, sourceLine, aiLine, button, feedback);
    else await reviewProviderWholePage(provider, button, null, feedback);
    return;

  });
  return group;
}

async function recognizeQwenRow(index, sourceLine, aiLine, button, feedback) {
  if (pageReviewPending || state.isOcrBusy) return;
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const result = state.ocrResults.get(pageNum);
  const before = JSON.stringify(result);
  const compare = getOcrSourceCompare(result);
  const source = getSourceLineForRow(sourceLine, compare?.llm?.lines[index] || aiLine);
  const bbox = normalizeBbox(source?.bbox);
  if (!bbox || source?.estimated) {
    feedback.textContent = `第 ${index + 1} 行缺少准确原文位置，原结果保留。`;
    return;
  }
  const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, "/qwen-line-review");
  pageReviewPending = true;
  button.disabled = true;
  feedback.textContent = `正在用 qwen3.8-max 识别第 ${pageNum} 页第 ${index + 1} 行…`;
  try {
    const blob = await getCurrentPageImageBlob();
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，原结果保留。");
    const form = new FormData();
    form.append("file", blob, makePageImageName());
    form.append("bbox", JSON.stringify(bbox));
    form.append("model", "qwen3.8-max");
    const response = await fetchOcrWithTransientRetry(endpoint, form, true);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
    if (payload.provider !== "qwen" || payload.model !== "qwen3.8-max") {
      throw new Error("返回模型不是 qwen3.8-max，原结果保留。");
    }
    const text = normalizeOcrTextSpacing(validateIndependentReviewText(payload.text || payload.lines?.[0]?.text));
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey || state.ocrResults.get(pageNum) !== result || JSON.stringify(result) !== before) {
      throw new Error("页面或校对结果已改变，原结果保留。");
    }
    const updated = getOcrSourceCompare(result);
    const candidate = {index, text, bbox, provider: "qwen", model: "qwen3.8-max", recognitionScope: "single-line", reviewedAt: new Date().toISOString()};
    updated.qwenReviews = [...(updated.qwenReviews || []).filter((review) => review.index !== index), candidate];
    result.compare = updated;
    result.updatedAt = new Date().toISOString();
    const saved = saveCachedResults({immediateRemote: true});
    if (saved === false) throw new Error("本地保存失败，请检查浏览器存储空间。");
    await saved;
    if (state.pageNum === pageNum) updateOcrPanelForPage();
    setStatus(`第 ${pageNum} 页第 ${index + 1} 行千问候选已用 qwen3.8-max 更新；已采用的校对文本保留。`, "ok");
  } catch (error) {
    feedback.textContent = `第 ${index + 1} 行千问识别失败：${error.message || error}`;
  } finally {
    pageReviewPending = false;
    if (button.isConnected) button.disabled = false;
  }
}

function collectCenterPageReviewRows(result) {
  const compare = getOcrSourceCompare(result) || makeEmptyOcrCompare(result);
  const base = getEffectiveOcrSideLines(compare.bdrc);
  const ai = getEffectiveOcrSideLines(compare.llm, base);
  const final = result?.lines || [];
  const rows = Array.from({length: Math.max(base.length, ai.length, final.length)}, (_, index) => {
    const line = getSourceLineForRow(base[index], ai[index]) || final[index];
    if (base[index]?.deleted || final[index]?.deleted || isPeripheralProofreadRegion(line)) return null;
    const bbox = normalizeBbox(line?.bbox);
    if (!bbox || line?.estimated) throw new Error("本页部分行缺少准确坐标，请先完成BDRC整页识别。");
    return {index, bbox, region_id: "center"};
  }).filter(Boolean);
  if (!rows.length) throw new Error("本页没有可复核的中间栏文字行。");
  return rows;
}

function mergePageReviews(previous, payload, rows, provider) {
  const incoming = payload?.lines;
  const expected = new Set(rows.map(row => row.index));
  if (payload?.recognition_scope !== "whole-page" || !Array.isArray(incoming)
      || incoming.length !== rows.length || new Set(incoming.map(row => row.index)).size !== rows.length
      || incoming.some(row => !Number.isInteger(row.index) || !expected.has(row.index))) {
    throw new Error("整页结果行号不完整，原结果保留。");
  }
  const updated = incoming.map(row => ({index: row.index,
    text: validateIndependentReviewText(row.text),
    bbox: rows.find(target => target.index === row.index).bbox,
    provider, model: payload.model, recognitionScope: "whole-page",
    reviewedAt: new Date().toISOString()}));
  return [...previous.filter(row => !expected.has(row.index)), ...updated];
}

function mergeQwenPageReviews(previous, payload, rows) {
  return mergePageReviews(previous, payload, rows, "qwen");
}

function reviewLineSimilarity(left, right) {
  const letters = value => Array.from(String(value || "").replace(/[^\u0f40-\u0fbc]/g, ""));
  const a = letters(left), b = letters(right);
  if (a.length < 8 || b.length < 8) return 0;
  const counts = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const pair = a[i] + a[i + 1];
    counts.set(pair, (counts.get(pair) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b[i] + b[i + 1], remaining = counts.get(pair) || 0;
    if (remaining) { overlap++; counts.set(pair, remaining - 1); }
  }
  return 2 * overlap / (a.length + b.length - 2);
}

function findPageReviewRowConflicts(payload, referenceLines) {
  if (!Array.isArray(payload?.lines) || !Array.isArray(referenceLines)) return [];
  return payload.lines.flatMap(row => {
    const own = reviewLineSimilarity(row.text, referenceLines[row.index]?.text);
    const matches = referenceLines.map((line, index) => ({index, score: reviewLineSimilarity(row.text, line?.text)}))
      .filter(match => match.index !== row.index && match.score >= 0.72 && match.score >= own + 0.22)
      .sort((a, b) => b.score - a.score);
    return matches.length ? [{index: row.index, matchingIndex: matches[0].index}] : [];
  });
}

async function requestWholePageReview(endpoint, blob, rows, model = "") {
  const form = new FormData();
  form.append("file", blob, makePageImageName());
  form.append("rows", JSON.stringify(rows));
  if (model) form.append("model", model);
  const response = await fetch(endpoint, {method: "POST", body: form});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function reviewProviderWholePage(provider, button, select, feedback) {
  const label = provider === "qwen" ? "千问" : "OpenAI";
  if (pageReviewPending) {
    feedback.textContent = "本页正在复核，请等待完成。";
    return;
  }
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const original = state.ocrResults.get(pageNum);
  const before = JSON.stringify(original);
  pageReviewPending = true;
  button.disabled = true;
  if (select) select.disabled = true;
  feedback.textContent = `${label}正在读取完整原页并复核本页中间栏…`;
  try {
    if (provider === "qwen" && select?.dataset.reviewConfigured === "false") {
      const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, "/review-models");
      const response = await fetch(endpoint, {cache: "no-store"});
      if (!response.ok) throw new Error(`千问配置状态检查失败：HTTP ${response.status}`);
      const catalog = await response.json();
      select.dataset.reviewConfigured = String(Boolean(catalog.qwen?.configured));
      if (!catalog.qwen?.configured) throw new Error("千问服务尚未配置，请检查本地配置。");
    }
    const rows = collectCenterPageReviewRows(original);
    const blob = await getCurrentPageImageBlob();
    if (state.pageNum !== pageNum || state.cacheKey !== sourceKey) throw new Error("页面已切换，请返回原页重试。");
    const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, `/${provider}-page-review`);
    const payload = await requestWholePageReview(endpoint, blob, rows,
      provider === "qwen" ? select?.value || REVIEW_MODEL_DEFAULTS.qwen[0] : "");
    if (state.cacheKey !== sourceKey || state.ocrResults.get(pageNum) !== original || JSON.stringify(original) !== before) {
      throw new Error("原文或校对结果已更改，未覆盖原结果，请重试。");
    }
    const compare = getOcrSourceCompare(original) || makeEmptyOcrCompare(original);
    if (provider === "qwen") {
      const conflicts = findPageReviewRowConflicts(payload, getEffectiveOcrSideLines(compare.llm));
      if (conflicts.length) {
        const first = conflicts[0];
        throw new Error(`结果疑似错行：第 ${first.index + 1} 行更像第 ${first.matchingIndex + 1} 行（共 ${conflicts.length} 处）。原千问结果保留，请检查行定位后重试。`);
      }
    }
    const key = provider === "qwen" ? "qwenReviews" : "openaiReviews";
    compare[key] = mergePageReviews(compare[key] || [], payload, rows, provider);
    original.compare = compare;
    saveCachedResults();
    if (state.pageNum === pageNum) updateOcrPanelForPage();
    setStatus(`第 ${pageNum} 页${label}整页复核已保存（${rows.length} 行）。`, "ok");
  } catch (error) {
    feedback.textContent = `${label}整页复核失败：${error.message || error}`;
  } finally {
    pageReviewPending = false;
    if (button.isConnected) button.disabled = false;
    if (select?.isConnected) select.disabled = false;
  }
}

async function reviewQwenWholePage(button, select, feedback) {
  return reviewProviderWholePage("qwen", button, select, feedback);
}

function validateIndependentReviewText(value) {
  let text = String(value || "").trim();
  text = text.replace(/^```[^\n]*\n([\s\S]*?)\n```$/, "$1").trim();
  if (!text || /^[{\[]/.test(text) || (!/[\u0f00-\u0fff]/.test(text) && !/^[0-9０-９\s.,:;()/-]+$/.test(text))) {
    throw new Error("模型返回了非藏文转录（可能是无关 JSON 或说明），未作为新候选保存。请换模型复核；原候选保留。");
  }
  return text;
}

function updateIndependentReviewText(provider, index, value) {
  const result = state.ocrResults.get(state.pageNum);
  const key = provider === "qwen" ? "qwenReviews" : "openaiReviews";
  const candidate = result?.compare?.[key]?.find((review) => review.index === index);
  if (!candidate) return false;
  const wasAdopted = result.lines?.[index]?.adoptedProvider === provider;
  const nextText = normalizeOcrTextSpacing(String(value || ""));
  const baseline = String(candidate.manualBaselineText ?? candidate.text ?? "");
  candidate.text = nextText;
  updateManualEditTracking(candidate, nextText, baseline);
  candidate.updatedAt = new Date().toISOString();
  result.updatedAt = candidate.updatedAt;
  if (syncAdoptedProofreadText(result, index, provider, candidate, wasAdopted)) updateProofreadSummaryAfterEdit();
  const saved = saveCachedResults() !== false;
  showProofreadAutoSaveStatus(index, saved);
  return saved;
}

function updateManualEditTracking(target, nextText, baselineText = target?.manualBaselineText ?? target?.text ?? "") {
  if (!target || typeof target !== "object") return target;
  const baseline = String(baselineText || "");
  const normalized = normalizeOcrTextSpacing(String(nextText || ""));
  target.manualBaselineText = baseline;
  target.manualErrorChars = levenshteinDistance(
    tokenizeOcrDiffText(baseline).map((token) => token.value),
    tokenizeOcrDiffText(normalized).map((token) => token.value),
  );
  target.manualEditRanges = getChangedTextRanges(baseline, normalized);
  target.manuallyEdited = true;
  return target;
}

function getManualEditRanges(target) {
  if (!target || typeof target !== "object") return [];
  const text = String(target.text || "");
  if (target.manuallyEdited && typeof target.manualBaselineText === "string") {
    return getChangedTextRanges(target.manualBaselineText, text);
  }
  if (Array.isArray(target.manualEditRanges)) {
    return expandTextRangesToClusters(target.manualEditRanges, text);
  }
  return [];
}

function expandTextRangesToClusters(ranges, text) {
  const source = String(text || "");
  const clusters = getHighRiskClusterScan(source);
  const expanded = normalizeTextRanges(ranges).map((range) => {
    let start = clamp(range.start, 0, source.length);
    let end = clamp(range.end, start, source.length);
    clusters.forEach((cluster) => {
      if (!rangesOverlap(start, end, cluster.start, cluster.end)) return;
      start = Math.min(start, cluster.start);
      end = Math.max(end, cluster.end);
    });
    return { start, end };
  }).filter((range) => range.end > range.start);
  return normalizeTextRanges(expanded);
}

// Align grapheme clusters so unchanged text between edits never turns green.
// Deletions affect the edit count but have no surviving glyph to highlight.
function getChangedTextRanges(previous, next) {
  const before = tokenizeTextRangeClusters(previous);
  const after = tokenizeTextRangeClusters(next);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix].value === after[prefix].value) prefix++;
  let aEnd = before.length, bEnd = after.length;
  while (aEnd > prefix && bEnd > prefix && before[aEnd - 1].value === after[bEnd - 1].value) { aEnd--; bEnd--; }
  const n = aEnd - prefix, m = bEnd - prefix;
  if (!m) return [];
  const costs = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) costs[i][0] = i;
  for (let j = 0; j <= m; j++) costs[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    costs[i][j] = Math.min(costs[i - 1][j] + 1, costs[i][j - 1] + 1,
      costs[i - 1][j - 1] + (before[prefix + i - 1].value === after[prefix + j - 1].value ? 0 : 1));
  }
  const changed = [];
  let i = n, j = m;
  while (i || j) {
    if (i && j && before[prefix + i - 1].value === after[prefix + j - 1].value && costs[i][j] === costs[i - 1][j - 1]) { i--; j--; }
    else if (i && j && costs[i][j] === costs[i - 1][j - 1] + 1) { changed.push(after[prefix + j - 1]); i--; j--; }
    else if (j && costs[i][j] === costs[i][j - 1] + 1) { changed.push(after[prefix + j - 1]); j--; }
    else i--;
  }
  return normalizeTextRanges(changed.map(({start, end}) => ({start, end})));
}

function getChangedTextRange(previous, next) {
  const before = tokenizeTextRangeClusters(previous);
  const after = tokenizeTextRangeClusters(next);
  let start = 0;
  while (start < before.length && start < after.length && before[start].value === after[start].value) start += 1;
  if (start === before.length && start === after.length) return null;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1].value === after[afterEnd - 1].value) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const rangeStart = after[start]?.start ?? String(next || "").length;
  const rangeEnd = afterEnd > start ? after[afterEnd - 1].end : rangeStart;
  return { start: rangeStart, end: rangeEnd };
}

function tokenizeTextRangeClusters(text) {
  const source = String(text || "");
  const tokens = [];
  let cursor = 0;

  const pushLooseText = (looseText, offset) => {
    let localOffset = 0;
    for (const char of Array.from(looseText)) {
      const start = offset + localOffset;
      const end = start + char.length;
      tokens.push({ value: char, start, end });
      localOffset += char.length;
    }
  };

  getHighRiskClusterScan(source).forEach((cluster) => {
    if (cluster.start > cursor) pushLooseText(source.slice(cursor, cluster.start), cursor);
    tokens.push({ value: cluster.text, start: cluster.start, end: cluster.end });
    cursor = cluster.end;
  });

  if (cursor < source.length) pushLooseText(source.slice(cursor), cursor);
  return tokens;
}

function levenshteinDistance(left, right) {
  const a = Array.isArray(left) ? left : Array.from(String(left || ""));
  const b = Array.isArray(right) ? right : Array.from(String(right || ""));
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] || 0;
}

function updateIndependentReviewErrors(provider, index, expectedText, range) {
  const result = state.ocrResults.get(state.pageNum);
  const key = provider === "qwen" ? "qwenReviews" : "openaiReviews";
  const candidate = result?.compare?.[key]?.find((review) => review.index === index);
  if (!candidate || candidate.text !== expectedText) return false;
  if (range) {
    const start = clamp(range.start, 0, candidate.text.length);
    const end = clamp(range.end, start, candidate.text.length);
    if (end <= start) return false;
    candidate.errorRanges = [...(candidate.errorRanges || []), {start, end}];
  } else candidate.errorRanges = [];
  result.updatedAt = new Date().toISOString();
  const saved = saveCachedResults() !== false;
  showProofreadAutoSaveStatus(index, saved);
  return saved ? true : "save-failed";
}

function refreshProofreadErrorMarkDisplay(index, provider = "") {
  if (state.ocrView !== "proofread" || !els.ocrLineCompare?.querySelectorAll) return;
  const card = Array.from(els.ocrLineCompare.querySelectorAll(".proofread-block-card"))
    .find((item) => Number(item.dataset.proofreadBlock) === index);
  if (!card) return;

  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result) || result?.compare;
  if (!compare) return;

  if (provider === "qwen" || provider === "openai") {
    const reviewKey = provider === "qwen" ? "qwenReviews" : "openaiReviews";
    const candidate = compare[reviewKey]?.find((review) => review.index === index);
    const editor = Array.from(card.querySelectorAll(".openai-review-candidate"))
      .find((item) => item.dataset.reviewProvider === provider);
    if (!candidate || !editor) return;
    renderOcrLineMarkup(editor, candidate.text || "", {
      manualEditRanges: getManualEditRanges(candidate),
      sharedErrorRanges: candidate.errorRanges || [],
      sharedErrorTitle: `${proofreadModelName(provider)}候选：人工标记的错误，需核对原图`,
    });
    const totalChars = countOcrCharacters(candidate.text || "");
    const manualErrorChars = Math.max(0, Number(candidate.manualErrorChars || 0));
    const errorChars = Math.min(totalChars, Math.max(
      countErrorRanges(candidate.text || "", candidate.errorRanges || []),
      manualErrorChars,
    ));
    const quality = editor.parentElement?.querySelector(".independent-line-quality");
    if (quality) {
      quality.textContent = formatLineQualityStats({
        totalChars,
        errorChars,
        manualChars: manualErrorChars,
        errorRate: totalChars ? errorChars / totalChars : 0,
      });
    }
    return;
  }

  card.querySelectorAll(".proofread-result-editor").forEach((editor) => {
    const side = editor.dataset.proofreadSide === "bdrc" ? "bdrc" : "llm";
    const line = getEffectiveOcrSideLines(compare[side])[index] || { text: editor.textContent || "" };
    const text = String(line.text || "");
    renderOcrLineMarkup(editor, text, {
      manualEditRanges: getManualEditRanges(line),
      sharedErrorRanges: getSharedErrorRanges(compare, side, index, text),
    });
    const quality = editor.parentElement?.querySelector(".proofread-result-quality");
    if (quality) quality.textContent = formatLineQualityStats(getLineQualityStats(line, compare, side, index));
  });
}

function renderSharedErrorButton(index, card, provider) {
  const button = document.createElement("button");
  button.className = "ghost-button compact proofread-shared-error-button";
  button.type = "button";
  button.innerHTML = '<i data-lucide="circle-alert"></i><span>标错</span>';
  button.title = `标错：仅标记当前选中的${proofreadModelName(provider)}文字`;
  button.setAttribute("aria-label", `${proofreadModelName(provider)}标错`);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => markSelectedSharedError(index, card, provider));
  return button;
}

function renderClearSharedErrorButton(index, card, provider) {
  const button = document.createElement("button");
  button.className = "ghost-button compact proofread-clear-shared-error-button";
  button.type = "button";
  button.innerHTML = '<i data-lucide="eraser"></i><span>撤销</span>';
  button.title = `有选区时撤销相交标记；无选区时仅撤销当前${proofreadModelName(provider)}的错误标记`;
  button.setAttribute("aria-label", `${proofreadModelName(provider)}撤销`);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => clearSharedErrorMark(index, card, provider));
  return button;
}

// Cache coordinates only in memory; never replace OCR or manually edited text.
const recoveredSourceLayouts = new Map();
function createRecoveredSourcePreview(index) {
  const wrapper = document.createElement("div");
  wrapper.className = "proofread-source-preview";
  wrapper.textContent = "正在定位原文文字行…";
  const pageNum = state.pageNum, sourceKey = state.cacheKey;
  const compare = getOcrSourceCompare(state.ocrResults.get(pageNum));
  const count = compare?.llm?.lines?.length || 0;
  const key = JSON.stringify([sourceKey, pageNum, count]);
  if (!recoveredSourceLayouts.has(key)) {
    recoveredSourceLayouts.set(key, (async () => {
      const blob = await getCurrentPageImageBlob();
      if (pageNum !== state.pageNum || sourceKey !== state.cacheKey) throw new Error("页面已切换");
      const form = new FormData();
      form.append("file", blob, "page.png");
      form.append("line_count", String(count));
      const response = await fetch("/api/layout", { method: "POST", body: form });
      if (!response.ok) throw new Error("坐标检测服务暂不可用");
      return response.json();
    })());
  }
  recoveredSourceLayouts.get(key).then(payload => {
    if (!wrapper.isConnected || pageNum !== state.pageNum || sourceKey !== state.cacheKey) return;
    const line = payload.lines?.[index];
    const preview = line?.bbox && createSourceBlockPreviewCanvas(line);
    if (!preview) throw new Error("未检测到可靠文字行");
    const note = document.createElement("small");
    note.textContent = line.bbox_approximate
      ? "近似行定位，仅供人工对照；识别使用整页原图"
      : "原文行裁剪，仅供人工对照；识别使用整页原图";
    wrapper.replaceChildren(note, preview);
  }).catch(error => {
    recoveredSourceLayouts.delete(key);
    if (wrapper.isConnected) wrapper.textContent = `原文预览暂不可用：${error.message}。请查看左栏原图。`;
  });
  return wrapper;
}

function renderProofreadSourcePanel(sourceLine, index) {
  const panel = document.createElement("div");
  panel.className = "proofread-source-panel";
  panel.dataset.sourceRowIndex = String(index);
  const isTraditionalSide = getSelectedOcrProfile().id === "traditional"
    && ["left", "right", "左侧", "右侧"].includes(sourceLine?.regionId || sourceLine?.regionLabel);

  const header = document.createElement("div");
  header.className = "proofread-source-header";
  const title = document.createElement("strong");
  const regionLabel = sourceLine?.regionLabel ? `${sourceLine.regionLabel} ` : "";
  const regionLineCount = Number(sourceLine?.regionLineCount || 0);
  const regionCountLabel = regionLineCount > 1 ? `（${regionLineCount}行）` : "";
  title.textContent = sourceLine?.bboxApproximate
    ? `${regionLabel}原文第 ${index + 1} 行预览（合并定位）${regionCountLabel}`
    : `${regionLabel}原文第 ${index + 1} 行预览${regionCountLabel}`;
  header.append(title);
  if (!isTraditionalSide) header.append(renderSourcePreviewScaleControls());
  panel.appendChild(header);

  const isTraditionalLeft = isTraditionalSide
    && ["left", "左侧"].includes(sourceLine?.regionId || sourceLine?.regionLabel);
  const preview = sourceLine?.estimated
    ? (isCloudDeployment() ? createRecoveredSourcePreview(index) : null)
    : isTraditionalLeft
    ? createSourceBlockPreviewCanvas(sourceLine)
    : isTraditionalSide
    ? null
    : createModelInputPreview(sourceLine, index);
  if (preview) {
    panel.classList.add("has-preview");
    panel.appendChild(preview);
  } else {
    const fallback = document.createElement("span");
    fallback.textContent = isTraditionalLeft
      ? "左栏竖排原文裁剪预览暂不可用；BDRC 会自动比较横向旋转方向。"
      : isTraditionalSide
      ? "右侧暂不显示单行裁剪预览。"
      : sourceLine?.estimated
      ? "暂无可靠定位坐标，请在左栏查看整页原文。"
      : "当前行没有可用坐标预览，可在左栏查看整页原文。";
    panel.appendChild(fallback);
  }

  if (sourceLine?.bbox && !sourceLine.estimated) {
    panel.classList.add("is-locatable");
    panel.addEventListener("click", () => activateOcrSourceBlock(sourceLine, index));
  }
  return panel;
}

function renderSourcePreviewScaleControls() {
  const controls = document.createElement("div");
  controls.className = "source-preview-scale-controls";
  controls.setAttribute("aria-label", "原文行预览缩放");
  controls.append(
    renderSourcePreviewScaleButton("decrease", "zoom-out", "缩小原文行预览"),
    renderSourcePreviewScaleButton("increase", "zoom-in", "放大原文行预览"),
  );
  return controls;
}

function renderSourcePreviewScaleButton(action, icon, label) {
  const button = document.createElement("button");
  button.className = "icon-button compact source-preview-scale-button";
  button.type = "button";
  button.dataset.scaleAction = action;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = action === "increase" ? SOURCE_PREVIEW_SCALE_STEP : -SOURCE_PREVIEW_SCALE_STEP;
    setSourcePreviewScale(state.sourcePreviewScale + delta, true, true);
  });
  return button;
}

const lineCropRequests = new Map();
const lineCropModelWrites = new Map();
const linePreviewQueue = [];
let activeLinePreviews = 0;

function queueLinePreview(task) {
  linePreviewQueue.push(task);
  drainLinePreviewQueue();
}

function drainLinePreviewQueue() {
  while (activeLinePreviews < 2 && linePreviewQueue.length) {
    const next = linePreviewQueue.shift();
    activeLinePreviews += 1;
    Promise.resolve().then(next).catch((error) => {
      console.warn("Failed to prepare line preview", error);
    }).finally(() => {
      activeLinePreviews -= 1;
      drainLinePreviewQueue();
    });
  }
}

function makeLineCropContext() {
  return { cacheKey: state.cacheKey, pageNum: state.pageNum,
    dpi: Number(els.dpiInput.value) || 260, profile: getSelectedOcrProfile(), endpoint: getAiVisionLineReviewEndpoint() };
}

function makeLineCropCacheKey(sourceLine, index, context) {
  return JSON.stringify([context.cacheKey, context.pageNum, index, context.dpi,
    context.profile, context.endpoint, normalizeBbox(sourceLine.bbox), "row-crop-v26"]);
}

function sameLineCropMetadata(a, b) {
  if (!a || !b) return false;
  return ["crop_version", "source_size", "crop_pixels", "review_size", "tile_ranges"]
    .every((name) => JSON.stringify(a[name]) === JSON.stringify(b[name]));
}

function openLineCropDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("浏览器不支持裁剪缓存"));
    const request = window.indexedDB.open("tibetan-proofreading-line-crops", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("crops");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("裁剪缓存打开失败"));
  });
}

async function accessLineCropCache(key, value) {
  const database = await openLineCropDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction("crops", value ? "readwrite" : "readonly");
      const request = value ? transaction.objectStore("crops").put(value, key)
        : transaction.objectStore("crops").get(key);
      let result = null;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(value || result || null);
      transaction.onerror = () => reject(transaction.error || new Error("裁剪缓存读写失败"));
      transaction.onabort = () => reject(transaction.error || new Error("裁剪缓存写入被取消"));
    });
  } finally { database.close(); }
}

async function getCachedLineCrop(sourceLine, index, metadata, context, blob = null) {
  const key = makeLineCropCacheKey(sourceLine, index, context);
  let cached = null;
  try { cached = await accessLineCropCache(key); } catch { /* Preview can still render. */ }
  const currentInput = metadata?.crop_version === 26;
  if (cached?.payload?.review_image?.crop_version === 26 && cached?.payload?.images?.length && (!currentInput || sameLineCropMetadata(metadata, cached.payload.review_image))) {
    return cached;
  }
  if (lineCropRequests.has(key)) return lineCropRequests.get(key);
  const pending = (async () => {
    if (state.cacheKey !== context.cacheKey || state.pageNum !== context.pageNum) throw new Error("页面已切换");
    const image = blob || await getCurrentPageImageBlob();
    const data = new FormData();
    data.append("file", image, makePageImageName());
    data.append("bbox", JSON.stringify(sourceLine.bbox));
    if (metadata) data.append("review_image", JSON.stringify(metadata));
    const endpoint = getAiVisionLineReviewEndpoint().replace(/line-review$/, "line-preview");
    const response = await fetch(endpoint, { method: "POST", body: data });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
    if (payload.review_image?.crop_version !== 26) throw new Error("裁剪服务尚未更新，请重启本地服务后重试");
    const entry = { payload, savedAt: new Date().toISOString(), context, modelInputs: cached?.modelInputs || {}, ...(cached?.modelInput ? { modelInput: cached.modelInput } : {}) };
    try { await accessLineCropCache(key, entry); }
    catch (error) { entry.cacheError = error.message; }
    return entry;
  })();
  lineCropRequests.set(key, pending);
  try { return await pending; } finally { lineCropRequests.delete(key); }
}

// Source previews must follow the current block bbox, not a historical model
// crop. Keep this cache namespace separate so refreshing a preview never
// changes the archived image that a model actually received.
async function getSourceLinePreviewCrop(sourceLine, index, context) {
  const key = JSON.stringify([context.cacheKey, context.pageNum, index, context.dpi,
    context.profile, context.endpoint, normalizeBbox(sourceLine.bbox), "source-preview-v5"]);
  let cached = null;
  try { cached = await accessLineCropCache(key); } catch { /* Render without a persistent cache. */ }
  if (cached?.payload?.review_image?.crop_version === 26 && cached.payload.images?.length) return cached;
  if (lineCropRequests.has(key)) return lineCropRequests.get(key);
  const pending = (async () => {
    if (state.cacheKey !== context.cacheKey || state.pageNum !== context.pageNum) throw new Error("页面已切换");
    const data = new FormData();
    if (isCloudDeployment() && state.remoteBookId && state.remoteServerPdf) {
      data.append("book_id", state.remoteBookId);
      data.append("page_num", String(context.pageNum));
      data.append("dpi", String(context.dpi));
    } else {
      const image = await getSourcePreviewPageBlob(context.pageNum);
      data.append("file", image, image.type === "image/jpeg" ? "source-preview.jpg" : makePageImageName());
    }
    if (state.cacheKey !== context.cacheKey || state.pageNum !== context.pageNum) throw new Error("页面已切换");
    data.append("bbox", JSON.stringify(sourceLine.bbox));
    data.append("preview_format", "jpeg");
    const profileId = typeof context.profile === "string" ? context.profile : context.profile?.id;
    if (profileId === "traditional" && !["left", "right", "左侧", "右侧"].includes(sourceLine.regionId || sourceLine.regionLabel)) {
      const compare = getOcrSourceCompare(state.ocrResults.get(context.pageNum));
      // Legacy normalization supplied regionLineIndex=0 to every row. Count
      // preceding center blocks instead of treating that default as a binding.
      const preceding = (compare?.llm?.lines || []).slice(0, index);
      const rowIndex = Number.isInteger(sourceLine.sourceRowIndex) ? sourceLine.sourceRowIndex
        : preceding.length === index ? preceding.filter(line => !["left", "right", "左侧", "右侧"].includes(line.regionId || line.regionLabel)).length : index;
      data.append("physical_row_index", String(rowIndex));
      const sourceLineCount = compare?.llm?.lines?.length || compare?.bdrc?.lines?.length || 0;
      if (sourceLineCount > 0) data.append("physical_row_count", String(sourceLineCount));
    }
    const endpoint = context.endpoint.replace(/line-review$/, "line-preview");
    let response = await fetch(endpoint, { method: "POST", body: data });
    let payload = await response.json();
    let approximateRowMatch = false;
    let approximateAttempt = false;
    if (!response.ok && String(payload.error || payload.detail || "").includes("原文物理行数与识别 block 数不一致")) {
      // A model block number cannot be used as a physical-row index here.
      // Use its position to find the nearest detected row instead.
      data.delete("physical_row_index");
      data.delete("physical_row_count");
      approximateAttempt = true;
      response = await fetch(endpoint, { method: "POST", body: data });
      payload = await response.json();
      approximateRowMatch = response.ok && Number.isInteger(payload.review_image?.source_bbox?.physical_row_index);
      if (response.ok && !approximateRowMatch) throw new Error("原文物理行数与识别 block 数不一致，且无法按坐标定位物理行");
    }
    if (!response.ok) throw new Error(approximateAttempt
      ? `原文物理行数与识别 block 数不一致，无法按坐标定位物理行：${payload.error || payload.detail || `HTTP ${response.status}`}`
      : payload.error || payload.detail || `HTTP ${response.status}`);
    if (approximateRowMatch) payload.approximateRowMatch = true;
    if (payload.review_image?.crop_version !== 26 || !payload.images?.length) {
      throw new Error("单行原文裁剪格式无效");
    }
    const entry = { payload, savedAt: new Date().toISOString(), context, purpose: "source-preview" };
    try { await accessLineCropCache(key, entry); } catch { /* Preview remains available in memory. */ }
    return entry;
  })();
  lineCropRequests.set(key, pending);
  try { return await pending; } finally { lineCropRequests.delete(key); }
}

async function saveModelInputCrop(sourceLine, index, metadata, context, provider, model, blob, reviewContext = null) {
  if (!metadata) return;
  const entry = await getCachedLineCrop(sourceLine, index, metadata, context, blob);
  // Keep preview and successful model input separate; failed calls do not promote it.
  if (!sameLineCropMetadata(entry.payload.review_image, metadata)) throw new Error("裁剪记录与模型输入不一致");
  const key = makeLineCropCacheKey(sourceLine, index, context);
  const snapshot = { provider, model, reviewImage: metadata, images: entry.payload.images,
    ...(reviewContext ? { reviewContext } : {}),
    savedAt: new Date().toISOString() };
  // Concurrent provider reviews must not erase each other's successful input.
  const previous = lineCropModelWrites.get(key) || Promise.resolve();
  const pending = previous.catch(() => {}).then(async () => {
    const latest = await accessLineCropCache(key) || entry;
    latest.modelInputs = { ...(entry.modelInputs || {}), ...(latest.modelInputs || {}), [provider]: snapshot };
    latest.modelInput = snapshot;
    await accessLineCropCache(key, latest);
  });
  lineCropModelWrites.set(key, pending);
  try { await pending; }
  finally { if (lineCropModelWrites.get(key) === pending) lineCropModelWrites.delete(key); }
}

function linePreviewDisplayHeight(containerWidth, reviewSize, previewScale = 1) {
  const baseHeight = 160;
  if (!reviewSize?.width || !reviewSize?.height || reviewSize.width <= reviewSize.height * 2) {
    return baseHeight * previewScale;
  }
  // The server splits long rows into several model-sized tiles. Fit their
  // combined width, rather than sizing each tile as if it were a whole row.
  const availableWidth = Math.max(1, containerWidth - 24);
  const fitHeight = availableWidth * reviewSize.height / reviewSize.width;
  return Math.min(baseHeight, fitHeight) * previewScale;
}

// Model tiles overlap for recognition; reconstruct source coordinates for display.
function linePreviewTileSlices(ranges) {
  let covered = 0;
  return ranges.map(([left, right]) => {
    const start = Math.max(left, covered);
    covered = Math.max(covered, right);
    return { sourceX: start - left, destinationX: start, width: Math.max(0, right - start) };
  });
}

async function composeLinePreviewImages(payload) {
  const urls = payload.images || [];
  const metadata = payload.review_image;
  const ranges = metadata?.tile_ranges;
  const size = metadata?.review_size;
  if (urls.length < 2 || !size?.width || !size?.height || ranges?.length !== urls.length) return urls;
  const images = await Promise.all(urls.map(url => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("单行预览分片加载失败"));
    image.src = url;
  })));
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法合成单行预览");
  linePreviewTileSlices(ranges).forEach((slice, index) => {
    if (slice.width) context.drawImage(images[index], slice.sourceX, 0, slice.width, size.height,
      slice.destinationX, 0, slice.width, size.height);
  });
  return [canvas.toDataURL("image/png")];
}

function createModelInputPreview(sourceLine, index) {
  if (!normalizeBbox(sourceLine?.bbox)) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "proofread-source-preview";
  wrapper.style.display = "block";
  wrapper.textContent = "正在准备单行裁剪预览…";
  const pageNum = state.pageNum;
  const sourceKey = state.cacheKey;
  const load = async () => {
    try {
      if (!wrapper.isConnected || pageNum !== state.pageNum || sourceKey !== state.cacheKey) return;
      const entry = await getSourceLinePreviewCrop(sourceLine, index, makeLineCropContext());
      const payload = entry.payload;
      const previewImages = await composeLinePreviewImages(payload);
      if (!wrapper.isConnected || pageNum !== state.pageNum || sourceKey !== state.cacheKey) return;
      wrapper.replaceChildren();
      const note = document.createElement("small");
      note.textContent = payload.approximateRowMatch
        ? "识别 block 数与原文行数不同；按本 block 坐标就近定位此原文行，请人工核对。"
        : "单行原文裁剪，仅供人工对照；模型识别使用整页原图";
      wrapper.appendChild(note);
      const strip = document.createElement("div");
      strip.style.display = "flex";
      strip.style.width = "max-content";
      let previewHeight = 0;
      for (const [tileIndex, url] of previewImages.entries()) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = `单行裁剪第 ${tileIndex + 1} 段`;
        const size = payload.review_image?.review_size;
        const displayHeight = linePreviewDisplayHeight(
          wrapper.clientWidth,
          size,
          Number(state.sourcePreviewScale) || 1,
        );
        img.style.height = `${displayHeight}px`;
        previewHeight = Math.max(previewHeight, displayHeight);
        img.style.width = "auto";
        img.style.maxWidth = "none";
        strip.appendChild(img);
      }
      wrapper.style.height = "auto";
      wrapper.style.minHeight = `${Math.ceil(previewHeight + 38)}px`;
      wrapper.style.overflowY = "visible";
      strip.dataset.cropStrip = "true";
      wrapper.appendChild(strip);
      if (previewImages.length === 1) {
        const zoom = document.createElement("details");
        zoom.className = "proofread-source-zoom";
        const summary = document.createElement("summary");
        summary.textContent = "放大查看这一行";
        const scroll = document.createElement("div");
        scroll.className = "proofread-source-zoom-scroll";
        const fullImage = document.createElement("img");
        fullImage.src = previewImages[0];
        fullImage.alt = `第 ${index + 1} 行原始细节裁图`;
        scroll.append(fullImage);
        zoom.append(summary, scroll);
        wrapper.append(zoom);
      }
      const rowIndex = payload.review_image?.source_bbox?.physical_row_index;
      if (Number.isInteger(rowIndex)) {
        wrapper.dataset.physicalRowKey = JSON.stringify([payload.review_image.source_size, rowIndex]);
        wrapper.dataset.blockIndex = String(index);
        wrapper.dataset.previewHeight = wrapper.style.minHeight;
        mergeDuplicateSourcePreviews(wrapper.closest("#ocrLineCompare"));
      }
    } catch (error) {
      if (!wrapper.isConnected) return;
      if (String(error.message || "").includes("原文物理行数与识别 block 数不一致")) {
        const approximate = createSourceBlockPreviewCanvas(sourceLine, true);
        if (approximate) {
          const note = document.createElement("small");
          note.textContent = "识别 block 与原文物理行数不同；显示本 block 的坐标区域，请对照左栏整页核对。";
          wrapper.style.height = "auto";
          wrapper.style.minHeight = "0";
          wrapper.style.flexDirection = "column";
          wrapper.style.alignItems = "stretch";
          wrapper.replaceChildren(note, approximate);
          return;
        }
      }
      wrapper.textContent = `裁剪预览失败：${error.message}`;
    }
  };
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      queueLinePreview(load);
    }, { rootMargin: "240px 0px" });
    observer.observe(wrapper);
  } else {
    window.setTimeout(() => queueLinePreview(load), 0);
  }
  return wrapper;
}

function mergeDuplicateSourcePreviews(root) {
  if (!root) return;
  const owners = new Map();
  const previews = [...root.querySelectorAll("[data-physical-row-key]")]
    .sort((a, b) => Number(a.dataset.blockIndex) - Number(b.dataset.blockIndex));
  for (const preview of previews) {
    const owner = owners.get(preview.dataset.physicalRowKey);
    const strip = preview.querySelector("[data-crop-strip]");
    let note = preview.querySelector("[data-duplicate-source]");
    if (!note) {
      note = document.createElement("p");
      note.dataset.duplicateSource = "true";
      preview.appendChild(note);
    }
    note.hidden = !owner;
    if (owner) {
      note.textContent = `与第 ${Number(owner.dataset.blockIndex) + 1} 行对应同一原文行；定位可能重叠，请核对；本行识别文字仍单独保留。`;
    } else {
      owners.set(preview.dataset.physicalRowKey, preview);
    }
    preview.closest(".proofread-block-card")?.classList.remove("is-duplicate-source");
    if (strip) strip.style.display = owner ? "none" : "flex";
    preview.style.minHeight = owner ? "0" : preview.dataset.previewHeight;
  }
}

function createSourceBlockPreviewCanvas(sourceLine, allowHiddenSource = false) {
  const bbox = normalizeBbox(sourceLine?.bbox);
  const source = getVisibleSourceElement() || (allowHiddenSource
    ? [els.imagePage, els.pdfCanvas].find((candidate) => candidate && (
      candidate instanceof HTMLCanvasElement ? candidate.width && candidate.height
        : candidate.naturalWidth && candidate.naturalHeight
    ))
    : null);
  if (!bbox || !source) return null;

  const sourceWidth = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const sourceHeight = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const rawX = bbox.x * sourceWidth;
  const rawY = bbox.y * sourceHeight;
  const rawWidth = Math.max(1, bbox.width * sourceWidth);
  const rawHeight = Math.max(1, bbox.height * sourceHeight);
  // OCR line boxes can stop before Tibetan stacked marks or the final glyph.
  // Add a proportional margin for the preview without changing the source bbox.
  const padX = Math.max(12, rawWidth * 0.18);
  const padY = Math.max(16, rawHeight * 0.75);
  const sx = clamp(rawX - padX, 0, Math.max(0, sourceWidth - 1));
  const sy = clamp(rawY - padY, 0, Math.max(0, sourceHeight - 1));
  const ex = clamp(rawX + rawWidth + padX, sx + 1, sourceWidth);
  const ey = clamp(rawY + rawHeight + padY, sy + 1, sourceHeight);
  const sw = Math.max(1, ex - sx);
  const sh = Math.max(1, ey - sy);
  const regionId = String(sourceLine?.regionId || sourceLine?.regionLabel || "").toLowerCase();
  const direction = String(sourceLine?.regionDirection || "").toLowerCase();
  const isLeftVerticalRegion = ["left", "左侧", "左"].includes(regionId)
    && ["vertical", "竖排", "垂直"].includes(direction);
  const rotationName = isLeftVerticalRegion
    ? sourceLine?.regionRotation === "counterclockwise" ? "counterclockwise" : "clockwise"
    : "";
  const rotated = Boolean(rotationName);

  const wrapper = document.createElement("div");
  wrapper.className = "proofread-source-preview";
  const canvas = document.createElement("canvas");
  const previewScale = clamp(
    Number(state.sourcePreviewScale) || 1,
    SOURCE_PREVIEW_SCALE_MIN,
    SOURCE_PREVIEW_SCALE_MAX,
  );
  // Size each preview from the detected line height. Long lines may exceed
  // the panel width, so the wrapper scrolls horizontally instead of shrinking
  // the text until it becomes unreadable.
  const displaySourceHeight = rotated ? sw : sh;
  const targetHeight = clamp(96 + (rotated ? rawWidth : rawHeight) * 0.35, 112, 180) * previewScale;
  const scale = clamp(targetHeight / displaySourceHeight, 0.75, 3.5);
  canvas.width = Math.max(1, Math.round((rotated ? sh : sw) * scale));
  canvas.height = Math.max(1, Math.round(displaySourceHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (rotationName === "clockwise") {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotationName === "counterclockwise") {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);
  if (allowHiddenSource) canvas.style.flex = "0 0 auto";
  wrapper.appendChild(canvas);
  return wrapper;
}

function countErrorRanges(text, ranges) {
  const source = String(text || "");
  const marked = mergeRanges((ranges || []).map((range) => ({
    start: clamp(Number(range?.start), 0, source.length),
    end: clamp(Number(range?.end), 0, source.length),
  })).filter((range) => range.end > range.start));
  return tokenizeOcrDiffText(source).filter((token) => marked.some((range) => (
    rangesOverlap(token.start, token.end, range.start, range.end)
  ))).length;
}

function getLineQualityStats(line, compare, side, index) {
  const text = String(line?.text || "");
  const totalChars = countOcrCharacters(text);
  const sharedRanges = getSharedErrorRanges(compare, side, index, text);
  const manualErrorChars = Math.max(0, Number(line?.manualErrorChars || 0));
  const markedErrorChars = countErrorRanges(text, sharedRanges);
  const errorChars = Math.min(totalChars, Math.max(markedErrorChars, manualErrorChars));
  return {
    totalChars,
    errorChars,
    manualChars: manualErrorChars,
    errorRate: totalChars ? errorChars / totalChars : 0,
  };
}

function formatLineQualityStats(stats) {
  return `共 ${stats.totalChars} 字 · 错误 ${stats.errorChars} 字 · 错误率 ${(stats.errorRate * 100).toFixed(1)}% · 手动修改 ${stats.manualChars} 字`;
}

function renderProofreadEditorGroup({ index, side, label, line, peerLine, compare }) {
  const group = document.createElement("div");
  group.className = `proofread-editor-group ${side === "llm" ? "is-ai" : "is-bdrc"}`;
  const blockNumber = index + 1;
  const sourceLabel = side === "llm" ? "Gemini" : "BDRC";
  const regionLabel = line?.regionLabel ? `${line.regionLabel} ` : "";
  const regionLineCount = Number(line?.regionLineCount || 0);

  const labelEl = document.createElement("div");
  labelEl.className = "proofread-editor-label";
  const labelTitle = document.createElement("strong");
  labelTitle.textContent = `${sourceLabel} ${regionLabel}第 ${blockNumber} 行识别${regionLineCount > 1 ? `（${regionLineCount}行）` : ""}`;
  const labelMeta = document.createElement("span");
  labelMeta.textContent = `${sourceLabel} 识别结果`;
  const statusEl = document.createElement("em");
  statusEl.className = "proofread-editor-status";
  const qualityEl = document.createElement("div");
  qualityEl.className = "proofread-line-quality proofread-result-quality";
  const updateQuality = () => {
    qualityEl.textContent = formatLineQualityStats(getLineQualityStats(line, compare, side, index));
  };
  const updateManualEditStatus = () => {
    const hasManualChanges = getManualEditRanges(line).length > 0;
    statusEl.hidden = !hasManualChanges;
    statusEl.textContent = hasManualChanges ? "已人工修改" : "";
    statusEl.classList.toggle("is-manual-edit", hasManualChanges);
  };
  updateQuality();
  labelEl.append(labelTitle, labelMeta, statusEl);

  const editor = document.createElement("div");
  editor.className = "proofread-editor proofread-result-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.setAttribute("aria-label", `第 ${index + 1} 行的 ${label}`);
  editor.dataset.placeholder = `${sourceLabel} 第 ${blockNumber} 行未返回`;
  editor.dataset.proofreadSide = side;
  editor.dataset.sourceRowIndex = String(index);
  const editorBody = document.createElement("div");
  editorBody.className = "proofread-editor-body";
  editorBody.append(editor, qualityEl);

  let userEdited = false;
  const getEditorText = () => editor.textContent || "";
  const renderEditorMarkup = () => {
    const text = normalizeOcrTextSpacing(line?.text || "");
    if (line && line.text !== text) {
      line.text = text;
    }
    const diagnostic = isDiagnosticOcrLine(line);
    const visibleText = text || editor.dataset.placeholder;
    group.classList.toggle("has-diagnostic", diagnostic);
    editor.classList.toggle("is-empty", !text.trim() && !diagnostic);
    editor.classList.toggle("is-diagnostic", diagnostic);
    if (diagnostic) {
      const recognitionError = String(line?.recognitionError || "").trim();
      editor.textContent = recognitionError && !visibleText.includes(recognitionError)
        ? `${visibleText}\n${recognitionError}`
        : visibleText;
    } else {
      renderOcrLineMarkup(editor, text, {
        highlightDiff: false,
        manualEditRanges: getManualEditRanges(line),
        sharedErrorRanges: getSharedErrorRanges(compare, side, index, text),
      });
    }
    if (!text.trim() && !diagnostic) {
      editor.textContent = editor.dataset.placeholder;
    }
    updateManualEditStatus();
  };
  const syncEditorValue = (fromUserInput = false) => {
    if (isDiagnosticOcrLine(line) && !fromUserInput) {
      resizeLineEditor(editor);
      return;
    }
    const value = normalizeOcrTextSpacing(getEditorText());
    if (line) {
      if (fromUserInput) {
        line.error = false;
        line.missing = false;
        line.diagnostic = false;
      }
    }
    const updatedLine = updateProofreadCompareLine(side, index, value, line, peerLine);
    if (line && updatedLine) {
      line.manualBaselineText = updatedLine.manualBaselineText;
      line.manuallyEdited = updatedLine.manuallyEdited;
      line.manualErrorChars = updatedLine.manualErrorChars;
      line.manualEditRanges = updatedLine.manualEditRanges;
    }
    editor.classList.toggle("is-empty", !String(value || "").trim());
    editor.classList.toggle("is-diagnostic", isDiagnosticOcrLine(line));
    resizeLineEditor(editor);
  };
  renderEditorMarkup();

  editor.addEventListener("focus", () => {
    if (editor.classList.contains("is-empty")) {
      editor.textContent = "";
      editor.classList.remove("is-empty");
    }
    const sourceLine = getSourceLineForRow(line, peerLine);
    if (sourceLine?.bbox) {
      activateOcrSourceBlock(sourceLine, index, { scrollRows: false });
    } else {
      activateOcrSourceBlock(null, index, { scrollRows: false });
    }
  });
  editor.addEventListener("input", () => {
    userEdited = true;
    syncEditorValue(true);
    updateQuality();
    updateManualEditStatus();
  });
  editor.addEventListener("blur", () => {
    if (userEdited) syncEditorValue(true);
    renderEditorMarkup();
    resizeLineEditor(editor);
    userEdited = false;
  });

  group.append(labelEl, editorBody);
  return group;
}

function getProofreadDefaultChoice(finalLine, bdrcLine, aiLine) {
  if (["bdrc", "llm", "qwen", "openai"].includes(finalLine?.adoptedProvider)) return finalLine.adoptedProvider;
  const finalText = normalizeCompareText(finalLine?.text || "");
  const bdrcText = normalizeCompareText(bdrcLine?.text || "");
  const aiText = isDiagnosticOcrLine(aiLine) ? "" : normalizeCompareText(aiLine?.text || "");
  if (aiText && finalText === aiText) return "llm";
  if (bdrcText && finalText === bdrcText) return "bdrc";
  if (aiText) return "llm";
  return "bdrc";
}

function syncAdoptedProofreadText(result, index, provider, line, wasAdopted) {
  if (!wasAdopted || !result.lines?.[index]) return false;
  result.lines[index] = {
    ...result.lines[index],
    text: line.text || "",
    adoptedProvider: provider,
    manualBaselineText: line.manualBaselineText,
    manuallyEdited: Boolean(line.manuallyEdited),
    manualErrorChars: Math.max(0, Number(line.manualErrorChars || 0)),
    manualEditRanges: getManualEditRanges(line),
  };
  result.text = joinActiveOcrLines(result.lines);
  if (els.ocrText) els.ocrText.value = result.text;
  return true;
}

function updateProofreadSummaryAfterEdit() {
  if (els.ocrText && els.charCount && els.recognizedCount) updateSummary();
}

function syncTextViewEditsToAdoptedModels(existing, lines, textLines) {
  const compare = existing.compare;
  const previousLines = existing.lines || [];
  if (!compare || !previousLines.length) return compare;
  const withoutTrailingEmpty = (items) => {
    let count = items.length;
    while (count > 0 && !String(items[count - 1]?.text ?? items[count - 1] ?? "").trim()) count -= 1;
    return count;
  };
  if (previousLines.length !== textLines.length
      && withoutTrailingEmpty(previousLines) !== withoutTrailingEmpty(textLines)) return compare;
  let bdrcChanged = false;
  let llmChanged = false;
  previousLines.forEach((previousLine, index) => {
    if (index >= textLines.length || previousLine.text === lines[index].text) return;
    const provider = getProofreadDefaultChoice(previousLine, compare.bdrc?.lines?.[index], compare.llm?.lines?.[index]);
    const reviewKey = provider === "qwen" || provider === "openai" ? `${provider}Reviews` : "";
    const candidate = reviewKey
      ? compare[reviewKey]?.find((review) => review.index === index)
      : compare[provider]?.lines?.[index];
    if (!candidate) return;
    const baseline = candidate.manualBaselineText ?? candidate.text ?? "";
    candidate.text = lines[index].text;
    updateManualEditTracking(candidate, candidate.text, baseline);
    lines[index].adoptedProvider = provider;
    lines[index].manualBaselineText = candidate.manualBaselineText;
    lines[index].manuallyEdited = true;
    lines[index].manualErrorChars = candidate.manualErrorChars;
    lines[index].manualEditRanges = getManualEditRanges(candidate);
    if (provider === "bdrc" || provider === "llm") {
      saveOcrQualityReview({
        result: existing, compare, pageNum: state.pageNum, blockIndex: index,
        text: candidate.text, qualitySide: provider,
        manualErrorChars: candidate.manualErrorChars || 0,
      });
    }
    bdrcChanged ||= provider === "bdrc";
    llmChanged ||= provider === "llm";
  });
  if (bdrcChanged) compare.bdrc.text = joinActiveOcrLines(compare.bdrc.lines);
  if (llmChanged) compare.llm.text = joinActiveOcrLines(compare.llm.lines);
  return compare;
}

function ensureProofreadCompareResult() {
  const existing = state.ocrResults.get(state.pageNum) || {
    text: "",
    lines: [],
    source: "manual",
    raw: null,
    updatedAt: "",
  };
  const compare = getOcrSourceCompare(existing) || makeEmptyOcrCompare(existing);
  const result = {
    ...existing,
    compare,
    lines: existing.lines?.length ? existing.lines : makeOcrLinesFromText(existing.text || ""),
  };
  state.ocrResults.set(state.pageNum, result);
  return { result, compare };
}

function ensureProofreadLine(lines, index, fallbackLine = null) {
  while (lines.length <= index) {
    lines.push({ text: "", bbox: null, index: lines.length });
  }
  const line = lines[index] || { text: "", bbox: null, index };
  line.index = index;
  if (!normalizeBbox(line.bbox) && normalizeBbox(fallbackLine?.bbox)) {
    line.bbox = normalizeBbox(fallbackLine.bbox);
  }
  lines[index] = line;
  return line;
}

function updateProofreadCompareLine(side, index, value, line, peerLine) {
  const { result, compare } = ensureProofreadCompareResult();
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const wasAdopted = getProofreadDefaultChoice(
    result.lines?.[index], compare.bdrc.lines[index], compare.llm.lines[index],
  ) === sideKey;
  const normalizedValue = normalizeOcrTextSpacing(value || "");
  const targetLine = ensureProofreadLine(compare[sideKey].lines, index, getSourceLineForRow(line, peerLine));
  const previousText = String(targetLine.text || "");
  targetLine.text = normalizedValue;
  if (normalizedValue.trim()) {
    targetLine.error = false;
    targetLine.missing = false;
    targetLine.diagnostic = false;
    targetLine.recognitionError = "";
  }
  updateManualEditTracking(targetLine, normalizedValue, targetLine.manualBaselineText ?? previousText);
  if (line) {
    line.text = normalizedValue;
    line.manualBaselineText = targetLine.manualBaselineText;
    line.manuallyEdited = true;
    line.manualErrorChars = targetLine.manualErrorChars;
    line.manualEditRanges = targetLine.manualEditRanges;
  }
  compare[sideKey].text = joinActiveOcrLines(compare[sideKey].lines);
  if (sideKey === "llm") {
    compare.llm.returnedLineCount = countNonEmptyOcrLines(compare.llm.lines);
  }
  result.compare = compare;
  result.updatedAt = new Date().toISOString();
  if (syncAdoptedProofreadText(result, index, sideKey, targetLine, wasAdopted)) updateProofreadSummaryAfterEdit();
  saveOcrQualityReview({
    result, compare, pageNum: state.pageNum, blockIndex: index,
    text: targetLine.text, qualitySide: sideKey,
    manualErrorChars: targetLine.manualErrorChars || 0,
  });
  state.ocrResults.set(state.pageNum, result);
  showProofreadAutoSaveStatus(index, saveCachedResults() !== false);
  updateAiOcrPanelMeta(compare);
  return targetLine;
}

function markSelectedSharedError(index, card, expectedProvider = "") {
  const selection = getSelectedProofreadRange(card);
  if (!selection || selection.index !== index || (expectedProvider && (selection.reviewProvider || selection.side) !== expectedProvider)) {
    setStatus(`请先在当前行的${expectedProvider ? proofreadModelName(expectedProvider) : "BDRC、Gemini 或千问/OpenAI 候选"}文字中选中需要标记为“错误”的字母。`, "warn");
    return;
  }

  if (selection.reviewProvider) {
    const saved = updateIndependentReviewErrors(selection.reviewProvider, index, selection.sourceText, selection);
    if (saved) {
      refreshProofreadErrorMarkDisplay(index, selection.reviewProvider);
      setStatus(saved === true
        ? `第 ${index + 1} 行的独立候选已标错并保存。`
        : `第 ${index + 1} 行标错后未能保存，请重试。`, saved === true ? "ok" : "error");
    }
    return;
  }

  const { result, compare } = ensureProofreadCompareResult();
  const sideKey = selection.side === "bdrc" ? "bdrc" : "llm";
  const sourceLabel = sideKey === "bdrc" ? "BDRC" : "Gemini";
  const selectedLine = ensureProofreadLine(compare[sideKey].lines, index);
  const sourceText = String(selectedLine.text || "");
  const start = clamp(selection.start, 0, sourceText.length);
  const end = clamp(selection.end, start, sourceText.length);
  const selectedText = sourceText.slice(start, end);

  if (!selectedText.trim()) {
    setStatus("选中的内容为空，无法标错。", "warn");
    return;
  }

  const mark = {
    id: makeSharedErrorId(index),
    blockIndex: index,
    text: selectedText,
    bdrcRanges: [],
    llmRanges: [],
    ...(sideKey === "bdrc"
      ? { model: compare.bdrc.model || result.ocrProfile || "BDRC", provider: "bdrc" }
      : getAiVisionModelMetadata(compare, result)),
    createdAt: new Date().toISOString(),
  };
  mark[sideKey === "bdrc" ? "bdrcRanges" : "llmRanges"] = [{ start, end }];

  compare.sharedErrors = normalizeSharedErrorMarks([...(compare.sharedErrors || []), mark]);
  result.compare = compare;
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  saveOcrQualityReview({
    result, compare, pageNum: state.pageNum, blockIndex: index,
    text: sourceText, qualitySide: sideKey,
    manualErrorChars: selectedLine.manualErrorChars || 0,
  });
  const saved = saveCachedResults() !== false;
  showProofreadAutoSaveStatus(index, saved);
  refreshProofreadErrorMarkDisplay(index);
  setStatus(saved
    ? `第 ${index + 1} 行已在 ${sourceLabel} 结果中标记“错误”。`
    : `第 ${index + 1} 行标错后未能保存，请重试。`, saved ? "ok" : "error");
}

function clearSharedErrorMark(index, card, expectedProvider = "") {
  const candidateSelection = getSelectedProofreadRange(card);
  if (expectedProvider && candidateSelection && (
    candidateSelection.index !== index || (candidateSelection.reviewProvider || candidateSelection.side) !== expectedProvider
  )) {
    setStatus(`请先选择当前行的${proofreadModelName(expectedProvider)}文字，或取消选区后撤销该模型的全部标错。`, "warn");
    return;
  }
  if (expectedProvider === "qwen" || expectedProvider === "openai") {
    const result = state.ocrResults.get(state.pageNum);
    const candidate = result?.compare?.[`${expectedProvider}Reviews`]?.find((review) => review.index === index);
    if (!candidate) return;
    if (candidateSelection && candidateSelection.sourceText !== candidate.text) {
      setStatus("识别文字已更新，请重新选中后撤销标错。", "warn");
      return;
    }
    const before = candidate.errorRanges?.length || 0;
    candidate.errorRanges = candidateSelection
      ? (candidate.errorRanges || []).filter((range) => !rangesOverlap(range.start, range.end, candidateSelection.start, candidateSelection.end))
      : [];
    if (candidate.errorRanges.length === before) {
      setStatus(`当前${proofreadModelName(expectedProvider)}结果没有命中的“错误”标记。`, "warn");
      return;
    }
    const saved = saveCachedResults() !== false;
    showProofreadAutoSaveStatus(index, saved);
    refreshProofreadErrorMarkDisplay(index, expectedProvider);
    setStatus(saved
      ? `已清除${proofreadModelName(expectedProvider)}结果中的“错误”标记。`
      : `撤销标错后未能保存，请重试。`, saved ? "ok" : "error");
    return;
  }
  if (candidateSelection?.reviewProvider && candidateSelection.index === index) {
    const result = state.ocrResults.get(state.pageNum);
    const key = candidateSelection.reviewProvider === "qwen" ? "qwenReviews" : "openaiReviews";
    const candidate = result?.compare?.[key]?.find((review) => review.index === index);
    if (candidate && candidate.text === candidateSelection.sourceText) {
      candidate.errorRanges = (candidate.errorRanges || []).filter((range) => !rangesOverlap(range.start, range.end, candidateSelection.start, candidateSelection.end));
      const saved = saveCachedResults() !== false;
      showProofreadAutoSaveStatus(index, saved);
      refreshProofreadErrorMarkDisplay(index, candidateSelection.reviewProvider);
      setStatus(saved ? "已清除候选选区中的错误标记。" : "撤销标错后未能保存，请重试。", saved ? "ok" : "error");
    }
    return;
  }
  const { result, compare } = ensureProofreadCompareResult();
  const before = compare.sharedErrors?.length || 0;
  if (!before) {
    setStatus("当前页还没有“错误”标记。", "warn");
    return;
  }

  const selection = getSelectedProofreadRange(card);
  let nextMarks;
  if (selection && selection.index === index) {
    const sideKey = selection.side === "bdrc" ? "bdrc" : "llm";
    const selectedRange = {
      start: Math.min(selection.start, selection.end),
      end: Math.max(selection.start, selection.end),
    };
    if (expectedProvider) {
      const rangesKey = sideKey === "bdrc" ? "bdrcRanges" : "llmRanges";
      nextMarks = compare.sharedErrors.map((mark) => mark.blockIndex === index ? {
        ...mark,
        [rangesKey]: (mark[rangesKey] || []).filter((range) => !rangesOverlap(range.start, range.end, selectedRange.start, selectedRange.end)),
      } : mark).filter((mark) => mark.bdrcRanges?.length || mark.llmRanges?.length);
    } else {
      nextMarks = compare.sharedErrors.filter((mark) => (
        mark.blockIndex !== index || !sharedErrorMarkOverlaps(mark, sideKey, selectedRange)
      ));
    }
  } else {
    if (expectedProvider) {
      const rangesKey = expectedProvider === "bdrc" ? "bdrcRanges" : "llmRanges";
      nextMarks = compare.sharedErrors.map((mark) => mark.blockIndex === index ? {
        ...mark, [rangesKey]: [],
      } : mark).filter((mark) => mark.bdrcRanges?.length || mark.llmRanges?.length);
    } else {
      nextMarks = compare.sharedErrors.filter((mark) => mark.blockIndex !== index);
    }
  }

  const changed = JSON.stringify(nextMarks) !== JSON.stringify(compare.sharedErrors);
  compare.sharedErrors = normalizeSharedErrorMarks(nextMarks);
  if (!changed) {
    setStatus("当前选区没有命中“错误”标记。", "warn");
    return;
  }

  result.compare = compare;
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  const qualitySide = expectedProvider || selection?.side;
  if (qualitySide === "bdrc" || qualitySide === "llm") {
    const line = getEffectiveOcrSideLines(compare[qualitySide])[index];
    saveOcrQualityReview({
      result,
      compare,
      pageNum: state.pageNum,
      blockIndex: index,
      text: line?.text || "",
      qualitySide,
      manualErrorChars: line?.manualErrorChars || 0,
    });
  }
  const saved = saveCachedResults() !== false;
  showProofreadAutoSaveStatus(index, saved);
  refreshProofreadErrorMarkDisplay(index);
  setStatus(saved
    ? `已清除第 ${index + 1} 行的“错误”标记。`
    : `第 ${index + 1} 行撤销标错后未能保存，请重试。`, saved ? "ok" : "error");
}

function saveProofreadBlockChoice(index, side, card) {
  const { result, compare } = ensureProofreadCompareResult();
  const selectedProviderLabel = side === "qwen" ? "千问" : side === "openai" ? "OpenAI" : side === "llm" ? "Gemini" : "BDRC";
  const candidateProvider = side === "qwen" || side === "openai" ? side : "";
  const candidate = candidateProvider
    ? compare[`${candidateProvider}Reviews`]?.find((review) => review.index === index) : null;
  if (["pending-review", "aligned-pending-review"].includes(candidate?.alignmentStatus)) {
    setStatus("千问候选行对应待复核，不能直接采用；原结果保留。", "warn");
    return false;
  }
  if (candidateProvider && !candidate) {
    setStatus(`当前行没有可采用的${selectedProviderLabel}候选。`, "warn");
    return false;
  }
  // Adoption changes only the final transcription, never another model's record.
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const peerKey = sideKey === "bdrc" ? "llm" : "bdrc";
  const selectedLine = candidate || ensureProofreadLine(compare[sideKey].lines, index, compare[peerKey].lines[index]);
  if (sideKey === "llm" && isDiagnosticOcrLine(selectedLine)) {
    setStatus("Gemini 当前没有可保存的识别文本；请重新识别，或先手动编辑该行 Gemini 结果。", "warn");
    return false;
  }
  const peerLine = compare[peerKey].lines[index] || null;
  const sourceLine = getSourceLineForRow(selectedLine, peerLine) || result.lines?.[index] || null;
  const finalLines = result.lines?.length ? result.lines.map((line, lineIndex) => ({
    ...line,
    text: normalizeOcrTextSpacing(line.text || ""),
    deleted: Boolean(line.deleted),
    bbox: normalizeBbox(line.bbox),
    index: lineIndex,
  })) : [];
  ensureProofreadLine(finalLines, index, sourceLine);
  finalLines[index] = {
    text: normalizeOcrTextSpacing(selectedLine.text || ""),
    adoptedProvider: candidateProvider || sideKey,
    bbox: normalizeBbox(sourceLine?.bbox) || normalizeBbox(finalLines[index]?.bbox),
    manualBaselineText: selectedLine.manualBaselineText,
    manuallyEdited: Boolean(selectedLine.manuallyEdited),
    manualErrorChars: Math.max(0, Number(selectedLine.manualErrorChars || 0)),
    manualEditRanges: getManualEditRanges(selectedLine),
    index,
  };

  result.lines = finalLines;
  result.text = joinActiveOcrLines(finalLines);
  result.compare = compare;
  if (!candidateProvider) {
    saveOcrQualityReview({
      result,
      compare,
      pageNum: state.pageNum,
      blockIndex: index,
      text: selectedLine.text || "",
      qualitySide: sideKey,
      manualErrorChars: selectedLine.manualErrorChars || 0,
    });
  }
  result.source = "proofread";
  result.updatedAt = new Date().toISOString();
  state.ocrResults.set(state.pageNum, result);
  els.ocrText.value = result.text;
  const saved = saveCachedResults() !== false;
  showProofreadAutoSaveStatus(index, saved);
  updateSummary();
  updateThumbnailState();
  if (card) {
    card.classList.add("is-saved");
    card.querySelectorAll(".proofread-choice input").forEach((input) => {
      input.checked = input.value === (candidateProvider || sideKey);
    });
    const choiceSelect = card.querySelector(".proofread-choice-select");
    if (choiceSelect) {
      choiceSelect.value = candidateProvider || sideKey;
    }
  }
  setStatus(saved
    ? `第 ${index + 1} 行已自动采用并保存为 ${selectedProviderLabel} 版本。`
    : `第 ${index + 1} 行采用 ${selectedProviderLabel} 后未能保存，请重试。`, saved ? "ok" : "error");
  return saved;
}

function getCurrentOcrCompareOrEmpty() {
  if (!state.pageCount) {
    return {
      note: "请先加载 PDF 或图片；选择“智能（BDRC + LLM）”识别后，BDRC 与 Gemini 会分别显示在两个独立栏。",
      bdrc: normalizeOcrCompareSide({ label: "BDRC", text: "", lines: [] }),
      llm: normalizeOcrCompareSide({ label: "Gemini / LLM", text: "", lines: [] }),
    };
  }

  const result = state.ocrResults.get(state.pageNum);
  return getOcrSourceCompare(result) || makeEmptyOcrCompare(result);
}

function renderOcrSourceSide(container, sideData, peerData, side, compare = null) {
  container.innerHTML = "";
  const lines = getEffectiveOcrSideLines(sideData);
  const peerLines = getEffectiveOcrSideLines(peerData, lines);
  const hasText = Boolean(String(sideData.text || "").trim() || lines.some((line) => !line.deleted && String(line.text || "").trim()));

  if (!hasText && !lines.some((line) => line.deleted || line.error)) {
    const empty = document.createElement("div");
    empty.className = "line-compare-empty";
    const message = side === "bdrc"
      ? "BDRC OCR 结果会显示在这里。"
      : "Gemini OCR 结果会显示在这里。";
    empty.innerHTML = `<strong>等待结果</strong><span>${message}</span>`;
    container.appendChild(empty);
    return;
  }

  container.appendChild(renderOcrSourceRows({
    lines,
    peerLines,
    rowCount: Math.max(lines.length, peerLines.length, 1),
    side,
    compare,
  }));
}

function getOcrSourceCompare(result) {
  if (!result) return null;
  const storedCompare = normalizeOcrCompare(result.compare);
  const rawCompare = makeOcrCompareFromRawResult(result);
  if (storedCompare) {
    // Older single-model saves omitted comparison metadata. Recover only from
    // the stored response, never from the currently selected model.
    if (result.source === "ai-vision" && !storedCompare.llm.model) {
      storedCompare.llm.model = getOcrResponseModel(result.raw);
      storedCompare.llm.provider = storedCompare.llm.provider || getOcrResponseProvider(result.raw);
    }
    if (result.source === "bdrc") {
      const originalLines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
      storedCompare.bdrc.lines = storedCompare.bdrc.lines.map((line, index) => ({
        ...originalLines[index], ...line,
        bbox: line.bbox || originalLines[index]?.bbox || null,
        regionLabel: line.regionLabel || originalLines[index]?.regionLabel || "",
        regionId: line.regionId || originalLines[index]?.regionId || "",
        regionLineIndex: originalLines[index]?.regionLineIndex ?? index,
      }));
      if (!hasOcrSideContent(storedCompare.bdrc)) storedCompare.bdrc = makeEmptyOcrCompare(result).bdrc;
    }
    if (rawCompare) {
      if (!hasOcrSideContent(storedCompare.bdrc) && hasOcrSideContent(rawCompare.bdrc)) {
        storedCompare.bdrc = rawCompare.bdrc;
      }
      if (!hasOcrSideContent(storedCompare.llm) && hasOcrSideContent(rawCompare.llm)) {
        storedCompare.llm = rawCompare.llm;
      }
      storedCompare.note = storedCompare.note || rawCompare.note || "";
    }
    return storedCompare;
  }
  return rawCompare || makeAiOnlyCompareWithBdrcDiagnostic(result) || (result.text ? makeEmptyOcrCompare(result) : null);
}

function isMissingOcrTranscription(line) {
  return Boolean(line?.missing || /〔.*(?:待人工|待识别|复核).*〕/.test(line?.text || ""));
}

function getPrimaryOcrDisplay(compare) {
  const useBdrc = hasOcrSideContent(compare.bdrc) && !compare.bdrc.error;
  if (!useBdrc) return { side: compare.llm, peer: null, key: "llm" };
  const result = state.ocrResults.get(state.pageNum);
  const lines = getEffectiveOcrSideLines(compare.bdrc).map((line, index) => {
    const finalLine = result?.lines?.[index];
    const reviewed = compare.llm.lines?.[index];
    if (result?.source === "proofread" && finalLine) return { ...line, ...finalLine };
    if (isMissingOcrTranscription(line) && reviewed?.text && !isDiagnosticOcrLine(reviewed)) {
      return { ...line, text: reviewed.text, missing: false, error: false, diagnostic: false };
    }
    return line;
  });
  return { side: { ...compare.bdrc, lines, text: joinActiveOcrLines(lines) }, peer: compare.llm, key: "bdrc" };
}

function isAiOnlyMode() {
  return Boolean(document.querySelector(".app-shell")?.classList.contains("ai-only-mode"));
}

function isCurrentGeminiResult(side) {
  if (!hasOcrSideContent(side)) return false;
  const model = String(side?.model || side?.lines?.find((line) => line?.model)?.model || "")
    .split(":").pop().split("/").pop().trim().toLowerCase();
  const provider = String(side?.provider || side?.lines?.find((line) => line?.provider)?.provider || "")
    .trim().toLowerCase();
  if (model.startsWith("gemini-")) {
    return true;
  }
  if (model === "gemini") return true;
  if (model) return false;
  return provider === "gemini" || provider.includes("gemini")
    || (!side?.model && String(side?.label || "").toLowerCase().includes("gemini")
      && Boolean(side?.text || side?.lines?.some((line) => String(line?.text || "").trim())));
}

function getVisibleServerCompare(compare) {
  if (!compare || !isAiOnlyMode()) return compare;
  const empty = () => normalizeOcrCompareSide({ label: "", text: "", lines: [] });
  return {
    ...compare,
    bdrc: empty(),
    llm: isCurrentGeminiResult(compare.llm) ? compare.llm : empty(),
  };
}

function getAiOnlyDisplayCompare(compare) {
  if (!compare || !isAiOnlyMode()) return compare;
  const llm = normalizeOcrCompareSide(compare.llm || { label: "Gemini / LLM", text: "", lines: [] });
  return {
    ...compare,
    note: "当前仅显示 Gemini 识别结果。",
    bdrc: normalizeOcrCompareSide({ label: "BDRC", text: "", lines: [] }),
    llm,
  };
}

function makeAiOnlyCompareWithBdrcDiagnostic(result) {
  if (!result || result.source !== "ai-vision") return null;
  const aiText = String(result.text || "").trim();
  const aiLines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
  if (!aiText && !aiLines.length) return null;

  const bdrcError = isCloudDeployment()
    ? "Zeabur 线上服务未配置 BDRC_OCR_UPSTREAM_URL，当前只能显示 Gemini 识别结果。"
    : "当前页只有 Gemini 结果；请切换到智能识别并确认 BDRC 服务可用后重新识别。";

  return normalizeOcrCompare({
    note: "当前页是旧版 Gemini 单栏结果；BDRC 初稿不可用，已在左栏显示原因。",
    bdrc: {
      label: "BDRC",
      text: "",
      lines: [{
        text: `BDRC 当前不可用：${bdrcError}`,
        bbox: null,
        index: 0,
        error: true,
      }],
      error: true,
    },
    llm: {
      label: "Gemini / LLM",
      text: aiText,
      lines: aiLines.length ? aiLines : makeOcrLinesFromText(aiText),
      model: getOcrResponseModel(result.raw),
      provider: getOcrResponseProvider(result.raw),
      returnedLineCount: aiLines.length || countTextLines(aiText),
      expectedLineCount: aiLines.length || countTextLines(aiText),
    },
  });
}

function makeOcrCompareFromRawResult(result) {
  if (result.source !== "bdrc-ai" || !result.raw || typeof result.raw !== "object") return null;

  const bdrcRaw = result.raw.bdrc;
  const aiRaw = result.raw.ai;
  const bdrcText = extractTextFromJson(bdrcRaw).trim();
  const llmText = extractTextFromJson(aiRaw).trim();
  const bdrcLines = extractOcrLines(bdrcRaw);
  const llmLines = extractOcrLines(aiRaw);
  return normalizeOcrCompare({
    note: result.raw.ai_error
      ? `Gemini 调用未返回可用文本：${result.raw.ai_error}`
      : "左栏为 BDRC OCR 初稿，右栏为 Gemini / LLM 识别或复核结果。",
    bdrc: {
      label: "BDRC",
      text: bdrcText,
      lines: bdrcLines.length ? bdrcLines : makeOcrLinesFromText(bdrcText),
    },
    llm: {
      label: "LLM",
      text: llmText,
      lines: llmLines.length ? llmLines : makeOcrLinesFromText(llmText),
      model: getOcrResponseModel(aiRaw),
      provider: getOcrResponseProvider(aiRaw),
      returnedLineCount: llmLines.length || countTextLines(llmText),
      expectedLineCount: bdrcLines.length || countTextLines(bdrcText),
    },
  });
}

function hasOcrSideContent(side) {
  return Boolean(
    String(side?.text || "").trim() ||
    (side?.lines || []).some((line) => String(line?.text || "").trim())
  );
}

function isDiagnosticOcrLine(line) {
  return Boolean(line?.diagnostic || line?.missing || line?.error);
}

function hasUsableAiVisionContent(compare) {
  const side = compare?.llm;
  if (!side || side.error) return false;
  return hasOcrSideContent(side);
}

function shouldShowAiVisionDiagnostic(compare, line, index) {
  if (line?.diagnostic || line?.missing) return true;
  if (line?.error && !hasUsableAiVisionContent(compare)) return true;
  if (String(line?.text || "").trim()) return false;
  if (!hasUsableAiVisionContent(compare)) return true;
  const returned = Number(compare?.llm?.returnedLineCount || 0) || countNonEmptyOcrLines(compare?.llm?.lines || []);
  return Boolean(returned && index >= returned);
}

function makeMissingAiVisionLine(compare, index, fallbackBbox = null) {
  return {
    text: getAiVisionDiagnosticText(compare, index),
    bbox: normalizeBbox(fallbackBbox),
    index,
    error: Boolean(compare?.llm?.error),
    missing: true,
    diagnostic: true,
  };
}

function getAiVisionDiagnosticText(compare, index) {
  const side = compare?.llm;
  const explicitLine = (side?.lines || [])
    .map((line) => String(line?.text || "").trim())
    .find(Boolean);
  const explicitText = String(side?.text || explicitLine || "").trim();
  if (side?.error) {
    return explicitText || "Gemini 调用失败；请检查 AI OCR 服务后重新识别当前页。";
  }
  if (hasOcrSideContent(side)) {
    return `Gemini 未返回第 ${index + 1} 行的识别结果；模型可能只返回了前几行，请重新识别当前页。`;
  }
  return "Gemini 未返回文本；请重新识别当前页，或检查 18092 AI OCR 服务。";
}

function renderOcrSourceComparison(compare) {
  const wrapper = document.createElement("section");
  wrapper.className = "ocr-source-compare";

  const note = document.createElement("div");
  note.className = "ocr-source-compare-note";
  note.textContent = compare.note || "左栏为 BDRC OCR 初稿，右栏为 Gemini / LLM 识别或复核结果。";
  wrapper.appendChild(note);

  const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
  const llmLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
  const rowCount = Math.max(bdrcLines.length, llmLines.length);
  const columns = document.createElement("div");
  columns.className = "ocr-source-columns";
  columns.appendChild(
    renderOcrSourceColumn({
      title: "BDRC OCR",
      subtitle: "本地识别初稿",
      lines: bdrcLines,
      peerLines: llmLines,
      rowCount,
      side: "bdrc",
      compare,
    })
  );
  columns.appendChild(
    renderOcrSourceColumn({
      title: "Gemini / LLM",
      subtitle: "智能识别或复核",
      lines: llmLines,
      peerLines: bdrcLines,
      rowCount,
      side: "llm",
      compare,
    })
  );
  wrapper.appendChild(columns);

  return wrapper;
}

function renderOcrSourceRows({ lines, peerLines, rowCount, side, compare = null }) {
  const body = document.createElement("div");
  body.className = `ocr-source-column-body ocr-source-single-body ${side === "bdrc" ? "is-bdrc" : "is-llm"}`;
  const count = Math.max(1, rowCount);
  for (let index = 0; index < count; index += 1) {
    const line = lines[index] || { text: "" };
    const peerLine = peerLines[index] || { text: "" };
    const row = document.createElement("div");
    row.className = "ocr-source-column-row";
    row.dataset.sourceRowIndex = String(index);
    row.dataset.sourceSide = side;
    row.classList.remove("has-difference");
    row.classList.toggle("is-empty", Boolean(line.deleted) || !String(line.text || "").trim());
    row.classList.toggle("is-error", Boolean(line.error));

    const number = document.createElement("div");
    number.className = "ocr-source-compare-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const text = document.createElement("div");
    text.className = "ocr-source-compare-cell";
    text.classList.toggle("is-empty", Boolean(line.deleted) || !String(line.text || "").trim());
    text.classList.toggle("is-error", Boolean(line.error));
    if (line.deleted) {
      text.textContent = "此行的 OCR 结果已删除";
      row.classList.add("is-deleted");
    } else if (line.error) {
      text.textContent = line.text || "";
    } else {
      renderOcrLineMarkup(text, line.text || "", {
        highlightDiff: false,
        manualEditRanges: getManualEditRanges(line),
        sharedErrorRanges: getSharedErrorRanges(compare, side, index, line.text || ""),
      });
    }

    const sourceLine = getSourceLineForRow(line, peerLine);
    const showLineReview = !line.deleted && (side === "bdrc" || isAiOnlyMode());
    if (showLineReview) {
      const actions = document.createElement("div");
      actions.className = "ocr-source-line-actions";
      actions.appendChild(renderQwenLineReview(index, sourceLine, side === "bdrc" ? line : peerLine, side === "llm" ? line : peerLine));
      row.classList.add("has-line-review");
      row.append(number, text, actions);
    } else {
      row.append(number, text);
    }
    row.classList.add("is-locatable");
    row.addEventListener("click", () => activateOcrSourceBlock(sourceLine, index));
    body.appendChild(row);
  }
  return body;
}

function renderOcrSourceColumn({ title, subtitle, lines, peerLines, rowCount, side, compare = null }) {
  const column = document.createElement("article");
  column.className = `ocr-source-column ${side === "bdrc" ? "is-bdrc" : "is-llm"}`;

  const header = document.createElement("div");
  header.className = "ocr-source-column-header";
  header.innerHTML = `<strong>${title}</strong><span>${subtitle}</span>`;
  column.appendChild(header);

  column.appendChild(renderOcrSourceRows({ lines, peerLines, rowCount, side, compare }));
  return column;
}

function makeEmptyOcrCompare(result) {
  let note = "选择“智能（BDRC + LLM）”后点击“识别”，BDRC 与 Gemini 会分别显示在两个独立栏。";
  let bdrcText = "";
  let llmText = "";
  if (result?.source === "bdrc") {
    bdrcText = result.text || "";
    note = "当前只有 BDRC 结果；请用“智能（BDRC + LLM）”重新识别，生成右栏 Gemini / LLM。";
  } else if (result?.source === "ai-vision") {
    llmText = result.text || "";
    note = "当前只有 Gemini 结果；请用“智能（BDRC + LLM）”重新识别，生成左栏 BDRC。";
  } else if (result?.text) {
    bdrcText = result.text;
    note = "当前是旧缓存或直接文本结果；请用“智能（BDRC + LLM）”重新识别当前页。";
  }
  return {
    note,
    bdrc: normalizeOcrCompareSide({ label: "BDRC", text: bdrcText, lines: bdrcText ? (result?.lines?.length ? result.lines : extractOcrLines(result?.raw).length ? extractOcrLines(result.raw) : makeOcrLinesFromText(bdrcText)) : [] }),
    llm: normalizeOcrCompareSide({
      label: "Gemini / LLM",
      text: llmText,
      lines: llmText ? (result?.lines?.length ? result.lines : makeOcrLinesFromText(llmText)) : [],
      model: getOcrResponseModel(result?.raw),
      provider: getOcrResponseProvider(result?.raw),
      returnedLineCount: countTextLines(llmText),
    }),
    sharedErrors: [],
  };
}

function getEffectiveOcrSideLines(sideData, fallbackLines = []) {
  const storedLines = Array.isArray(sideData?.lines) ? sideData.lines : [];
  const textLines = makeOcrLinesFromText(sideData?.text || "", fallbackLines);
  if (!storedLines.length) return textLines;

  const hasStoredText = storedLines.some((line) => String(line?.text || "").trim());
  if (!hasStoredText && textLines.length) return textLines;

    return storedLines.map((line, index) => ({
      text: normalizeOcrTextSpacing(line?.text || textLines[index]?.text || ""),
      bbox: normalizeBbox(line?.bbox) || normalizeBbox(textLines[index]?.bbox) || normalizeBbox(fallbackLines[index]?.bbox),
      bboxApproximate: Boolean(line?.bboxApproximate || textLines[index]?.bboxApproximate || fallbackLines[index]?.bboxApproximate),
      reviewImage: line?.reviewImage || line?.review_image || null,
          recognitionError: String(line?.recognitionError || line?.recognition_error || ""),
          regionLineIndex: Number(line?.regionLineIndex ?? line?.region_line_index ?? 0),
      regionId: line?.regionId || line?.region_id || textLines[index]?.regionId || "",
      regionLabel: line?.regionLabel || line?.region_label || textLines[index]?.regionLabel || "",
      regionLineCount: Number(line?.regionLineCount || line?.region_line_count || textLines[index]?.regionLineCount || 0) || 0,
      manualBaselineText: typeof line?.manualBaselineText === "string" ? line.manualBaselineText : undefined,
      manuallyEdited: Boolean(line?.manuallyEdited),
      manualErrorChars: Math.max(0, Number(line?.manualErrorChars || 0)),
      manualEditRanges: getManualEditRanges(line),
      model: String(line?.model || ""),
      provider: String(line?.provider || ""),
      index,
      error: Boolean(line?.error),
      missing: Boolean(line?.missing),
      diagnostic: Boolean(line?.diagnostic),
      deleted: Boolean(line?.deleted),
    }));
}

function normalizeCompareText(text) {
  return String(text || "").replace(/\s+/g, "");
}

function normalizeOcrTextSpacing(text) {
  return String(text || "")
    .replace(/([\u3400-\u9fff])[\t \u00a0]+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/([\u3400-\u9fff])[\t \u00a0]+(?=[，。！？；：、））》」』”’])/g, "$1")
    .replace(/([，。！？；：、（《「『“‘])[\t \u00a0]+(?=[\u3400-\u9fff])/g, "$1")
    .replace(/([））》」』”’])[\t \u00a0]+(?=[\u3400-\u9fff])/g, "$1");
}

function renderOcrLineMarkup(container, text, options = {}) {
  container.textContent = "";
  if (!text) return;

  const highRiskRanges = getHighRiskClusterScan(text)
    .filter((cluster) => cluster.highRisk)
    .map(({ start, end }) => ({ start, end }));
  const diffRanges = options.highlightDiff ? getOcrDiffRanges(text, options.peerText || "") : [];
  const manualEditRanges = normalizeTextRanges(options.manualEditRanges || []);
  const sharedErrorRanges = expandTextRangesToClusters(options.sharedErrorRanges || [], text);
  const boundaries = Array.from(new Set([
    0,
    text.length,
    ...highRiskRanges.flatMap((range) => [range.start, range.end]),
    ...diffRanges.flatMap((range) => [range.start, range.end]),
    ...manualEditRanges.flatMap((range) => [range.start, range.end]),
    ...sharedErrorRanges.flatMap((range) => [range.start, range.end]),
  ])).sort((a, b) => a - b);

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end <= start) continue;
    const segment = text.slice(start, end);
    if (!segment) continue;

    const highRisk = highRiskRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    const different = diffRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    const manuallyEdited = manualEditRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    const sharedError = sharedErrorRanges.some((range) => rangesOverlap(start, end, range.start, range.end));
    if (!highRisk && !different && !manuallyEdited && !sharedError) {
      container.appendChild(document.createTextNode(segment));
      continue;
    }

    const mark = document.createElement("span");
    mark.className = [
      highRisk ? "ocr-risk-inline" : "",
      different ? "ocr-diff-inline" : "",
      manuallyEdited ? "ocr-manual-edit-inline" : "",
      sharedError ? "ocr-shared-error-inline" : "",
    ].filter(Boolean).join(" ");
    mark.title = [
      highRisk ? "高危：包含藏文上下加字或组合符，优先人工校对" : "",
      different ? "差异：BDRC 与 Gemini 此处不一致" : "",
      manuallyEdited ? "手动修改过的字" : "",
      sharedError ? (options.sharedErrorTitle || "错误：BDRC 与 Gemini 都疑似识别错误，需人工改正") : "",
    ].filter(Boolean).join("；");
    mark.textContent = segment;
    container.appendChild(mark);
  }
}

function getOcrDiffRanges(text, peerText) {
  const sourceTokens = tokenizeOcrDiffText(text);
  const peerTokens = tokenizeOcrDiffText(peerText);
  if (!sourceTokens.length || !peerTokens.length) return [];

  const rows = sourceTokens.length + 1;
  const cols = peerTokens.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let row = sourceTokens.length - 1; row >= 0; row -= 1) {
    for (let col = peerTokens.length - 1; col >= 0; col -= 1) {
      dp[row][col] = sourceTokens[row].value === peerTokens[col].value
        ? dp[row + 1][col + 1] + 1
        : Math.max(dp[row + 1][col], dp[row][col + 1]);
    }
  }

  const matched = new Set();
  let row = 0;
  let col = 0;
  while (row < sourceTokens.length && col < peerTokens.length) {
    if (sourceTokens[row].value === peerTokens[col].value) {
      matched.add(row);
      row += 1;
      col += 1;
    } else if (dp[row + 1][col] >= dp[row][col + 1]) {
      row += 1;
    } else {
      col += 1;
    }
  }

  return mergeRanges(sourceTokens
    .map((token, index) => ({ ...token, index }))
    .filter((token) => !matched.has(token.index))
    .map(({ start, end }) => ({ start, end })));
}

function tokenizeOcrDiffText(text) {
  const source = String(text || "");
  const clusters = getHighRiskClusterScan(source);
  const tokens = [];
  let cursor = 0;

  const pushLooseText = (looseText, offset) => {
    let localOffset = 0;
    for (const char of Array.from(looseText)) {
      const start = offset + localOffset;
      const end = start + char.length;
      localOffset += char.length;
      if (/\s/.test(char)) continue;
      tokens.push({ value: char, start, end });
    }
  };

  clusters.forEach((cluster) => {
    if (cluster.start > cursor) {
      pushLooseText(source.slice(cursor, cluster.start), cursor);
    }
    tokens.push({ value: cluster.text, start: cluster.start, end: cluster.end });
    cursor = cluster.end;
  });

  if (cursor < source.length) {
    pushLooseText(source.slice(cursor), cursor);
  }

  return tokens;
}

function mergeRanges(ranges) {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  sorted.forEach((range) => {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  });
  return merged;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function getSharedErrorRanges(compare, side, blockIndex, text = "") {
  const sideKey = side === "bdrc" ? "bdrc" : "llm";
  const rangesKey = sideKey === "bdrc" ? "bdrcRanges" : "llmRanges";
  const textLength = String(text || "").length;
  if (!compare?.sharedErrors?.length || !textLength) return [];
  return mergeRanges(compare.sharedErrors
    .filter((mark) => mark.blockIndex === blockIndex)
    .flatMap((mark) => mark[rangesKey] || [])
    .map((range) => ({
      start: clamp(Number(range.start), 0, textLength),
      end: clamp(Number(range.end), 0, textLength),
    }))
    .filter((range) => range.end > range.start));
}

function makeSharedErrorId(index) {
  return `shared-error-${state.pageNum}-${index}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getSelectedProofreadRange(card) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const anchorNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const editor = anchorNode?.closest?.(".proofread-editor, .openai-review-candidate");
  if (!editor || !card?.contains(editor)) return null;

  const side = editor.dataset.proofreadSide === "bdrc" ? "bdrc" : "llm";
  const index = Number(editor.dataset.sourceRowIndex);
  if (!Number.isInteger(index)) return null;

  const startProbe = range.cloneRange();
  startProbe.selectNodeContents(editor);
  startProbe.setEnd(range.startContainer, range.startOffset);
  const endProbe = range.cloneRange();
  endProbe.selectNodeContents(editor);
  endProbe.setEnd(range.endContainer, range.endOffset);
  const editorText = editor.textContent || "";
  const textLength = editorText.length;
  const start = clamp(startProbe.toString().length, 0, textLength);
  const end = clamp(endProbe.toString().length, start, textLength);
  return {
    side,
    index,
    start,
    end,
    reviewProvider: editor.dataset.reviewProvider || "",
    sourceText: editorText,
    text: editorText.slice(start, end),
  };
}

function findPeerSharedErrorRange({ selectedText, selectedRange, peerText }) {
  const source = String(selectedText || "");
  const peer = String(peerText || "");
  if (!source.trim() || !peer) return null;

  const sameOffset = peer.slice(selectedRange.start, selectedRange.end);
  if (sameOffset === source) {
    return { start: selectedRange.start, end: selectedRange.end };
  }

  const exactIndex = peer.indexOf(source);
  if (exactIndex >= 0) {
    return { start: exactIndex, end: exactIndex + source.length };
  }

  return null;
}

function sharedErrorMarkOverlaps(mark, side, selectedRange) {
  const ranges = side === "bdrc" ? mark.bdrcRanges : mark.llmRanges;
  return (ranges || []).some((range) => (
    rangesOverlap(selectedRange.start, selectedRange.end, range.start, range.end)
  ));
}

function getHighRiskClusterScan(text) {
  return Array.from(text.matchAll(TIBETAN_CLUSTER_RE)).map((match) => {
    const cluster = match[0];
    const start = match.index || 0;
    return {
      text: cluster,
      start,
      end: start + cluster.length,
      highRisk: TIBETAN_HIGH_RISK_MARK_RE.test(cluster),
    };
  });
}

function getHighRiskClusters(text) {
  return getHighRiskClusterScan(text).filter((cluster) => cluster.highRisk);
}

function getSourceLineForRow(line, peerLine = null) {
  if (!line?.regionLabel && peerLine?.regionLabel && normalizeBbox(peerLine.bbox)) return peerLine;
  if (normalizeBbox(line?.bbox)) return line;
  if (normalizeBbox(peerLine?.bbox)) return peerLine;
  return null;
}

function getVisibleSourceElement() {
  const candidates = [els.imagePage, els.pdfCanvas];
  return candidates.find((source) => {
    if (!source) return false;
    const style = window.getComputedStyle(source);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      source.clientWidth > 0 &&
      source.clientHeight > 0;
  }) || null;
}

function clearSourceBlockOverlay() {
  if (els.sourceBlockOverlay) {
    els.sourceBlockOverlay.innerHTML = "";
  }
}

function renderSourceBlockOverlay() {
  if (!els.sourceBlockOverlay) return;
  els.sourceBlockOverlay.innerHTML = "";

  const source = getVisibleSourceElement();
  if (!source || !state.pageCount) return;
  if (state.activeOcrLine < 0) return;

  const blocks = getCurrentSourceBlockRecords();
  if (!blocks.length) return;

  const fragment = document.createDocumentFragment();
  blocks.forEach((block) => {
    if (block.index !== state.activeOcrLine || block.estimated) return;
    const box = getSourceOverlayBox(block.bbox, source);
    if (!box) return;

    const item = document.createElement("div");
    item.className = [
      "source-sync-block",
      block.hasBdrc ? "has-bdrc" : "",
      block.hasAi ? "has-ai" : "",
      block.hasDifference ? "has-difference" : "",
      block.estimated ? "is-estimated" : "",
      state.activeOcrLine === block.index ? "is-active" : "",
    ].filter(Boolean).join(" ");
    item.dataset.sourceRowIndex = String(block.index);
    item.title = `第 ${block.index + 1} 行原文同步框`;
    Object.assign(item.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    fragment.appendChild(item);
  });
  els.sourceBlockOverlay.appendChild(fragment);
}

function getCurrentSourceBlockRecords() {
  const result = state.ocrResults.get(state.pageNum);
  if (!result) return [];

  const compare = getOcrSourceCompare(result);
  if (compare) {
    const aiLines = getEffectiveOcrSideLines(compare.llm);
    const count = aiLines.length;
    return Array.from({ length: count }, (_, index) => {
      const aiLine = aiLines[index] || { text: "" };
      return makeSourceBlockRecord({
        index,
        line: getSourceLineForRow(aiLine, null) || makeEstimatedSourceLineForRow(index, count),
        hasBdrc: false,
        hasAi: Boolean(String(aiLine.text || "").trim()),
        hasDifference: false,
      });
    }).filter(Boolean);
  }

  const lines = result.lines?.length ? result.lines : extractOcrLines(result.raw);
  return (lines || [])
    .map((line, index) => makeSourceBlockRecord({
      index,
      line: getSourceLineForRow(line, null),
      hasBdrc: Boolean(String(line?.text || "").trim()),
      hasAi: false,
      hasDifference: false,
    }))
    .filter(Boolean);
}

function makeSourceBlockRecord({ index, line, hasBdrc, hasAi, hasDifference }) {
  const bbox = normalizeBbox(line?.bbox);
  if (!bbox) return null;
  return {
    index,
    bbox,
    estimated: Boolean(line?.estimated),
    hasBdrc,
    hasAi,
    hasDifference,
  };
}

function makeEstimatedSourceLineForRow(index, rowCount) {
  const count = Math.max(1, Number(rowCount) || 1);
  const contentTop = 0.14;
  const contentBottom = 0.92;
  const step = (contentBottom - contentTop) / count;
  return {
    bbox: {
      x: 0.08,
      y: clamp(contentTop + index * step, 0, 0.96),
      width: 0.84,
      height: Math.max(0.018, Math.min(0.055, step * 0.86)),
    },
    estimated: true,
  };
}

function getSourceOverlayBox(bbox, source) {
  const normalized = normalizeBbox(bbox);
  if (!normalized || !source || !els.pageViewport) return null;

  const sourceWidth = source.clientWidth;
  const sourceHeight = source.clientHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const viewportRect = els.pageViewport.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const sourceLeft = sourceRect.left - viewportRect.left + els.pageViewport.scrollLeft;
  const sourceTop = sourceRect.top - viewportRect.top + els.pageViewport.scrollTop;
  const rawLeft = sourceLeft + normalized.x * sourceWidth;
  const rawTop = sourceTop + normalized.y * sourceHeight;
  const rawWidth = normalized.width * sourceWidth;
  const rawHeight = normalized.height * sourceHeight;
  const horizontalPadding = getSourceHorizontalPadding(rawHeight);
  const verticalPadding = getSourceVerticalPadding(rawHeight);
  const left = Math.max(sourceLeft, rawLeft - horizontalPadding);
  const top = Math.max(sourceTop, rawTop - verticalPadding);
  return {
    left,
    top,
    width: Math.max(6, Math.min(sourceLeft + sourceWidth - left, rawWidth + horizontalPadding * 2)),
    height: Math.max(6, Math.min(sourceTop + sourceHeight - top, rawHeight + verticalPadding * 2)),
  };
}

function handleSourceViewportClick(event) {
  const source = getVisibleSourceElement();
  if (!source || event.target === els.emptyState || els.emptyState?.contains(event.target)) return;

  const sourceRect = source.getBoundingClientRect();
  if (
    event.clientX < sourceRect.left ||
    event.clientX > sourceRect.right ||
    event.clientY < sourceRect.top ||
    event.clientY > sourceRect.bottom
  ) {
    return;
  }

  renderSourceBlockOverlay();
  const hit = findSourceBlockAtPoint(event.clientX, event.clientY);
  if (!hit) return;

  event.preventDefault();
  activateOcrSourceBlock({ bbox: hit.block.bbox }, hit.block.index, {
    scrollSource: false,
    scrollRows: true,
  });
}

function findSourceBlockAtPoint(clientX, clientY) {
  const source = getVisibleSourceElement();
  if (!source || !els.pageViewport) return null;

  const viewportRect = els.pageViewport.getBoundingClientRect();
  const point = {
    x: clientX - viewportRect.left + els.pageViewport.scrollLeft,
    y: clientY - viewportRect.top + els.pageViewport.scrollTop,
  };
  const tolerance = 8;
  const hits = getCurrentSourceBlockRecords()
    .map((block) => ({ block, box: getSourceOverlayBox(block.bbox, source) }))
    .filter(({ box }) => box && (
      point.x >= box.left - tolerance &&
      point.x <= box.left + box.width + tolerance &&
      point.y >= box.top - tolerance &&
      point.y <= box.top + box.height + tolerance
    ))
    .sort((a, b) => {
      const areaA = a.box.width * a.box.height;
      const areaB = b.box.width * b.box.height;
      if (areaA !== areaB) return areaA - areaB;
      const centerA = Math.abs(point.y - (a.box.top + a.box.height / 2));
      const centerB = Math.abs(point.y - (b.box.top + b.box.height / 2));
      return centerA - centerB;
    });

  if (hits.length) return hits[0];
  return null;
}

function activateOcrSourceBlock(line, index, options = {}) {
  state.activeOcrLine = index;
  markOcrSourceRowsActive(index);
  renderSourceBlockOverlay();
  setActiveSourceBlock(index);
  if (options.scrollRows) {
    scrollOcrRowsIntoView(index);
  }
  if (line?.estimated) {
    showSourceLineHighlight(null);
    return;
  }
  showSourceLineHighlight(line, { scrollIntoView: options.scrollSource !== false });
}

function markOcrSourceRowsActive(index) {
  document.querySelectorAll(".ocr-source-column-row.is-active, .ocr-line-row.is-active, .proofread-block-card.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  document.querySelectorAll(`.ocr-source-column-row[data-source-row-index="${index}"]`).forEach((item) => {
    item.classList.add("is-active");
  });
  document.querySelectorAll(`.ocr-line-row[data-source-row-index="${index}"]`).forEach((item) => {
    item.classList.add("is-active");
  });
  document.querySelectorAll(`.proofread-block-card[data-source-row-index="${index}"]`).forEach((item) => {
    item.classList.add("is-active");
  });
}

function setActiveSourceBlock(index) {
  if (!els.sourceBlockOverlay) return;
  els.sourceBlockOverlay.querySelectorAll(".source-sync-block.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  const block = els.sourceBlockOverlay.querySelector(`.source-sync-block[data-source-row-index="${index}"]`);
  if (block) {
    block.classList.add("is-active");
  }
}

function scrollOcrRowsIntoView(index) {
  const rows = document.querySelectorAll(
    `.ocr-source-column-row[data-source-row-index="${index}"], .ocr-line-row[data-source-row-index="${index}"], .proofread-block-card[data-source-row-index="${index}"]`,
  );
  rows.forEach((row) => {
    row.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  });
}

function activateOcrLine(line, index, row) {
  state.activeOcrLine = index;
  els.ocrLineCompare.querySelectorAll(".ocr-line-row.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  document.querySelectorAll(".ocr-source-column-row.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  row.classList.add("is-active");
  renderSourceBlockOverlay();
  setActiveSourceBlock(index);
  showSourceLineHighlight(line);
}

function showSourceLineHighlight(line, options = {}) {
  const bbox = line?.bbox || line;
  const normalized = normalizeBbox(bbox);
  const source = getVisibleSourceElement();
  if (!normalized || !source) {
    els.sourceLineHighlight.classList.remove("is-visible");
    return;
  }

  const sourceWidth = source.clientWidth;
  const sourceHeight = source.clientHeight;
  const viewportRect = els.pageViewport.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const sourceLeft = sourceRect.left - viewportRect.left + els.pageViewport.scrollLeft;
  const sourceTop = sourceRect.top - viewportRect.top + els.pageViewport.scrollTop;
  const rawLeft = sourceLeft + normalized.x * sourceWidth;
  const rawWidth = normalized.width * sourceWidth;
  const rawTop = sourceTop + normalized.y * sourceHeight;
  const rawHeight = normalized.height * sourceHeight;
  const horizontalPadding = getSourceHorizontalPadding(rawHeight);
  const verticalPadding = getSourceVerticalPadding(rawHeight);
  const left = Math.max(sourceLeft, rawLeft - horizontalPadding);
  const width = Math.max(6, Math.min(sourceLeft + sourceWidth - left, rawWidth + horizontalPadding * 2));
  const top = Math.max(sourceTop, rawTop - verticalPadding);
  const height = Math.max(12, Math.min(sourceTop + sourceHeight - top, rawHeight + verticalPadding * 2));
  Object.assign(els.sourceLineHighlight.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`,
  });
  els.sourceLineHighlight.classList.add("is-visible");

  if (options.scrollIntoView !== false) {
    els.pageViewport.scrollTo({
      left: Math.max(0, left + width / 2 - els.pageViewport.clientWidth / 2),
      top: Math.max(0, top + height / 2 - els.pageViewport.clientHeight / 2),
      behavior: "smooth",
    });
  }
}

function renderActiveSourceHighlight() {
  if (state.activeOcrLine < 0) {
    els.sourceLineHighlight.classList.remove("is-visible");
    setActiveSourceBlock(-1);
    return;
  }
  const line = getSourceLineByIndex(state.activeOcrLine);
  renderSourceBlockOverlay();
  setActiveSourceBlock(state.activeOcrLine);
  showSourceLineHighlight(line);
}

function getSourceLineByIndex(index) {
  const result = state.ocrResults.get(state.pageNum);
  const compare = getOcrSourceCompare(result);
  if (compare) {
    const bdrcLines = getEffectiveOcrSideLines(compare.bdrc);
    const aiLines = getEffectiveOcrSideLines(compare.llm, bdrcLines);
    const count = Math.max(bdrcLines.length, aiLines.length);
    return getSourceLineForRow(bdrcLines[index], aiLines[index]);
  }
  const lines = result?.lines?.length ? result.lines : extractOcrLines(result?.raw);
  return getSourceLineForRow(lines?.[index], null);
}

function clearSourceLineHighlight() {
  state.activeOcrLine = -1;
  els.sourceLineHighlight.classList.remove("is-visible");
  document.querySelectorAll(".ocr-source-column-row.is-active, .ocr-line-row.is-active, .proofread-block-card.is-active").forEach((item) => {
    item.classList.remove("is-active");
  });
  setActiveSourceBlock(-1);
}

function resizeLineEditor(editor) {
  if (editor.classList.contains("proofread-editor")) {
    editor.style.height = "";
    return;
  }
  editor.style.height = "auto";
  editor.style.height = `${Math.max(48, editor.scrollHeight)}px`;
}

function syncLineEditorsToResult(lines) {
  const text = lines.map((line) => line.text || "").join("\n");
  const existing = state.ocrResults.get(state.pageNum) || {};
  state.ocrResults.set(state.pageNum, {
    ...existing,
    text,
    lines,
    source: existing.source || "manual",
    updatedAt: new Date().toISOString(),
  });
  els.ocrText.value = text;
  const saved = saveCachedResults() !== false;
  updateSummary();
  updateThumbnailState();
  return saved;
}

function clearCurrentTranslation() {
  if (!state.pageCount) return;
  state.translationResults.delete(state.pageNum);
  els.translationText.value = "";
  saveCachedResults();
  setStatus(`已清空第 ${state.pageNum} 页藏译汉文本。`, "ok");
  updateTranslationPanelForPage();
  updateTranslationSummary();
  updateThumbnailState();
}

function downloadAllOcrText() {
  if (!state.pageCount) {
    setStatus("请先加载文档，再导出所有页面的 OCR 结果。", "warn");
    return;
  }

  const pages = Array.from({ length: state.pageCount }, (_, index) => [index + 1, state.ocrResults.get(index + 1) || null]);
  const body = buildProofreadMarkdown(pages, state.sourceName);
  const blob = new Blob(["\uFEFF", body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "bdrc-ocr").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_藏文OCR校对结果.md`);
  setStatus(`已下载 Markdown 校对结果，共 ${pages.length} 页。`, "ok");
}

function buildProofreadMarkdown(pages, sourceName) {
  return [
    `# ${stripFileExtension(sourceName || "藏文典籍")} 藏文 OCR 校对结果`,
    "",
    "字数与错误数沿用工作台逐行的统计口径；空结果的错误率记为“—”，不代表识别正确。",
    "",
    ...pages.flatMap(([pageNum, result]) => buildOcrPageMarkdown(pageNum, result)),
    ...buildOcrModelQualityMarkdown(state.ocrQualityReviews),
  ].join("\n");
}

function formatOcrExportStats(totalChars, errorChars) {
  return `共 ${totalChars} 字 · 错误 ${errorChars} 字 · 错误率 ${totalChars ? `${(errorChars / totalChars * 100).toFixed(1)}%` : "—"}`;
}

function formatOcrExportText(value) {
  const content = String(value || "");
  if (!content.trim()) return ["（空）", ""];
  const longestTildeRun = Math.max(0, ...Array.from(content.matchAll(/~+/g), (match) => match[0].length));
  const fence = "~".repeat(Math.max(3, longestTildeRun + 1));
  return [`${fence}text`, content, fence, ""];
}

function buildOcrPageMarkdown(pageNum, result) {
  const compare = getOcrSourceCompare(result);
  const bdrcLines = compare ? getEffectiveOcrSideLines(compare.bdrc) : [];
  const geminiLines = compare ? getEffectiveOcrSideLines(compare.llm, bdrcLines) : [];
  const finalLines = result?.lines?.length ? result.lines : makeOcrLinesFromText(result?.text || "", bdrcLines);
  const reviewSets = [compare?.qwenReviews || [], compare?.openaiReviews || []];
  const rowCount = Math.max(
    bdrcLines.length, geminiLines.length, finalLines.length,
    ...reviewSets.map((reviews) => reviews.reduce((max, review) => Math.max(max, review.index + 1), 0)),
  );
  const models = [
    { name: "BDRC", side: "bdrc", lines: bdrcLines, model: compare?.bdrc?.model || "" },
    { name: "Gemini", side: "llm", lines: geminiLines, model: compare?.llm?.model || "" },
    { name: "千问", reviews: reviewSets[0] },
    { name: "OpenAI", reviews: reviewSets[1] },
  ];
  const output = [`## 第 ${pageNum} 页`, "", "| 模型 | 共多少字 | 错误字数 | 错误率 |", "| --- | ---: | ---: | ---: |"];
  const modelRows = models.map((model) => {
    const rows = Array.from({ length: rowCount }, (_, index) => {
      const candidate = model.reviews
        ? model.reviews.find((review) => review.index === index)
        : model.lines[index];
      const content = !model.reviews && isDiagnosticOcrLine(candidate)
        ? ""
        : String(candidate?.text || "");
      const totalChars = countOcrCharacters(content);
      const stats = model.reviews
        ? {
            totalChars,
            errorChars: Math.min(totalChars, Math.max(
              countErrorRanges(content, candidate?.errorRanges || []),
              Math.max(0, Number(candidate?.manualErrorChars || 0)),
            )),
          }
        : getLineQualityStats(content ? candidate : { text: "" }, compare, model.side, index);
      return { content, stats, model: String(candidate?.model || model.model || ""), deleted: Boolean(candidate?.deleted) };
    });
    const totalChars = rows.reduce((sum, row) => sum + row.stats.totalChars, 0);
    const errorChars = rows.reduce((sum, row) => sum + row.stats.errorChars, 0);
    output.push(`| ${model.name} | ${totalChars} | ${errorChars} | ${totalChars ? `${(errorChars / totalChars * 100).toFixed(1)}%` : "—"} |`);
    return { name: model.name, rows, totalChars, errorChars };
  });
  output.push("");
  for (const model of modelRows) {
    output.push(`### ${model.name}`, "", formatOcrExportStats(model.totalChars, model.errorChars), "");
    if (!model.rows.length) {
      output.push(...formatOcrExportText(""));
      continue;
    }
    model.rows.forEach((row, index) => {
      output.push(`#### 第 ${index + 1} 行`, "");
      if (row.model) output.push(`识别模型：${row.model}`, "");
      if (row.deleted) output.push("状态：已从采用文本删除，候选结果仍保留。", "");
      output.push(formatOcrExportStats(row.stats.totalChars, row.stats.errorChars), "", ...formatOcrExportText(row.content));
    });
  }
  if (compare?.qwenReviewArchive?.length) {
    output.push("### 千问未对齐的旧输出", "", "以下文字保留供核查，不计入已对齐行的字数或错误率。", "");
    for (const review of compare.qwenReviewArchive) {
      output.push(`原记录第 ${review.originalIndex + 1} 行`, "", ...formatOcrExportText(review.text));
    }
  }
  output.push("### 当前采用的校对文本", "", ...formatOcrExportText(result?.text || ""));
  return output;
}

function getAiVisionModelMetadata(compare, result) {
  const model = String(compare?.llm?.model || getOcrResponseModel(result?.raw) || "未知模型").trim() || "未知模型";
  const provider = String(compare?.llm?.provider || getOcrResponseProvider(result?.raw) || "").trim();
  return {
    model,
    provider,
    requestId: getOcrResponseRequestId(result?.raw),
    ocrRunAt: String(compare?.llm?.recognizedAt || result?.updatedAt || ""),
  };
}

function getOcrQualityMetadata(compare, result, side = "llm") {
  if (side !== "bdrc") return getAiVisionModelMetadata(compare, result);
  const model = String(compare?.bdrc?.model || result?.ocrProfile || "BDRC").trim() || "BDRC";
  return {
    model,
    provider: "bdrc",
    requestId: getOcrResponseRequestId(result?.raw),
    ocrRunAt: String(compare?.bdrc?.recognizedAt || result?.updatedAt || ""),
  };
}

function getOcrResponseRequestId(raw) {
  if (!raw || typeof raw !== "object") return "";
  return String(raw.requestId || raw.request_id || raw.id || raw.raw?.requestId || raw.raw?.request_id || raw.raw?.id || "").trim();
}

function countOcrCharacters(text) {
  return tokenizeOcrDiffText(text).length;
}

function saveOcrQualityReview({ result, compare, pageNum, blockIndex, text, qualitySide = "llm", manualErrorChars = 0 }) {
  const qualitySource = compare?.[qualitySide];
  if (qualitySource && !qualitySource.recognizedAt) {
    qualitySource.recognizedAt = String(result?.updatedAt || new Date().toISOString());
  }
  const metadata = getOcrQualityMetadata(compare, result, qualitySide);
  const lineStats = getLineQualityStats({text, manualErrorChars}, compare, qualitySide, blockIndex);
  const reviewedChars = lineStats.totalChars;
  if (!reviewedChars) return;
  const matchIndex = state.ocrQualityReviews.findIndex((review) => (
    review.pageNum === pageNum &&
    review.blockIndex === blockIndex &&
    review.model === metadata.model &&
    review.provider === metadata.provider &&
    review.ocrRunAt === metadata.ocrRunAt
  ));
  const review = {
    id: matchIndex >= 0 ? state.ocrQualityReviews[matchIndex].id : `quality-review-${pageNum}-${blockIndex}-${Date.now().toString(36)}`,
    pageNum,
    blockIndex,
    ...metadata,
    reviewedAt: new Date().toISOString(),
    reviewedChars,
    errorChars: lineStats.errorChars,
  };
  if (matchIndex >= 0) {
    state.ocrQualityReviews.splice(matchIndex, 1, review);
  } else {
    state.ocrQualityReviews.push(review);
  }
}

function buildOcrModelQualityMarkdown(reviews) {
  if (!reviews.length) {
    return ["## 模型质检统计", "", "尚无已保存的人工审核行。", ""];
  }
  const stats = new Map();
  reviews.forEach((review) => {
    const key = `${review.provider}::${review.model}`;
    const current = stats.get(key) || { model: review.model, provider: review.provider, reviewedChars: 0, errorChars: 0, blockCount: 0 };
    current.reviewedChars += review.reviewedChars;
    current.errorChars += review.errorChars;
    current.blockCount += 1;
    stats.set(key, current);
  });
  const rows = [...stats.values()]
    .map((item) => ({ ...item, estimatedAccuracy: item.reviewedChars ? (item.reviewedChars - item.errorChars) / item.reviewedChars : 0 }))
    .sort((left, right) => right.estimatedAccuracy - left.estimatedAccuracy || right.reviewedChars - left.reviewedChars);
  return [
    "## 模型质检统计",
    "",
    "仅统计人工标错或修改后自动保存的 BDRC 与 Gemini 行；估算准确率 = 1 - 标错字符数 / 已审核字符数。样本量较小时仅供参考。",
    "",
    "| 模型 | 服务 | 已审核行 | 已审核字符 | 标错字符 | 估算准确率 |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...rows.map((item) => `| ${item.model} | ${item.provider || "-"} | ${item.blockCount} | ${item.reviewedChars} | ${item.errorChars} | ${(item.estimatedAccuracy * 100).toFixed(2)}% |`),
    "",
  ];
}

function stripFileExtension(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}

function downloadAllAiOcrText() {
  const pages = [...state.ocrResults.entries()]
    .map(([pageNum, result]) => {
      const compare = getOcrSourceCompare(result);
      const text = compare?.llm?.text || (result?.source === "ai-vision" ? result.text : "");
      return [pageNum, text];
    })
    .filter(([, text]) => String(text || "").trim())
    .sort((a, b) => a[0] - b[0]);

  if (!pages.length) {
    setStatus("还没有可导出的 Gemini OCR 文本。", "warn");
    return;
  }

  const body = [
    `# ${state.sourceName || "Gemini OCR"} 识别结果`,
    "",
    ...pages.flatMap(([pageNum, text]) => [
      `## 第 ${pageNum} 页`,
      "",
      text || "",
      "",
    ]),
  ].join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "ai-vision-ocr").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_ai_ocr.md`);
  setStatus("已导出全部 Gemini OCR 文本。", "ok");
}

function downloadAllTranslationText() {
  if (!state.translationResults.size) {
    setStatus("还没有可导出的藏译汉文本。", "warn");
    return;
  }

  const pages = [...state.translationResults.entries()].sort((a, b) => a[0] - b[0]);
  const body = [
    `# ${state.sourceName || "藏译汉"} 翻译结果`,
    "",
    ...pages.flatMap(([pageNum, result]) => [
      `## 第 ${pageNum} 页`,
      "",
      result.text || "",
      "",
    ]),
  ].join("\n");
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const safeName = (state.sourceName || "tibetan-zh").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_");
  downloadBlob(blob, `${safeName}_zh.md`);
  setStatus("已导出全部藏译汉文本。", "ok");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const sourceAlignmentJobs = new WeakSet();
async function repairSourceRowBindings(result) {
  if (!result || !["ai-vision", "proofread"].includes(result.source) || result.sourceAlignmentVersion === 2
      || sourceAlignmentJobs.has(result) || !getVisibleSourceElement()) return;
  const compare = getOcrSourceCompare(result);
  const count = compare?.llm?.lines?.length || 0;
  if (!count) return;
  sourceAlignmentJobs.add(result);
  const page = state.pageNum;
  try {
    const blob = await getCurrentPageImageBlob();
    const form = new FormData();
    form.append("file", blob, "page.png");
    form.append("line_count", String(count));
    const endpoint = getAiVisionLineReviewEndpoint().replace(/\/line-review$/, "/layout");
    const response = await fetch(endpoint, {method: "POST", body: form});
    if (!response.ok) throw new Error("原文行定位接口不可用");
    const layout = await response.json();
    if (state.pageNum !== page || state.ocrResults.get(page) !== result) { sourceAlignmentJobs.delete(result); return; }
    const latestCompare = getOcrSourceCompare(result);
    const layoutBboxes = layout.layout_bboxes;
    if (layout.alignment_version !== 2 || !layout.alignment_matched || !Array.isArray(layoutBboxes)
        || layoutBboxes.length !== count || latestCompare?.llm?.lines?.length !== count) {
      setStatus("原文物理行数与识别块数不一致，待人工核对；未自动移动识别或校对内容。", "warn");
      return;
    }
    for (const lines of [result.lines, latestCompare.llm.lines]) {
      if (!Array.isArray(lines) || lines.length !== count) continue;
      lines.forEach((line, i) => {
        line.bbox = layoutBboxes[i];
        line.bboxApproximate = false;
        line.reviewImage = null;
        line.sourceRowIndex = i;
      });
    }
    latestCompare.qwenReviews = (latestCompare.qwenReviews || []).map(review => ({...review,
      alignmentStatus: "pending-review",
      note: "待复核：原文行映射已修正，旧千问候选可能错行；原文字及人工修改保留。"}));
    result.compare = latestCompare;
    result.sourceAlignmentVersion = 2;
    saveCachedResults();
    updateOcrPanelForPage();
    renderSourceBlockOverlay();
  } catch (error) {
    setStatus(`原文行对应检查失败：${error.message}；原结果保留。`, "warn");
    sourceAlignmentJobs.delete(result);
  }
}

function updateOcrPanelForPage() {
  const result = state.ocrResults.get(state.pageNum);
  void repairSourceRowBindings(result);
  const sourceLabel = getResultSourceLabel(result);
  const profile = OCR_PROFILES[result?.ocrProfile] || getSelectedOcrProfile();
  const sourceCompare = getAiOnlyDisplayCompare(getOcrSourceCompare(result));
  const hasAiError = Boolean(sourceCompare?.llm?.error || sourceCompare?.llm?.lines?.some((line) => line.error));
  if (result?.source === "pdf-text") {
    els.ocrTitle.textContent = `第 ${state.pageNum} 页文本层`;
  } else if (state.sourceType === "word") {
    els.ocrTitle.textContent = "Word 文本";
  } else if (state.sourceType === "markdown" || state.sourceType === "text") {
    els.ocrTitle.textContent = state.sourceType === "text" ? "文本文件" : "Markdown 文本";
  } else {
    const engineLabel = result?.source === "bdrc" ? `BDRC · ${profile.label}` : "Gemini";
    els.ocrTitle.textContent = state.sourceType === "image"
      ? `图片 ${engineLabel}`
      : `第 ${state.pageNum} 页 ${engineLabel}`;
  }
  if (els.ocrPaneEyebrow) {
    els.ocrPaneEyebrow.textContent = result?.source === "bdrc" ? "BDRC OCR 结果" : "Gemini OCR 结果";
  }
  els.ocrText.value = result?.text || "";
  els.ocrMeta.textContent = hasAiError
    ? "调用失败"
    : result?.text
    ? (isDirectTextSource(result.source) ? sourceLabel : "已识别")
    : "未识别";
  els.ocrMeta.style.color = hasAiError
    ? "var(--danger)"
    : result?.text
    ? (isDirectTextSource(result.source) ? "var(--blue)" : "var(--green-deep)")
    : "var(--muted)";
  if (state.activeWorkflow === "translation") {
    els.ocrLineCompare.replaceChildren();
    els.aiOcrLineCompare.replaceChildren();
    return;
  }
  renderCurrentOcrView();
  renderSourceBlockOverlay();
  updateSummary();
}

function updateAiOcrPanelMeta(compare = null) {
  if (!els.aiOcrTitle || !els.aiOcrMeta) return;
  const sourceCompare = compare || getCurrentOcrCompareOrEmpty();
  const aiText = sourceCompare.llm.text || "";
  const aiLines = sourceCompare.llm.lines || [];
  const bdrcLines = sourceCompare.bdrc?.lines || [];
  const aiPending = Boolean(sourceCompare.llm.pending);
  const hasAiText = Boolean(aiText.trim());
  const hasAiError = Boolean(sourceCompare.llm.error || aiLines.some((line) => line.error));
  const returnedLineCount = sourceCompare.llm.returnedLineCount || countNonEmptyOcrLines(aiLines);
  const expectedLineCount = sourceCompare.llm.expectedLineCount || countNonEmptyOcrLines(bdrcLines);
  const model = sourceCompare.llm.model || "Gemini";
  const lineMeta = expectedLineCount
    ? `${returnedLineCount}/${expectedLineCount} 行`
    : `${returnedLineCount} 行`;

  els.aiOcrTitle.textContent = state.pageCount ? `第 ${state.pageNum} 页 Gemini` : "等待智能识别";
  els.aiOcrMeta.textContent = aiPending ? "识别中" : hasAiText ? `${model} · ${lineMeta}` : hasAiError ? "调用失败" : "未返回";
  els.aiOcrMeta.title = hasAiText
    ? `Gemini 模型：${model}${sourceCompare.llm.provider ? `；服务：${sourceCompare.llm.provider}` : ""}；返回行数：${lineMeta}`
    : "";
  els.aiOcrMeta.style.color = aiPending
    ? "var(--amber)"
    : hasAiText
    ? "var(--blue)"
    : hasAiError
      ? "var(--danger)"
      : "var(--muted)";
  els.aiCharCount.textContent = String([...aiText.replace(/\s+/g, "")].length);
  els.aiLineCount.textContent = expectedLineCount ? `${returnedLineCount} / ${expectedLineCount}` : String(returnedLineCount);
}

function updateTranslationPanelForPage() {
  const result = state.translationResults.get(state.pageNum);
  els.translationTitle.textContent = state.sourceType === "image" ? "图片藏译汉" : `第 ${state.pageNum} 页藏译汉`;
  els.translationText.value = result?.text || "";
  els.translationMeta.textContent = result?.text ? "已翻译" : "未翻译";
  els.translationMeta.style.color = result?.text ? "var(--blue)" : "var(--muted)";
  updateTranslationSummary();
}

function updateSummary() {
  const text = els.ocrText.value || "";
  els.charCount.textContent = String([...text.replace(/\s+/g, "")].length);
  const recognized = [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length;
  els.recognizedCount.textContent = `${recognized} / ${state.pageCount || 0}`;
  updateFileOcrStatus(recognized);
  updateAiOcrPanelMeta();
}

function updateFileOcrStatus(recognizedCount = null) {
  if (!els.fileOcrStatus) return;
  const recognized = recognizedCount ?? [...state.ocrResults.values()].filter((result) => (result.text || "").trim()).length;
  const directTextCount = [...state.ocrResults.values()].filter((result) => (result.text || "").trim() && isDirectTextSource(result.source)).length;
  let text = "ocr 识别未开始";
  let className = "file-status status-not-started";

  if (state.pageCount && directTextCount >= state.pageCount) {
    text = "文本已提取";
    className = "file-status status-complete";
  } else if (directTextCount > 0) {
    text = "文本提取进行中";
    className = "file-status status-in-progress";
  } else if (state.pageCount && recognized >= state.pageCount) {
    text = "ocr 识别已完成";
    className = "file-status status-complete";
  } else if (recognized > 0) {
    text = "ocr 识别进行中";
    className = "file-status status-in-progress";
  }

  els.fileOcrStatus.textContent = text;
  els.fileOcrStatus.className = className;
}

function updateTranslationSummary() {
  const text = els.translationText.value || "";
  els.translationCharCount.textContent = String([...text.replace(/\s+/g, "")].length);
  const translated = [...state.translationResults.values()].filter((result) => (result.text || "").trim()).length;
  els.translatedCount.textContent = `${translated} / ${state.pageCount || 0}`;
}

function updateThumbnailState() {
  els.thumbnailList.querySelectorAll(".thumbnail-button").forEach((button) => {
    const pageNum = Number(button.dataset.page);
    const pageResult = state.ocrResults.get(pageNum);
    const recognized = Boolean((pageResult?.text || "").trim());
    const directText = recognized && isDirectTextSource(pageResult?.source);
    const translated = Boolean((state.translationResults.get(pageNum)?.text || "").trim());
    button.classList.toggle("active", pageNum === state.pageNum);
    button.classList.toggle("recognized", recognized);
    button.classList.toggle("direct-text", directText);
    button.classList.toggle("translated", translated);
  });
}

function getSourceHorizontalPadding(rawHeight) {
  return Math.max(14, Math.min(42, Number(rawHeight || 0) * 0.9));
}

function getSourceVerticalPadding(rawHeight) {
  return Math.max(6, Math.min(16, Number(rawHeight || 0) * 0.42));
}

function refreshControls() {
  const hasDocument = state.pageCount > 0;
  syncPageControls(hasDocument);
  els.prevButton.disabled = !hasDocument || state.pageNum <= 1;
  els.nextButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  els.viewerFirstPageButton.disabled = !hasDocument || state.pageNum <= 1;
  els.viewerPrevPageButton.disabled = !hasDocument || state.pageNum <= 1;
  els.viewerNextPageButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  els.viewerLastPageButton.disabled = !hasDocument || state.pageNum >= state.pageCount;
  setOptionalDisabled("ocrFirstPageButton", !hasDocument || state.pageNum <= 1 || Boolean(state.batchOcr?.running));
  setOptionalDisabled("ocrPrevPageButton", !hasDocument || state.pageNum <= 1 || Boolean(state.batchOcr?.running));
  setOptionalDisabled("ocrNextPageButton", !hasDocument || state.pageNum >= state.pageCount || Boolean(state.batchOcr?.running));
  setOptionalDisabled("ocrLastPageButton", !hasDocument || state.pageNum >= state.pageCount || Boolean(state.batchOcr?.running));
  els.ocrButton.disabled = !hasDocument || state.isOcrBusy;
  setOptionalDisabled("downloadPageButton", !hasDocument);
  els.copyButton.disabled = !hasDocument;
  setOptionalDisabled("clearButton", !hasDocument);
  els.downloadTextButton.disabled = !hasDocument;
  els.copyAiButton.disabled = !hasDocument;
  els.downloadAiTextButton.disabled = !hasDocument;
  els.translateButton.disabled = !hasDocument;
  els.copyTranslationButton.disabled = !hasDocument;
  els.clearTranslationButton.disabled = !hasDocument;
  els.downloadTranslationButton.disabled = !hasDocument;
  if (state.batchOcr?.running) {
    [els.prevButton, els.nextButton, els.viewerFirstPageButton, els.viewerPrevPageButton,
      els.viewerNextPageButton, els.viewerLastPageButton, els.pageInput, els.viewerPageInput,
      els.ocrProfileSelect, els.ocrModeSelect, els.fileInput, els.folderInput].forEach((element) => {
      if (element) element.disabled = true;
    });
  } else {
    [els.ocrProfileSelect, els.ocrModeSelect, els.fileInput, els.folderInput].forEach((element) => {
      if (element) element.disabled = (element === els.ocrProfileSelect || element === els.ocrModeSelect) && state.isOcrBusy;
    });
  }
  updateBatchOcrProgress();
}

function syncPageControls(hasDocument = state.pageCount > 0) {
  const current = String(state.pageNum || 1);
  const max = String(state.pageCount || 1);
  [els.pageInput, els.viewerPageInput, els.ocrPageInput].forEach((input) => {
    if (!input) return;
    input.disabled = !hasDocument || Boolean(state.batchOcr?.running);
    input.max = max;
    input.value = current;
  });
  if (els.pageTotal) {
    els.pageTotal.textContent = `/ ${state.pageCount || 0}`;
  }
  if (els.renderMeta) {
    els.renderMeta.textContent = `/ ${state.pageCount || 0}`;
  }
  if (els.ocrPageTotal) els.ocrPageTotal.textContent = `/ ${state.pageCount || 0}`;
}

function setBusy(isBusy) {
  const wasBusy = state.isOcrBusy;
  state.isOcrBusy = Boolean(isBusy);
  if (els.ocrModeSelect) els.ocrModeSelect.disabled = Boolean(isBusy);
  if (els.ocrProfileSelect) els.ocrProfileSelect.disabled = Boolean(isBusy);
  els.ocrButton.disabled = isBusy || !state.pageCount;
  refreshGeminiRowModelSelectors();
  setOptionalDisabled("checkOcrButton", isBusy);
  els.ocrButton.querySelector("span").textContent = isBusy ? "识别中" : "识别";
  if (wasBusy && !isBusy && state.ocrResults.get(state.pageNum)?.raw?.line_ocr) updateOcrPanelForPage();
}

function setTranslateBusy(isBusy) {
  state.isTranslateBusy = Boolean(isBusy);
  els.translateButton.disabled = isBusy || !state.pageCount;
  setOptionalDisabled("checkTranslateButton", isBusy);
  els.translateButton.querySelector("span").textContent = isBusy ? "翻译中" : "翻译";
}

function setOptionalDisabled(id, disabled) {
  if (els[id]) {
    els[id].disabled = disabled;
  }
}

function formatNetworkError(error, url, service = "ocr") {
  const resolvedService = service === "ocr" && String(url || "").includes(":18092")
    ? "ai-ocr"
    : service;
  if (String(error?.message || "").includes("Failed to fetch")) {
    if (resolvedService === "translate") {
      return `无法连接 ${url}。请先启动本地藏译汉服务：python3 tibetan-translation-services/nllb_translate_server.py；或把接口地址改成可用的翻译 API。`;
    }
    if (resolvedService === "ai-ocr") {
      return `无法连接 ${url}。请先启动本地 Gemini OCR 服务：python3 tibetan-ocr-core/ai_vision_ocr_server.py；或运行 ./tibetan-proofreading-app/start_services.sh`;
    }
    return `无法连接 ${url}。请先启动 Gemini OCR 服务：python3 tibetan-ocr-core/ai_vision_ocr_server.py`;
  }
  return summarizeServiceError(error?.message || String(error));
}

function summarizeServiceError(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return "未知错误";
  if (text.includes("RESOURCE_EXHAUSTED") || text.includes("Quota exceeded") || text.includes("HTTP 429")) {
    const retryMatch = text.match(/retry in ([0-9.]+)s/i);
    const retry = retryMatch ? `，建议 ${Math.ceil(Number(retryMatch[1]))} 秒后重试` : "";
    return `上游模型额度或频率限制耗尽（HTTP 429 / RESOURCE_EXHAUSTED）${retry}。请更换可用的 Gemini 模型/API key，或稍后重试。`;
  }
  return text.length > 420 ? `${text.slice(0, 420)}...` : text;
}

function setStatus(message, tone = "") {
  const text = String(message || "").trim();
  const shouldShow = shouldShowStatus(text, tone);
  els.statusBar.textContent = shouldShow ? text : "";
  els.statusBar.hidden = !shouldShow;
  els.statusBar.className = `status-bar ${tone} ${shouldShow ? "" : "is-hidden"}`.trim();
}

function shouldShowStatus(message, tone = "") {
  if (!message) return false;
  if (tone === "error") return true;
  if (tone === "ok") return false;
  if (tone === "warn") {
    if (QUIET_STATUS_RE.test(message) && !/(失败|不可用|无法|损坏|无效)/.test(message)) return false;
    return /请|无法|失败|不可用|未初始化|正在|耗尽|限制|损坏|无效|回落|回退|不能|尚未|缺失/.test(message);
  }
  return false;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}
