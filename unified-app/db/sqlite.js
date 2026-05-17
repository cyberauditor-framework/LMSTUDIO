'use strict';

const { DatabaseSync } = require('node:sqlite');

function normalizeArgs(args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    return [args[0]];
  }
  return args;
}

function normalizeValue(value) {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : String(value);
  }
  return value;
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  const out = {};
  for (const [key, value] of Object.entries(result)) out[key] = normalizeValue(value);
  return out;
}

class CompatDatabase {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
  }

  pragma(statement) {
    this.db.exec(`PRAGMA ${statement}`);
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    const stmt = this.db.prepare(sql);
    return {
      run: (...args) => normalizeResult(stmt.run(...normalizeArgs(args))),
      get: (...args) => stmt.get(...normalizeArgs(args)),
      all: (...args) => stmt.all(...normalizeArgs(args)),
    };
  }

  transaction(fn) {
    return (...args) => {
      this.db.exec('BEGIN');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { this.db.exec('ROLLBACK'); } catch (_) {}
        throw error;
      }
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = CompatDatabase;