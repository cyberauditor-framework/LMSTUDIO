/**
 * logs-db.js  —  SQLite persistence for LLM usage logs
 */
const Database = require('./sqlite');
const path     = require('path');
const fs       = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'llm-logs.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS llm_logs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    app              TEXT NOT NULL,
    model            TEXT,
    endpoint         TEXT,
    prompt_tokens    INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens     INTEGER DEFAULT 0,
    duration_ms      INTEGER,
    status           TEXT NOT NULL DEFAULT 'pending',
    error_message    TEXT,
    request_preview  TEXT,
    created_at       INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_app        ON llm_logs(app);
  CREATE INDEX IF NOT EXISTS idx_logs_created_at ON llm_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_logs_status     ON llm_logs(status);
`);

const stmts = {
  insert:   db.prepare(`
    INSERT INTO llm_logs (app, model, endpoint, prompt_tokens, completion_tokens, total_tokens,
                          duration_ms, status, error_message, request_preview, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  update:   db.prepare(`
    UPDATE llm_logs SET status = ?, duration_ms = ?, prompt_tokens = ?, completion_tokens = ?,
                        total_tokens = ?, error_message = ? WHERE id = ?
  `),
  getRecent: db.prepare(`SELECT * FROM llm_logs ORDER BY created_at DESC LIMIT ?`),
  stats:    db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) as pending,
      SUM(total_tokens) as total_tokens,
      AVG(CASE WHEN status='success' THEN duration_ms END) as avg_duration_ms,
      MIN(created_at) as first_request,
      MAX(created_at) as last_request
    FROM llm_logs
  `),
  statsByApp: db.prepare(`
    SELECT app,
           COUNT(*) as requests,
           SUM(total_tokens) as tokens,
           SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successful,
           SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors,
           AVG(CASE WHEN status='success' THEN duration_ms END) as avg_ms
    FROM llm_logs GROUP BY app
  `),
  clearOld: db.prepare(`DELETE FROM llm_logs WHERE created_at < ?`),
};

module.exports = {
  /** Create a pending log entry, returns the id */
  createLog(app, model, endpoint, requestPreview) {
    const result = stmts.insert.run(app, model, endpoint, 0, 0, 0, null, 'pending', null, requestPreview, Date.now());
    return result.lastInsertRowid;
  },

  /** Update log after response */
  updateLog(id, { status, duration_ms, prompt_tokens = 0, completion_tokens = 0, total_tokens = 0, error_message = null }) {
    stmts.update.run(status, duration_ms, prompt_tokens, completion_tokens, total_tokens, error_message, id);
  },

  getLogs(limit = 200) { return stmts.getRecent.all(limit); },
  getStats()    { return stmts.stats.get(); },
  getStatsByApp() { return stmts.statsByApp.all(); },

  /** Keep DB lean — remove entries older than 7 days */
  prune() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    stmts.clearOld.run(cutoff);
  },
};
