import { mkdirSync, lstatSync, existsSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

/** Local OS-user storage, not encryption or a remotely enforceable ownership gate. */
export class LocalStore {
  constructor(home = process.env.CHOG_HOME || join(homedir(), '.chog')) {
    this.home = resolve(home);
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    if (lstatSync(this.home).isSymbolicLink()) throw Error('CHOG_HOME must not be a symbolic link.');
    const file = join(this.home, 'chog.db');
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw Error('The local database must not be a symbolic link.');
    this.db = new DatabaseSync(file);
    if (process.platform !== 'win32') { chmodSync(this.home, 0o700); chmodSync(file, 0o600); }
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);`);
  }
  get(key) { const row = this.db.prepare('SELECT value FROM state WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { if (value === null) this.db.prepare('DELETE FROM state WHERE key=?').run(key); else this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  saveLogin(login) { const previous = this.get('login'); this.set('login', login); if (previous?.address !== login.address) this.set('selection', null); }
  login() { const login = this.get('login'); if (!login || login.expiresAt <= Date.now()) throw Error('Run chog login first (local wallet proof expires after one hour).'); return login; }
  selection() { return this.get('selection'); }
  saveSelection(selection) { this.set('selection', selection); }
  advance(oldSelection, checkpoint) {
    const result = this.db.prepare('UPDATE state SET value=? WHERE key=? AND value=?').run(JSON.stringify({ ...oldSelection, checkpoint }), 'selection', JSON.stringify(oldSelection));
    if (!result.changes) throw Error('Selection changed in another process; try again.');
  }
  invalidate(selection) { this.db.prepare('DELETE FROM state WHERE key=? AND value=?').run('selection', JSON.stringify(selection)); }
  scope(selection) { return JSON.stringify([selection.address, selection.agentKey, selection.generation]); }
  add(selection, text) { this.db.prepare('INSERT INTO memory(scope,text,created_at) VALUES(?,?,?)').run(this.scope(selection), text, new Date().toISOString()); }
  memories(selection, all = false) { return this.db.prepare(`SELECT id,text,created_at AS createdAt FROM memory WHERE scope=? ORDER BY id DESC ${all ? '' : 'LIMIT 20'}`).all(this.scope(selection)).reverse(); }
  clearMemory(selection) { return { deleted: Number(this.db.prepare('DELETE FROM memory WHERE scope=?').run(this.scope(selection)).changes) }; }
  logout() { this.set('login', null); this.set('selection', null); }
  close() { this.db.close(); }
}
