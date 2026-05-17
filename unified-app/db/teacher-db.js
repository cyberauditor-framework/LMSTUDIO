'use strict';

const Database = require('./sqlite');
const path     = require('path');
const fs       = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'teacher.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS content_packs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id     TEXT NOT NULL,
    pack_name      TEXT NOT NULL,
    level          TEXT NOT NULL DEFAULT '',
    session_number TEXT NOT NULL DEFAULT '',
    content_json   TEXT NOT NULL,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_packs_profile ON content_packs(profile_id);
  CREATE INDEX IF NOT EXISTS idx_packs_updated ON content_packs(updated_at DESC);

  CREATE TABLE IF NOT EXISTS session_states (
    id                         INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id                 TEXT NOT NULL,
    session_number             TEXT NOT NULL,
    cefr_level_estimate        TEXT,
    scores_json                TEXT NOT NULL DEFAULT '{}',
    recurring_errors_json      TEXT NOT NULL DEFAULT '[]',
    new_vocabulary_json        TEXT NOT NULL DEFAULT '[]',
    pronunciation_targets_json TEXT NOT NULL DEFAULT '[]',
    next_homework_json         TEXT NOT NULL DEFAULT '[]',
    raw_json                   TEXT NOT NULL DEFAULT '{}',
    created_at                 INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at                 INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    UNIQUE(profile_id, session_number)
  );

  CREATE INDEX IF NOT EXISTS idx_session_profile ON session_states(profile_id);
  CREATE INDEX IF NOT EXISTS idx_session_updated ON session_states(updated_at DESC);

  CREATE TABLE IF NOT EXISTS vocabulary_cards (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id     TEXT NOT NULL,
    session_number TEXT NOT NULL,
    term           TEXT NOT NULL,
    meaning_es     TEXT NOT NULL DEFAULT '',
    example_en     TEXT NOT NULL DEFAULT '',
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    UNIQUE(profile_id, session_number, term)
  );

  CREATE INDEX IF NOT EXISTS idx_vocab_profile ON vocabulary_cards(profile_id);
  CREATE INDEX IF NOT EXISTS idx_vocab_session ON vocabulary_cards(profile_id, session_number);
  CREATE INDEX IF NOT EXISTS idx_vocab_updated ON vocabulary_cards(updated_at DESC);

  CREATE TABLE IF NOT EXISTS irregular_verbs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT    NOT NULL,
    level       TEXT    NOT NULL DEFAULT 'B1',
    batch_name  TEXT    NOT NULL DEFAULT '',
    verbs_json  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_iverbs_profile ON irregular_verbs(profile_id);
  CREATE INDEX IF NOT EXISTS idx_iverbs_created ON irregular_verbs(created_at DESC);

  CREATE TABLE IF NOT EXISTS regular_verbs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT    NOT NULL,
    level       TEXT    NOT NULL DEFAULT 'B1',
    batch_name  TEXT    NOT NULL DEFAULT '',
    verbs_json  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_rverbs_profile ON regular_verbs(profile_id);
  CREATE INDEX IF NOT EXISTS idx_rverbs_created ON regular_verbs(created_at DESC);

  CREATE TABLE IF NOT EXISTS phrasal_verbs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT    NOT NULL,
    level       TEXT    NOT NULL DEFAULT 'B1',
    batch_name  TEXT    NOT NULL DEFAULT '',
    verbs_json  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_pverbs_profile ON phrasal_verbs(profile_id);
  CREATE INDEX IF NOT EXISTS idx_pverbs_created ON phrasal_verbs(created_at DESC);
