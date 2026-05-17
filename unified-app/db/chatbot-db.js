/**
 * chatbot-db.js  —  SQLite persistence for English Chatbot
 */
const Database = require('./sqlite');
const path     = require('path');
const fs       = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'chatbot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL DEFAULT 'New Conversation',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content_raw     TEXT NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS phrase_bank_v2 (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
    session_id      TEXT,
    category        TEXT NOT NULL,
    phrase_en       TEXT NOT NULL,
    phrase_es       TEXT NOT NULL,
    style           TEXT NOT NULL DEFAULT '',
    source          TEXT NOT NULL DEFAULT 'llm',
    times_seen      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    UNIQUE(category, phrase_en, style)
  );

  CREATE INDEX IF NOT EXISTS idx_phrase_v2_category ON phrase_bank_v2(category);
  CREATE INDEX IF NOT EXISTS idx_phrase_v2_updated  ON phrase_bank_v2(updated_at DESC);

  CREATE TABLE IF NOT EXISTS session_states (
    id                            INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id                    TEXT NOT NULL,
    session_number                TEXT NOT NULL,
    cefr_level_estimate           TEXT,
    scores_json                   TEXT NOT NULL DEFAULT '{}',
    recurring_errors_json         TEXT NOT NULL DEFAULT '[]',
    new_vocabulary_json           TEXT NOT NULL DEFAULT '[]',
    pronunciation_targets_json    TEXT NOT NULL DEFAULT '[]',
    next_homework_json            TEXT NOT NULL DEFAULT '[]',
    raw_json                      TEXT NOT NULL DEFAULT '{}',
    created_at                    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at                    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    UNIQUE(profile_id, session_number)
  );

  CREATE INDEX IF NOT EXISTS idx_session_states_profile ON session_states(profile_id);
  CREATE INDEX IF NOT EXISTS idx_session_states_updated ON session_states(updated_at DESC);

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

  CREATE INDEX IF NOT EXISTS idx_vocab_cards_profile ON vocabulary_cards(profile_id);
  CREATE INDEX IF NOT EXISTS idx_vocab_cards_session ON vocabulary_cards(profile_id, session_number);
  CREATE INDEX IF NOT EXISTS idx_vocab_cards_updated ON vocabulary_cards(updated_at DESC);

