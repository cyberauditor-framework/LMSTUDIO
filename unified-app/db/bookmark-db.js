/**
 * bookmark-db.js  —  SQLite persistence layer for Bookmark Manager
 *
 * Tables:
 *   bookmarks  — individual bookmark records
 *   folders    — folder records (path-keyed for tree reconstruction)
 *   imports    — history of imported files
 */
const Database = require('./sqlite');
const path     = require('path');
const fs       = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'bookmarks.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookmarks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL,
    url_norm    TEXT NOT NULL,
    base_domain TEXT,
    domain      TEXT,
    folder      TEXT DEFAULT '',
    favicon     TEXT,
    add_date    INTEGER,
    description TEXT,
    source_file TEXT,
    saved_at    INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_bm_url_norm   ON bookmarks(url_norm);
  CREATE INDEX IF NOT EXISTS idx_bm_base_domain ON bookmarks(base_domain);
  CREATE INDEX IF NOT EXISTS idx_bm_folder      ON bookmarks(folder);
  CREATE INDEX IF NOT EXISTS idx_bm_source_file ON bookmarks(source_file);

  CREATE TABLE IF NOT EXISTS folders (
    id    TEXT PRIMARY KEY,
    path  TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS imports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    filename     TEXT NOT NULL,
    imported_at  TEXT NOT NULL,
    added        INTEGER NOT NULL DEFAULT 0,
    skipped      INTEGER NOT NULL DEFAULT 0,
    total_in_file INTEGER NOT NULL DEFAULT 0
  );