`);

// Safe migrations — ignored if column already exists
try { db.exec(`ALTER TABLE regular_verbs ADD COLUMN category TEXT NOT NULL DEFAULT ''`); } catch (_) {}
try { db.exec(`ALTER TABLE phrasal_verbs ADD COLUMN category TEXT NOT NULL DEFAULT ''`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_rverbs_category ON regular_verbs(profile_id, category)`); } catch (_) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_pverbs_category ON phrasal_verbs(profile_id, category)`); } catch (_) {}

const stmts = {
  insertPack: db.prepare(`
    INSERT INTO content_packs (profile_id, pack_name, level, session_number, content_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  listPacks: db.prepare(`
    SELECT id, profile_id, pack_name, level, session_number, created_at, updated_at
    FROM content_packs WHERE profile_id = ?
    ORDER BY updated_at DESC, id DESC
  `),
  getPackById: db.prepare(`
    SELECT * FROM content_packs WHERE id = ? AND profile_id = ? LIMIT 1
  `),
  deletePacksByProfile: db.prepare(`DELETE FROM content_packs WHERE profile_id = ?`),

  upsertSessionState: db.prepare(`
    INSERT INTO session_states (
      profile_id, session_number, cefr_level_estimate,
      scores_json, recurring_errors_json, new_vocabulary_json,
      pronunciation_targets_json, next_homework_json, raw_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, session_number) DO UPDATE SET
      cefr_level_estimate        = excluded.cefr_level_estimate,
      scores_json                = excluded.scores_json,
      recurring_errors_json      = excluded.recurring_errors_json,
      new_vocabulary_json        = excluded.new_vocabulary_json,
      pronunciation_targets_json = excluded.pronunciation_targets_json,
      next_homework_json         = excluded.next_homework_json,
      raw_json                   = excluded.raw_json,
      updated_at                 = excluded.updated_at
  `),
  getSessionState: db.prepare(`
    SELECT * FROM session_states WHERE profile_id = ? AND session_number = ? LIMIT 1
  `),
  getLatestSessionState: db.prepare(`
    SELECT * FROM session_states WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1
  `),
  deleteSessionsByProfile: db.prepare(`DELETE FROM session_states WHERE profile_id = ?`),

  upsertVocabCard: db.prepare(`
    INSERT INTO vocabulary_cards (
      profile_id, session_number, term, meaning_es, example_en, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, session_number, term) DO UPDATE SET
      meaning_es = excluded.meaning_es,
      example_en = excluded.example_en,
      updated_at = excluded.updated_at
  `),
  listVocabBySession: db.prepare(`
    SELECT * FROM vocabulary_cards
    WHERE profile_id = ? AND session_number = ?
    ORDER BY term COLLATE NOCASE ASC
  `),
  listLatestVocab: db.prepare(`
    SELECT c.* FROM vocabulary_cards c
    JOIN (
      SELECT profile_id, session_number FROM vocabulary_cards
      WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1
    ) latest ON latest.profile_id = c.profile_id AND latest.session_number = c.session_number
    ORDER BY c.term COLLATE NOCASE ASC
  `),
  deleteVocabByProfile: db.prepare(`DELETE FROM vocabulary_cards WHERE profile_id = ?`),

  insertIrregularVerbBatch: db.prepare(`
    INSERT INTO irregular_verbs (profile_id, level, batch_name, verbs_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  listIrregularVerbBatches: db.prepare(`
    SELECT id, profile_id, level, batch_name, created_at
    FROM irregular_verbs WHERE profile_id = ?
    ORDER BY created_at DESC LIMIT 50
  `),
  getIrregularVerbBatch: db.prepare(`
    SELECT * FROM irregular_verbs WHERE id = ? AND profile_id = ? LIMIT 1
  `),
  getLatestIrregularVerbBatch: db.prepare(`
    SELECT * FROM irregular_verbs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1
  `),
  deleteIrregularVerbsByProfile: db.prepare(`DELETE FROM irregular_verbs WHERE profile_id = ?`),

  insertRegularVerbBatch: db.prepare(`
    INSERT INTO regular_verbs (profile_id, level, batch_name, category, verbs_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listRegularVerbBatches: db.prepare(`
    SELECT id, profile_id, level, batch_name, category, created_at
    FROM regular_verbs WHERE profile_id = ?
    ORDER BY created_at DESC LIMIT 100
  `),
  getRegularVerbBatch: db.prepare(`
    SELECT * FROM regular_verbs WHERE id = ? AND profile_id = ? LIMIT 1
  `),
  getLatestRegularVerbBatch: db.prepare(`
    SELECT * FROM regular_verbs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1
  `),
  deleteRegularVerbsByProfile: db.prepare(`DELETE FROM regular_verbs WHERE profile_id = ?`),

  insertPhrasalVerbBatch: db.prepare(`
    INSERT INTO phrasal_verbs (profile_id, level, batch_name, category, verbs_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listPhrasalVerbBatches: db.prepare(`
    SELECT id, profile_id, level, batch_name, category, created_at
    FROM phrasal_verbs WHERE profile_id = ?
    ORDER BY created_at DESC LIMIT 100
  `),
  getPhrasalVerbBatch: db.prepare(`
    SELECT * FROM phrasal_verbs WHERE id = ? AND profile_id = ? LIMIT 1
  `),
  getLatestPhrasalVerbBatch: db.prepare(`
    SELECT * FROM phrasal_verbs WHERE profile_id = ? ORDER BY created_at DESC LIMIT 1
  `),
  deletePhrasalVerbsByProfile: db.prepare(`DELETE FROM phrasal_verbs WHERE profile_id = ?`),
};

function now() { return Date.now(); }

function asJson(v, fallback) {
  try { return JSON.stringify(v == null ? fallback : v); } catch (_) { return JSON.stringify(fallback); }
}

function safeParseJson(v, fallback) {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  try { const p = JSON.parse(v); return p == null ? fallback : p; } catch (_) { return fallback; }
}

function mapPackRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    packName: row.pack_name || '',
    level: row.level || '',
    sessionNumber: row.session_number || '',
    content: safeParseJson(row.content_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    profileId: row.profile_id,
    sessionNumber: row.session_number,
    cefrLevelEstimate: row.cefr_level_estimate || '',
    scores: safeParseJson(row.scores_json, {}),
    recurringErrors: safeParseJson(row.recurring_errors_json, []),
    newVocabulary: safeParseJson(row.new_vocabulary_json, []),
    pronunciationTargets: safeParseJson(row.pronunciation_targets_json, []),
    nextHomework: safeParseJson(row.next_homework_json, []),
    raw: safeParseJson(row.raw_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVocabRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    sessionNumber: row.session_number,
    term: row.term,
    meaningES: row.meaning_es || '',
    exampleEN: row.example_en || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  // ── Content packs ─────────────────────────────────────────────────────────────
  saveContentPack(profileId, packName, level, sessionNumber, content) {
    const pid  = String(profileId  || '').trim();
    const name = String(packName   || '').trim();
    const lvl  = String(level      || '').trim();
    const snum = String(sessionNumber || '').trim();
    if (!pid)  throw new Error('profileId is required');
    if (!name) throw new Error('packName is required');
    if (!content || typeof content !== 'object') throw new Error('content object is required');
    const ts = now();
    const result = stmts.insertPack.run(pid, name, lvl, snum, asJson(content, {}), ts, ts);
    return this.getContentPackById(result.lastInsertRowid, pid);
  },

  listContentPacks(profileId) {
    const rows = stmts.listPacks.all(String(profileId || '').trim());
    return rows.map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      packName: r.pack_name || '',
      level: r.level || '',
      sessionNumber: r.session_number || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  getContentPackById(id, profileId) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId)) return null;
    const row = stmts.getPackById.get(safeId, String(profileId || '').trim());
    return mapPackRow(row);
  },

  // ── Session state ─────────────────────────────────────────────────────────────
  upsertSessionState(input) {
    const data = input && typeof input === 'object' ? input : {};
    const profileId = String(data.profileId || '').trim();
    const sessionNumber = String(data.sessionNumber || '').trim();
    if (!profileId || !sessionNumber) throw new Error('profileId and sessionNumber are required');

    const ts = now();
    stmts.upsertSessionState.run(
      profileId,
      sessionNumber,
      String(data.cefrLevelEstimate || '').trim(),
      asJson(data.scores && typeof data.scores === 'object' ? data.scores : {}, {}),
      asJson(Array.isArray(data.recurringErrors) ? data.recurringErrors : [], []),
      asJson(Array.isArray(data.newVocabulary) ? data.newVocabulary : [], []),
      asJson(Array.isArray(data.pronunciationTargets) ? data.pronunciationTargets : [], []),
      asJson(Array.isArray(data.nextHomework) ? data.nextHomework : [], []),
      asJson(data, {}),
      ts, ts,
    );
    return this.getSessionState(profileId, sessionNumber);
  },

  getSessionState(profileId, sessionNumber) {
    const row = stmts.getSessionState.get(
      String(profileId || '').trim(),
      String(sessionNumber || '').trim(),
    );
    return mapSessionRow(row);
  },

  getLatestSessionState(profileId) {
    const row = stmts.getLatestSessionState.get(String(profileId || '').trim());
    return mapSessionRow(row);
  },

  // ── Vocabulary cards ──────────────────────────────────────────────────────────
  upsertVocabularyCards(profileId, sessionNumber, cards) {
    const pid  = String(profileId    || '').trim();
    const snum = String(sessionNumber || '').trim();
    if (!pid || !snum) throw new Error('profileId and sessionNumber are required');
    if (!Array.isArray(cards) || !cards.length) return { saved: 0, cards: [] };

    const ts = now();
    let saved = 0;
    const tx = db.transaction((items) => {
      for (const c of items) {
        const term = String(c?.term || '').trim();
        if (!term) continue;
        stmts.upsertVocabCard.run(
          pid, snum, term,
          String(c?.meaningES || c?.meaning_es || '').trim(),
          String(c?.exampleEN || c?.example_en || '').trim(),
          ts, ts,
        );
        saved++;
      }
    });
    tx(cards);
    return { saved, cards: this.getVocabularyCards(pid, snum) };
  },

  getVocabularyCards(profileId, sessionNumber) {
    const rows = stmts.listVocabBySession.all(
      String(profileId    || '').trim(),
      String(sessionNumber || '').trim(),
    );
    return rows.map(mapVocabRow).filter(Boolean);
  },

  getLatestVocabularyCards(profileId) {
    const rows = stmts.listLatestVocab.all(String(profileId || '').trim());
    return rows.map(mapVocabRow).filter(Boolean);
  },

  // ── Irregular verbs ───────────────────────────────────────────────────────────
  getAllIrregularVerbs(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare('SELECT verbs_json FROM irregular_verbs WHERE profile_id = ? ORDER BY created_at DESC').all(pid);
    const seen = new Set();
    const all  = [];
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) {
        if (!v || !v.base_form) continue;
        const key = String(v.base_form).toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); all.push(v); }
      }
    }
    return all.sort((a, b) => String(a.base_form).localeCompare(String(b.base_form)));
  },

  getExistingVerbBaseforms(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare('SELECT verbs_json FROM irregular_verbs WHERE profile_id = ?').all(pid);
    const seen = new Set();
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) {
        if (v && v.base_form) seen.add(String(v.base_form).toLowerCase().trim());
      }
    }
    return [...seen];
  },

  saveIrregularVerbs(profileId, level, batchName, verbs, force = false) {
    const pid  = String(profileId || '').trim();
    const lvl  = String(level     || 'B1').trim();
    const name = String(batchName || '').trim();
    if (!pid)                                   throw new Error('profileId is required');
    if (!Array.isArray(verbs) || !verbs.length) throw new Error('verbs array is required');

    const existing = new Set(this.getExistingVerbBaseforms(pid));
    const toSave   = force
      ? verbs.filter((v) => v && v.base_form)
      : verbs.filter((v) => v && v.base_form && !existing.has(String(v.base_form).toLowerCase().trim()));
    if (!toSave.length) throw new Error('all_duplicates');

    const ts     = now();
    const result = stmts.insertIrregularVerbBatch.run(pid, lvl, name, asJson(toSave, []), ts);
    return this.getIrregularVerbBatch(result.lastInsertRowid, pid);
  },

  listIrregularVerbBatches(profileId) {
    return stmts.listIrregularVerbBatches.all(String(profileId || '').trim()).map((r) => ({
      id:        r.id,
      profileId: r.profile_id,
      level:     r.level     || '',
      batchName: r.batch_name || '',
      createdAt: r.created_at,
    }));
  },

  getIrregularVerbBatch(id, profileId) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId)) return null;
    const row = stmts.getIrregularVerbBatch.get(safeId, String(profileId || '').trim());
    if (!row) return null;
    return {
      id:        row.id,
      profileId: row.profile_id,
      level:     row.level      || '',
      batchName: row.batch_name || '',
      verbs:     safeParseJson(row.verbs_json, []),
      createdAt: row.created_at,
    };
  },

  getLatestIrregularVerbBatch(profileId) {
    const row = stmts.getLatestIrregularVerbBatch.get(String(profileId || '').trim());
    if (!row) return null;
    return {
      id:        row.id,
      profileId: row.profile_id,
      level:     row.level      || '',
      batchName: row.batch_name || '',
      verbs:     safeParseJson(row.verbs_json, []),
      createdAt: row.created_at,
    };
  },

  // ── Regular verbs ─────────────────────────────────────────────────────────────
  getAllRegularVerbs(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare('SELECT verbs_json FROM regular_verbs WHERE profile_id = ? ORDER BY created_at DESC').all(pid);
    const seen = new Set();
    const all  = [];
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) {
        if (!v || !v.base_form) continue;
        const key = String(v.base_form).toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); all.push(v); }
      }
    }
    return all.sort((a, b) => String(a.base_form).localeCompare(String(b.base_form)));
  },

  getExistingRegularVerbBaseforms(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare('SELECT verbs_json FROM regular_verbs WHERE profile_id = ?').all(pid);
    const seen = new Set();
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) {
        if (v && v.base_form) seen.add(String(v.base_form).toLowerCase().trim());
      }
    }
    return [...seen];
  },

  saveRegularVerbs(profileId, level, category, batchName, verbs, force = false) {
    const pid  = String(profileId || '').trim();
    const lvl  = String(level     || 'B1').trim();
    const cat  = String(category  || '').trim();
    const name = String(batchName || '').trim();
    if (!pid)                                   throw new Error('profileId is required');
    if (!Array.isArray(verbs) || !verbs.length) throw new Error('verbs array is required');

    const existing = new Set(this.getExistingRegularVerbBaseforms(pid));
    const toSave   = force
      ? verbs.filter((v) => v && v.base_form)
      : verbs.filter((v) => v && v.base_form && !existing.has(String(v.base_form).toLowerCase().trim()));
    if (!toSave.length) throw new Error('all_duplicates');

    const ts     = now();
    const result = stmts.insertRegularVerbBatch.run(pid, lvl, name, cat, asJson(toSave, []), ts);
    return this.getRegularVerbBatch(result.lastInsertRowid, pid);
  },

  listRegularVerbBatches(profileId) {
    return stmts.listRegularVerbBatches.all(String(profileId || '').trim()).map((r) => ({
      id:        r.id,
      profileId: r.profile_id,
      level:     r.level      || '',
      category:  r.category   || '',
      batchName: r.batch_name || '',
      createdAt: r.created_at,
    }));
  },

  getRegularVerbBatch(id, profileId) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId)) return null;
    const row = stmts.getRegularVerbBatch.get(safeId, String(profileId || '').trim());
    if (!row) return null;
    return {
      id:        row.id,
      profileId: row.profile_id,
      level:     row.level      || '',
      category:  row.category   || '',
      batchName: row.batch_name || '',
      verbs:     safeParseJson(row.verbs_json, []),
      createdAt: row.created_at,
    };
  },

  getLatestRegularVerbBatch(profileId) {
    const row = stmts.getLatestRegularVerbBatch.get(String(profileId || '').trim());
    if (!row) return null;
    return {
      id:        row.id,
      profileId: row.profile_id,
      level:     row.level      || '',
      category:  row.category   || '',
      batchName: row.batch_name || '',
      verbs:     safeParseJson(row.verbs_json, []),
      createdAt: row.created_at,
    };
  },

  getRegularVerbBaseformsByCategory(profileId, category) {
    const pid = String(profileId || '').trim();
    const cat = String(category  || '').trim();
    const rows = db.prepare(`SELECT verbs_json FROM regular_verbs WHERE profile_id = ? AND category = ? ORDER BY created_at DESC LIMIT 20`).all(pid, cat);
    const seen = new Set();
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) { if (v && v.base_form) seen.add(String(v.base_form).toLowerCase().trim()); }
    }
    return [...seen];
  },

  getRegularVerbCategoryStats(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare(`SELECT category, level, verbs_json FROM regular_verbs WHERE profile_id = ?`).all(pid);
    const stats = {};
    for (const row of rows) {
      const key = `${row.category || ''}|||${row.level || ''}`;
      const verbs = safeParseJson(row.verbs_json, []);
      stats[key] = (stats[key] || 0) + verbs.length;
    }
    return stats;
  },

  // ── Phrasal verbs ─────────────────────────────────────────────────────────────
  getAllPhrasalVerbs(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare('SELECT verbs_json FROM phrasal_verbs WHERE profile_id = ? ORDER BY created_at DESC').all(pid);
    const seen = new Set();
    const all  = [];
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) {
        if (!v || !v.base_form) continue;
        const key = String(v.base_form).toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); all.push(v); }
      }
    }
    return all.sort((a, b) => String(a.base_form).localeCompare(String(b.base_form)));
  },

  getExistingPhrasalVerbBaseforms(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare('SELECT verbs_json FROM phrasal_verbs WHERE profile_id = ?').all(pid);
    const seen = new Set();
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) {
        if (v && v.base_form) seen.add(String(v.base_form).toLowerCase().trim());
      }
    }
    return [...seen];
  },

  savePhrasalVerbs(profileId, level, category, batchName, verbs, force = false) {
    const pid  = String(profileId || '').trim();
    const lvl  = String(level     || 'B1').trim();
    const cat  = String(category  || '').trim();
    const name = String(batchName || '').trim();
    if (!pid)                                   throw new Error('profileId is required');
    if (!Array.isArray(verbs) || !verbs.length) throw new Error('verbs array is required');

    const existing = new Set(this.getExistingPhrasalVerbBaseforms(pid));
    const toSave   = force
      ? verbs.filter((v) => v && v.base_form)
      : verbs.filter((v) => v && v.base_form && !existing.has(String(v.base_form).toLowerCase().trim()));
    if (!toSave.length) throw new Error('all_duplicates');

    const ts     = now();
    const result = stmts.insertPhrasalVerbBatch.run(pid, lvl, name, cat, asJson(toSave, []), ts);
    return this.getPhrasalVerbBatch(result.lastInsertRowid, pid);
  },

  listPhrasalVerbBatches(profileId) {
    return stmts.listPhrasalVerbBatches.all(String(profileId || '').trim()).map((r) => ({
      id:        r.id,
      profileId: r.profile_id,
      level:     r.level      || '',
      category:  r.category   || '',
      batchName: r.batch_name || '',
      createdAt: r.created_at,
    }));
  },

  getPhrasalVerbBatch(id, profileId) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId)) return null;
    const row = stmts.getPhrasalVerbBatch.get(safeId, String(profileId || '').trim());
    if (!row) return null;
    return {
      id:        row.id,
      profileId: row.profile_id,
      level:     row.level      || '',
      category:  row.category   || '',
      batchName: row.batch_name || '',
      verbs:     safeParseJson(row.verbs_json, []),
      createdAt: row.created_at,
    };
  },

  getLatestPhrasalVerbBatch(profileId) {
    const row = stmts.getLatestPhrasalVerbBatch.get(String(profileId || '').trim());
    if (!row) return null;
    return {
      id:        row.id,
      profileId: row.profile_id,
      level:     row.level      || '',
      category:  row.category   || '',
      batchName: row.batch_name || '',
      verbs:     safeParseJson(row.verbs_json, []),
      createdAt: row.created_at,
    };
  },

  getPhrasalVerbBaseformsByCategory(profileId, category) {
    const pid = String(profileId || '').trim();
    const cat = String(category  || '').trim();
    const rows = db.prepare(`SELECT verbs_json FROM phrasal_verbs WHERE profile_id = ? AND category = ? ORDER BY created_at DESC LIMIT 20`).all(pid, cat);
    const seen = new Set();
    for (const row of rows) {
      const verbs = safeParseJson(row.verbs_json, []);
      for (const v of verbs) { if (v && v.base_form) seen.add(String(v.base_form).toLowerCase().trim()); }
    }
    return [...seen];
  },

  getPhrasalVerbCategoryStats(profileId) {
    const pid  = String(profileId || '').trim();
    const rows = db.prepare(`SELECT category, level, verbs_json FROM phrasal_verbs WHERE profile_id = ?`).all(pid);
    const stats = {};
    for (const row of rows) {
      const key = `${row.category || ''}|||${row.level || ''}`;
      const verbs = safeParseJson(row.verbs_json, []);
      stats[key] = (stats[key] || 0) + verbs.length;
    }
    return stats;
  },

  // ── Maintenance ───────────────────────────────────────────────────────────────
  clearAllData(profileId) {
    const pid = String(profileId || '').trim();
    if (!pid) throw new Error('profileId is required');
    const tx = db.transaction((p) => {
      const packs    = stmts.deletePacksByProfile.run(p).changes;
      const sessions = stmts.deleteSessionsByProfile.run(p).changes;
      const cards    = stmts.deleteVocabByProfile.run(p).changes;
      const iverbs   = stmts.deleteIrregularVerbsByProfile.run(p).changes;
      const rverbs   = stmts.deleteRegularVerbsByProfile.run(p).changes;
      const pverbs   = stmts.deletePhrasalVerbsByProfile.run(p).changes;
      return { packs, sessions, cards, verbs: iverbs + rverbs + pverbs, total: packs + sessions + cards + iverbs + rverbs + pverbs };
    });
    return tx(pid);
  },
};
