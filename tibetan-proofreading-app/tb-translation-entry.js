(() => {
  const shell = document.querySelector('.app-shell');
  const workbench = document.getElementById('workbenchView');
  const tbView = document.getElementById('tbTranslationView');
  const frame = document.getElementById('tbTranslationFrame');
  if (!shell || !workbench || !tbView || !frame) return;

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

  function render() {
    const isTranslation = shell.classList.contains('translation-workflow');
    tbView.hidden = !isTranslation;
    if (shell.classList.contains('tb-translation-mode') !== isTranslation) {
      shell.classList.toggle('tb-translation-mode', isTranslation);
    }
    if (isTranslation) {
      const next = frameUrl();
      if (frame.getAttribute('src') !== next) frame.setAttribute('src', next);
      if (!workbench.hidden) workbench.hidden = true;
    } else if (shell.classList.contains('workbench-mode')) {
      if (workbench.hidden) workbench.hidden = false;
    }
  }

  window.addEventListener('popstate', render);
  const observer = new MutationObserver(render);
  observer.observe(shell, { attributes: true, attributeFilter: ['class'] });
  observer.observe(workbench, { attributes: true, attributeFilter: ['hidden'] });
  render();
})();
