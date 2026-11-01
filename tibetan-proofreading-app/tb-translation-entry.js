(() => {
  const shell = document.querySelector('.app-shell');
  const link = document.getElementById('tbTranslationLink');
  const workbench = document.getElementById('workbenchView');
  const tbView = document.getElementById('tbTranslationView');
  const frame = document.getElementById('tbTranslationFrame');
  if (!shell || !link || !workbench || !tbView || !frame) return;

  function bookIdFromLocation() {
    const value = new URLSearchParams(location.search).get('book_id');
    return /^[0-9a-f]{32}$/.test(value || '') ? value : '';
  }

  function frameUrl() {
    const url = new URL('./tb-translation.html', location.href);
    const bookId = bookIdFromLocation();
    if (bookId) url.searchParams.set('book_id', bookId);
    url.searchParams.set('embedded', '1');
    return `${url.pathname}${url.search}`;
  }

  function setViewInRoute(enabled, replace = false) {
    const url = new URL(location.href);
    if (enabled) url.searchParams.set('view', 'tb');
    else url.searchParams.delete('view');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) {
      history[replace ? 'replaceState' : 'pushState'](history.state, '', next);
    }
  }

  function render() {
    const isTranslation = shell.classList.contains('translation-workflow');
    const isTb = isTranslation && new URLSearchParams(location.search).get('view') === 'tb';
    const bookId = bookIdFromLocation();
    link.href = `./tb-translation.html${bookId ? `?book_id=${encodeURIComponent(bookId)}` : ''}`;
    link.textContent = isTb ? '返回逐页翻译' : 'TB 段落对照';
    link.setAttribute('aria-expanded', String(isTb));
    tbView.hidden = !isTb;
    if (shell.classList.contains('tb-translation-mode') !== isTb) {
      shell.classList.toggle('tb-translation-mode', isTb);
    }
    if (isTb) {
      const next = frameUrl();
      if (frame.getAttribute('src') !== next) frame.setAttribute('src', next);
      if (!workbench.hidden) workbench.hidden = true;
    } else if (isTranslation) {
      if (workbench.hidden) workbench.hidden = false;
    }
    if (shell.classList.contains('home-mode') && new URLSearchParams(location.search).get('view') === 'tb') {
      setViewInRoute(false, true);
    }
  }

  link.addEventListener('click', (event) => {
    if (!shell.classList.contains('translation-workflow')) return;
    event.preventDefault();
    setViewInRoute(new URLSearchParams(location.search).get('view') !== 'tb');
    render();
  });
  window.addEventListener('popstate', render);
  const observer = new MutationObserver(render);
  observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
  observer.observe(workbench, { attributes: true, attributeFilter: ['hidden'] });
  render();
})();
