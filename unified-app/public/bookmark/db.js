/**
 * db.js  —  API client for Bookmark Manager (backed by SQLite via Hub server)
 *
 * Exposes the same BookmarkDB interface as the original IndexedDB version
 * so app.js requires zero changes.
 */
const BookmarkDB = (() => {
  'use strict';

  const BASE = '/api/bookmark';

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  /* ── URL helpers (kept local — no server round-trip needed) ── */

  function normaliseUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      u.pathname = u.pathname.replace(/\/+$/, '') || '/';
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','source']
        .forEach(p => u.searchParams.delete(p));
      return (u.origin + u.pathname + (u.search || '') + (u.hash || '')).toLowerCase();
    } catch {
      return (urlStr || '').toLowerCase().replace(/\/+$/, '');
    }
  }

  function isValidUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    const u = urlStr.trim().toLowerCase();
    return u && !u.startsWith('javascript:') && !u.startsWith('place:')
             && !u.startsWith('data:')       && !u.startsWith('about:');
  }

  /* ── Bookmarks ── */

  async function saveBookmarks(bookmarks) {
    if (!bookmarks.length) return { added: 0, skipped: 0 };
    // Strip similarDomain (circular reference added by BookmarkParser.enrichBookmarks)
    // before JSON.stringify, then add urlNorm for server-side dedup.
    const prepared = bookmarks
      .filter(bm => isValidUrl(bm.url))
      .map(({ similarDomain: _sd, ...bm }) => ({
        ...bm,
        urlNorm:  bm.urlNorm  || normaliseUrl(bm.url),
        savedAt:  bm.savedAt  || Date.now(),
        addDate:  bm.addDate instanceof Date ? bm.addDate.getTime() : (bm.addDate || null),
      }));
    return api('POST', '/bookmarks/batch', { bookmarks: prepared });
  }

  function updateBookmark(bm) {
    // Strip similarDomain (circular reference) before serializing
    const { similarDomain: _sd, ...data } = bm;
    return api('PUT', `/bookmarks/${encodeURIComponent(data.id)}`, data);
  }

  function getAllBookmarks() { return api('GET', '/bookmarks'); }

  /* ── Import history ── */

  function saveImport(record) { return api('POST', '/imports', record); }

  function getAllImports() { return api('GET', '/imports'); }

  function deleteImport(id) { return api('DELETE', `/imports/${id}`); }

  /* ── Clear all ── */

  function clearAll() { return api('DELETE', '/all'); }

  /* ── Export / Import JSON snapshot ── */

  async function exportJSON() {
    const res = await fetch(BASE + '/export');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function importJSON(jsonString) {
    return api('POST', '/import', { json: jsonString });
  }

  /* ── Stats (computed locally from in-memory array — no server round-trip) ── */

  function computeStats(bookmarks, importCount) {
    const domains = new Set(bookmarks.map(b => b.baseDomain).filter(Boolean));
    return {
      total:           bookmarks.length,
      domains:         domains.size,
      withDescription: bookmarks.filter(b => b.description).length,
      imports:         importCount,
    };
  }

  async function getStats() {
    const [bookmarks, imports] = await Promise.all([getAllBookmarks(), getAllImports()]);
    return computeStats(bookmarks, imports.length);
  }

  /* open() is a no-op — server handles DB initialisation */
  function open() { return Promise.resolve(); }

  return {
    open,
    saveBookmarks, updateBookmark, getAllBookmarks,
    saveImport, getAllImports, deleteImport,
    clearAll, exportJSON, importJSON,
    computeStats, getStats,
    normaliseUrl,
  };
})();