`);

/* ── Prepared statements ── */
const stmts = {
  insertBm: db.prepare(`
    INSERT OR REPLACE INTO bookmarks
      (id, title, url, url_norm, base_domain, domain, folder, favicon, add_date, description, source_file, saved_at)
    VALUES
      (@id, @title, @url, @url_norm, @base_domain, @domain, @folder, @favicon, @add_date, @description, @source_file, @saved_at)
  `),
  updateBmDesc: db.prepare(`
    UPDATE bookmarks SET description = @description, url_norm = @url_norm WHERE id = @id
  `),
  getAllBm:     db.prepare(`SELECT * FROM bookmarks`),
  delBySource:  db.prepare(`DELETE FROM bookmarks WHERE source_file = ?`),
  getUrlNorms:  db.prepare(`SELECT url_norm FROM bookmarks`),

  insertFolder: db.prepare(`INSERT OR REPLACE INTO folders (id, path, title) VALUES (@id, @path, @title)`),
  getAllFolders: db.prepare(`SELECT * FROM folders`),

  insertImport: db.prepare(`
    INSERT INTO imports (filename, imported_at, added, skipped, total_in_file)
    VALUES (@filename, @importedAt, @added, @skipped, @totalInFile)
  `),
  getAllImports:  db.prepare(`SELECT id, filename, imported_at AS importedAt, added, skipped, total_in_file AS totalInFile FROM imports ORDER BY id ASC`),
  deleteImport:   db.prepare(`DELETE FROM imports WHERE id = ?`),

  clearBm:      db.prepare(`DELETE FROM bookmarks`),
  clearFolders: db.prepare(`DELETE FROM folders`),
  clearImports: db.prepare(`DELETE FROM imports`),
};

/* ── Helper: convert DB row → app object ── */
function rowToBm(row) {
  return {
    id:          row.id,
    type:        'bookmark',          // required by BookmarkParser.countLeaves / collectBookmarks
    title:       row.title,
    url:         row.url,
    urlNorm:     row.url_norm,
    baseDomain:  row.base_domain,
    domain:      row.domain,
    folder:      row.folder || '',
    favicon:     row.favicon,
    addDate:     row.add_date,
    description: row.description || '',
    sourceFile:  row.source_file,
    savedAt:     row.saved_at,
  };
}

module.exports = {
  /** Save an array of bookmarks, deduplicating by normalised URL. Returns { added, skipped }. */
  saveBookmarks(bookmarks) {
    if (!bookmarks.length) return { added: 0, skipped: 0 };
    const existingNorms = new Set(stmts.getUrlNorms.all().map(r => r.url_norm));
    let added = 0, skipped = 0;
    const insertMany = db.transaction(bms => {
      for (const bm of bms) {
        if (!bm.url) { skipped++; continue; }
        const norm = bm.urlNorm || bm.url.toLowerCase().replace(/\/+$/, '');
        if (existingNorms.has(norm)) { skipped++; continue; }
        existingNorms.add(norm);
        stmts.insertBm.run({
          id:          bm.id,
          title:       bm.title || '',
          url:         bm.url,
          url_norm:    norm,
          base_domain: bm.baseDomain || null,
          domain:      bm.domain || null,
          folder:      bm.folder || '',
          favicon:     bm.favicon || null,
          add_date:    bm.addDate || null,
          description: bm.description || null,
          source_file: bm.sourceFile || null,
          saved_at:    bm.savedAt || Date.now(),
        });
        added++;
      }
    });
    insertMany(bookmarks);
    return { added, skipped };
  },

  /** Update a single bookmark (used to save AI description). */
  updateBookmark(bm) {
    const norm = bm.urlNorm || bm.url.toLowerCase().replace(/\/+$/, '');
    stmts.updateBmDesc.run({ description: bm.description || null, url_norm: norm, id: bm.id });
  },

  getAllBookmarks() { return stmts.getAllBm.all().map(rowToBm); },

  deleteBySource(sourceFile) { stmts.delBySource.run(sourceFile); },

  saveFolders(folders) {
    const insertAll = db.transaction(flds => {
      for (const f of flds) stmts.insertFolder.run({ id: f.id, path: f.path || '', title: f.title || '' });
    });
    insertAll(folders);
  },

  getAllFolders() { return stmts.getAllFolders.all().map(r => ({ id: r.id, path: r.path, title: r.title })); },

  saveImport(record) {
    const result = stmts.insertImport.run({
      filename:     record.filename,
      importedAt:   record.importedAt,
      added:        record.added,
      skipped:      record.skipped,
      totalInFile:  record.totalInFile,
    });
    return result.lastInsertRowid;
  },

  getAllImports() { return stmts.getAllImports.all(); },

  deleteImport(id) { stmts.deleteImport.run(id); },

  clearAll() {
    db.transaction(() => {
      stmts.clearBm.run();
      stmts.clearFolders.run();
      stmts.clearImports.run();
    })();
  },

  /** Export full DB snapshot as JSON string (same format as original IndexedDB export). */
  exportJSON() {
    const bookmarks = stmts.getAllBm.all().map(rowToBm);
    const folders   = stmts.getAllFolders.all().map(r => ({ id: r.id, path: r.path, title: r.title }));
    const imports   = stmts.getAllImports.all();
    return JSON.stringify({ _version: 1, _exportedAt: new Date().toISOString(), bookmarks, folders, imports }, null, 2);
  },

  /** Replace all data from a JSON snapshot string. */
  importJSON(jsonString) {
    let data;
    try { data = JSON.parse(jsonString); } catch { throw new Error('Archivo JSON inválido.'); }
    if (!data._version || !Array.isArray(data.bookmarks)) throw new Error('Formato de base de datos no reconocido.');

    db.transaction(() => {
      stmts.clearBm.run();
      stmts.clearFolders.run();
      stmts.clearImports.run();
      for (const bm of data.bookmarks) {
        stmts.insertBm.run({
          id: bm.id, title: bm.title || '', url: bm.url,
          url_norm: bm.urlNorm || bm.url.toLowerCase().replace(/\/+$/, ''),
          base_domain: bm.baseDomain || null, domain: bm.domain || null,
          folder: bm.folder || '', favicon: bm.favicon || null,
          add_date: bm.addDate || null, description: bm.description || null,
          source_file: bm.sourceFile || null, saved_at: bm.savedAt || Date.now(),
        });
      }
      for (const f of (data.folders || [])) stmts.insertFolder.run({ id: f.id, path: f.path || '', title: f.title || '' });
      for (const imp of (data.imports || [])) {
        stmts.insertImport.run({
          filename: imp.filename, importedAt: imp.importedAt || imp.imported_at,
          added: imp.added, skipped: imp.skipped, totalInFile: imp.totalInFile || imp.total_in_file || 0,
        });
      }
    })();

    return { bookmarks: data.bookmarks.length, imports: (data.imports || []).length };
  },
};
