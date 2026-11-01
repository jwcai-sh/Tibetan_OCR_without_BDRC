(() => {
  const link = document.getElementById('tbTranslationLink');
  if (!link) return;
  const bookId = new URLSearchParams(location.search).get('book_id');
  if (/^[0-9a-f]{32}$/.test(bookId || '')) {
    link.href = `./tb-translation.html?book_id=${encodeURIComponent(bookId)}`;
  }
})();