`);

// Add times_seen column to existing DBs that predate this schema (must run before the index)
try {
  db.exec(`ALTER TABLE phrase_bank_v2 ADD COLUMN times_seen INTEGER NOT NULL DEFAULT 0`);
} catch (_) { /* column already exists — safe to ignore */ }

// Create the index on times_seen only after the column is guaranteed to exist
db.exec(`CREATE INDEX IF NOT EXISTS idx_phrase_v2_seen ON phrase_bank_v2(times_seen DESC)`);

const stmts = {
  listConversations: db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC'),
  getConversation:   db.prepare('SELECT * FROM conversations WHERE id = ?'),
  createConversation: db.prepare('INSERT INTO conversations (title, created_at, updated_at) VALUES (?, ?, ?)'),
  updateTitle:       db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?'),
  touchConversation: db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?'),
  deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
  getMessages:       db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'),
  addMessage:        db.prepare('INSERT INTO messages (conversation_id, role, content_raw, created_at) VALUES (?, ?, ?, ?)'),

  upsertPhrase: db.prepare(`
    INSERT INTO phrase_bank_v2 (conversation_id, session_id, category, phrase_en, phrase_es, style, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(category, phrase_en, style) DO UPDATE SET
      phrase_es = excluded.phrase_es,
      conversation_id = excluded.conversation_id,
      session_id = excluded.session_id,
      source = excluded.source,
      updated_at = excluded.updated_at
  `),
  listPhrases: db.prepare('SELECT * FROM phrase_bank_v2 ORDER BY updated_at DESC, id DESC'),
  listPhrasesByCategory: db.prepare('SELECT * FROM phrase_bank_v2 WHERE category = ? ORDER BY updated_at DESC, id DESC'),
  phraseStats: db.prepare(`
    SELECT category, COUNT(*) AS total, SUM(times_seen) AS total_seen
    FROM phrase_bank_v2
    GROUP BY category
    ORDER BY total DESC, category ASC
  `),
  // RAG: fetch phrases matching any of the given keywords in phrase_en or category
  // Called dynamically — built per query (see searchContextPhrases below)

  // increment times_seen by id list
  incrementSeen: db.prepare(`
    UPDATE phrase_bank_v2 SET times_seen = times_seen + 1 WHERE id = ?
  `),

  // spaced-repetition: least-seen phrases first (for review endpoint)
  leastSeenPhrases: db.prepare(`
    SELECT * FROM phrase_bank_v2
    ORDER BY times_seen ASC, updated_at DESC
    LIMIT ?
  `),

  upsertSessionState: db.prepare(`
    INSERT INTO session_states (
      profile_id,
      session_number,
      cefr_level_estimate,
      scores_json,
      recurring_errors_json,
      new_vocabulary_json,
      pronunciation_targets_json,
      next_homework_json,
      raw_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, session_number) DO UPDATE SET
      cefr_level_estimate = excluded.cefr_level_estimate,
      scores_json = excluded.scores_json,
      recurring_errors_json = excluded.recurring_errors_json,
      new_vocabulary_json = excluded.new_vocabulary_json,
      pronunciation_targets_json = excluded.pronunciation_targets_json,
      next_homework_json = excluded.next_homework_json,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `),
  getSessionState: db.prepare(`
    SELECT * FROM session_states
    WHERE profile_id = ? AND session_number = ?
    LIMIT 1
  `),
  getLatestSessionState: db.prepare(`
    SELECT * FROM session_states
    WHERE profile_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `),

  upsertVocabularyCard: db.prepare(`
    INSERT INTO vocabulary_cards (
      profile_id,
      session_number,
      term,
      meaning_es,
      example_en,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id, session_number, term) DO UPDATE SET
      meaning_es = excluded.meaning_es,
      example_en = excluded.example_en,
      updated_at = excluded.updated_at
  `),
  listVocabularyCardsBySession: db.prepare(`
    SELECT * FROM vocabulary_cards
    WHERE profile_id = ? AND session_number = ?
    ORDER BY term COLLATE NOCASE ASC
  `),
  listLatestVocabularyCards: db.prepare(`
    SELECT c.*
    FROM vocabulary_cards c
    JOIN (
      SELECT profile_id, session_number
      FROM vocabulary_cards
      WHERE profile_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    ) latest
      ON latest.profile_id = c.profile_id
     AND latest.session_number = c.session_number
    ORDER BY c.term COLLATE NOCASE ASC
  `),

};

function now() { return Date.now(); }

function asJson(value, fallback) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch (_) {
    return JSON.stringify(fallback);
  }
}

function safeParseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function mapSessionStateRow(row) {
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

function mapVocabularyCardRow(row) {
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

function smartTitle(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) + '…' : cut + '…';
}

module.exports = {
  listConversations() { return stmts.listConversations.all(); },
  getConversation(id) { return stmts.getConversation.get(id); },
  createConversation(title = 'New Conversation') {
    const ts = now();
    const result = stmts.createConversation.run(title, ts, ts);
    return { id: result.lastInsertRowid, title, created_at: ts, updated_at: ts };
  },
  updateTitle(id, text) {
    const title = smartTitle(text);
    stmts.updateTitle.run(title, now(), id);
    return title;
  },
  deleteConversation(id) { stmts.deleteConversation.run(id); },
  getMessages(conversationId) { return stmts.getMessages.all(conversationId); },
  addMessage(conversationId, role, contentRaw) {
    const ts = now();
    const result = stmts.addMessage.run(conversationId, role, contentRaw, ts);
    stmts.touchConversation.run(ts, conversationId);
    return { id: result.lastInsertRowid, conversation_id: conversationId, role, content_raw: contentRaw, created_at: ts };
  },

  upsertPhrases(conversationId, sessionId, phrases, source = 'llm') {
    if (!Array.isArray(phrases) || phrases.length === 0) return { saved: 0 };
    const ts = now();
    let saved = 0;
    const tx = db.transaction(items => {
      for (const p of items) {
        if (!p?.category || !p?.phrase_en || !p?.phrase_es) continue;
        const category = String(p.category).trim().slice(0, 80);
        const en = String(p.phrase_en).trim();
        const es = String(p.phrase_es).trim();
        const style = p.style ? String(p.style).trim().slice(0, 30) : '';
        if (!category || !en || !es) continue;
        stmts.upsertPhrase.run(conversationId, sessionId || null, category, en, es, style, String(source || 'llm').trim().slice(0, 20) || 'llm', ts, ts);
        saved++;
      }
    });
    tx(phrases);
    return { saved };
  },

  listPhrases(category) {
    if (category) return stmts.listPhrasesByCategory.all(category);
    return stmts.listPhrases.all();
  },

  getPhraseStats() {
    return stmts.phraseStats.all();
  },

  /**
   * RAG Tier 1 — Topic-matched phrases.
   * Searches phrase_en, phrase_es (for Spanish input) AND category.
   * Filters to phrases ≤ 160 chars so full-sentence Fast_Improver entries
   * don't waste token budget. Ranked by times_seen DESC, then most-recent.
   */
  searchContextPhrases(keywords, limit = 5) {
    if (!Array.isArray(keywords) || keywords.length === 0) return [];
    const safe = keywords
      .map(k => String(k).trim().toLowerCase())
      .filter(k => k.length > 2)
      .slice(0, 8);
    if (safe.length === 0) return [];

    // Search EN text, ES text, and category so Spanish input also gets matches
    const conditions = safe.map(() =>
      '(LOWER(phrase_en) LIKE ? OR LOWER(phrase_es) LIKE ? OR LOWER(category) LIKE ?)'
    ).join(' OR ');
    const params = safe.flatMap(k => [`%${k}%`, `%${k}%`, `%${k}%`]);

    const sql = `
      SELECT id, category, phrase_en, phrase_es, style, times_seen
      FROM phrase_bank_v2
      WHERE LENGTH(phrase_en) <= 160
        AND (${conditions})
      ORDER BY times_seen DESC, updated_at DESC
      LIMIT ?
    `;
    return db.prepare(sql).all(...params, limit);
  },

  /**
   * RAG Tier 2 — Core vocabulary anchor.
   * Returns top N most-practiced phrases not already in excludeIds.
   * Falls back to most-recently added when times_seen = 0 (fresh DB),
   * so Tier 2 is always populated once the bank has any entries.
   * Also filters to phrases ≤ 160 chars.
   */
  getMostPracticedPhrases(excludeIds = [], limit = 3) {
    const lenFilter = 'LENGTH(phrase_en) <= 160';
    if (excludeIds.length === 0) {
      return db.prepare(`
        SELECT id, category, phrase_en, phrase_es, style, times_seen
        FROM phrase_bank_v2
        WHERE ${lenFilter}
        ORDER BY times_seen DESC, updated_at DESC
        LIMIT ?
      `).all(limit);
    }
    const placeholders = excludeIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT id, category, phrase_en, phrase_es, style, times_seen
      FROM phrase_bank_v2
      WHERE ${lenFilter} AND id NOT IN (${placeholders})
      ORDER BY times_seen DESC, updated_at DESC
      LIMIT ?
    `).all(...excludeIds, limit);
  },

  /**
   * RAG Tier 3 — Bank summary stats (compact, for LLM awareness).
   * Returns total phrase count + per-category breakdown.
   */
  getBankSummary() {
    const total = db.prepare('SELECT COUNT(*) AS n FROM phrase_bank_v2').get()?.n || 0;
    if (total === 0) return null;
    const cats = db.prepare(`
      SELECT category, COUNT(*) AS n
      FROM phrase_bank_v2
      GROUP BY category
      ORDER BY n DESC
      LIMIT 8
    `).all();
    return { total, categories: cats };
  },

  /**
   * Mark a list of phrase IDs as "seen" in this turn.
   * Called after RAG context phrases are injected into the prompt.
   */
  markPhrasesAsSeen(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const tx = db.transaction(list => {
      for (const id of list) stmts.incrementSeen.run(id);
    });
    tx(ids);
  },

  /**
   * Spaced-repetition review: returns phrases the user has seen the least.
   */
  getLeastSeenPhrases(limit = 10) {
    return stmts.leastSeenPhrases.all(limit);
  },

  upsertSessionState(sessionState) {
    const input = sessionState && typeof sessionState === 'object' ? sessionState : {};
    const profileId = String(input.profileId || '').trim();
    const sessionNumber = String(input.sessionNumber || '').trim();
    if (!profileId || !sessionNumber) {
      throw new Error('profileId and sessionNumber are required');
    }

    const record = {
      profileId,
      sessionNumber,
      cefrLevelEstimate: String(input.cefrLevelEstimate || '').trim(),
      scores: input.scores && typeof input.scores === 'object' ? input.scores : {},
      recurringErrors: Array.isArray(input.recurringErrors) ? input.recurringErrors : [],
      newVocabulary: Array.isArray(input.newVocabulary) ? input.newVocabulary : [],
      pronunciationTargets: Array.isArray(input.pronunciationTargets) ? input.pronunciationTargets : [],
      nextHomework: Array.isArray(input.nextHomework) ? input.nextHomework : [],
    };

    const ts = now();
    stmts.upsertSessionState.run(
      record.profileId,
      record.sessionNumber,
      record.cefrLevelEstimate,
      asJson(record.scores, {}),
      asJson(record.recurringErrors, []),
      asJson(record.newVocabulary, []),
      asJson(record.pronunciationTargets, []),
      asJson(record.nextHomework, []),
      asJson(input, {}),
      ts,
      ts,
    );

    return this.getSessionState(record.profileId, record.sessionNumber);
  },

  getSessionState(profileId, sessionNumber) {
    const row = stmts.getSessionState.get(String(profileId || '').trim(), String(sessionNumber || '').trim());
    return mapSessionStateRow(row);
  },

  getLatestSessionState(profileId) {
    const row = stmts.getLatestSessionState.get(String(profileId || '').trim());
    return mapSessionStateRow(row);
  },

  upsertVocabularyCards(profileId, sessionNumber, cards) {
    const safeProfileId = String(profileId || '').trim();
    const safeSessionNumber = String(sessionNumber || '').trim();
    if (!safeProfileId || !safeSessionNumber) {
      throw new Error('profileId and sessionNumber are required');
    }
    if (!Array.isArray(cards) || cards.length === 0) {
      return { saved: 0, cards: [] };
    }

    const ts = now();
    let saved = 0;
    const tx = db.transaction(items => {
      for (const c of items) {
        const term = String(c?.term || '').trim();
        const meaningES = String(c?.meaningES || c?.meaning_es || '').trim();
        const exampleEN = String(c?.exampleEN || c?.example_en || '').trim();
        if (!term) continue;
        stmts.upsertVocabularyCard.run(
          safeProfileId,
          safeSessionNumber,
          term,
          meaningES,
          exampleEN,
          ts,
          ts,
        );
        saved++;
      }
    });
    tx(cards);

    return {
      saved,
      cards: this.getVocabularyCards(safeProfileId, safeSessionNumber),
    };
  },

  getVocabularyCards(profileId, sessionNumber) {
    const rows = stmts.listVocabularyCardsBySession.all(
      String(profileId || '').trim(),
      String(sessionNumber || '').trim(),
    );
    return rows.map(mapVocabularyCardRow).filter(Boolean);
  },

  getLatestVocabularyCards(profileId) {
    const rows = stmts.listLatestVocabularyCards.all(String(profileId || '').trim());
    return rows.map(mapVocabularyCardRow).filter(Boolean);
  },

};
