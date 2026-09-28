import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.mjs";
import { repairBlockedCompletions } from "./source-access.mjs";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const parse = (v, fallback = null) => (v ? JSON.parse(v) : fallback);
export function openDB(filename = path.join(config.dir, "fenext.sqlite")) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),display_name TEXT NOT NULL,avatar TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS material_icons(user_id TEXT NOT NULL REFERENCES users(id),material_key TEXT NOT NULL,emoji TEXT NOT NULL,PRIMARY KEY(user_id,material_key));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'session',label TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS extension_connections(user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL,browser TEXT NOT NULL,extension_id TEXT NOT NULL,version TEXT NOT NULL DEFAULT '',verified_at TEXT NOT NULL,PRIMARY KEY(user_id,token_hash,browser,extension_id));
    CREATE TABLE IF NOT EXISTS settings(user_id TEXT PRIMARY KEY REFERENCES users(id),endpoint TEXT NOT NULL,model TEXT NOT NULL,key_cipher TEXT NOT NULL,validated INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,title TEXT NOT NULL,input TEXT NOT NULL,question TEXT NOT NULL DEFAULT '',app TEXT NOT NULL,stage TEXT NOT NULL,checkpoint TEXT NOT NULL DEFAULT '{}',result TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER,next_at INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,fingerprint));
    CREATE TABLE IF NOT EXISTS receipts(user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),fingerprint TEXT NOT NULL,PRIMARY KEY(user_id,request_key));
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,aliases TEXT NOT NULL DEFAULT '[]',level TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',questions TEXT NOT NULL DEFAULT '[]',body TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes(id),user_id TEXT NOT NULL REFERENCES users(id),version INTEGER NOT NULL,body TEXT NOT NULL,reason TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(note_id,version));
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),note_id TEXT NOT NULL REFERENCES notes(id),task_id TEXT NOT NULL REFERENCES tasks(id),evidence TEXT NOT NULL,UNIQUE(note_id,task_id));
    CREATE TABLE IF NOT EXISTS suggestions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),note_id TEXT NOT NULL REFERENCES notes(id),task_id TEXT REFERENCES tasks(id),base_version INTEGER NOT NULL,items TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),note_id TEXT NOT NULL REFERENCES notes(id),role TEXT NOT NULL,text TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS imports(user_id TEXT NOT NULL REFERENCES users(id),source_key TEXT NOT NULL,note_id TEXT NOT NULL REFERENCES notes(id),PRIMARY KEY(user_id,source_key));
    CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(stage,next_at,lease_until);
    CREATE INDEX IF NOT EXISTS notes_user ON notes(user_id,updated_at);
    INSERT OR IGNORE INTO migrations VALUES(1,datetime('now'));`);
  tx(db, () => {
    if (!db.prepare("SELECT 1 FROM migrations WHERE version=2").get()) {
      repairBlockedCompletions(db);
      db.prepare("INSERT INTO migrations VALUES(2,?)").run(now());
    }
    if (!db.prepare("SELECT 1 FROM migrations WHERE version=3").get()) {
      const time = now();
      const sessions = db.prepare("SELECT * FROM sessions").all();
      db.exec(`CREATE TABLE sessions_next(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT,kind TEXT NOT NULL DEFAULT 'session',label TEXT NOT NULL DEFAULT '',created_at TEXT);
        `);
      const insert = db.prepare(
        "INSERT INTO sessions_next VALUES(?,?,?,?,?,?)",
      );
      for (const session of sessions) {
        const expires = Date.parse(session.expires_at);
        // Prior releases issued ingestion/session tokens for exactly 30/7 days.
        const created = Number.isFinite(expires)
          ? new Date(
              expires - (session.kind === "ingestion" ? 30 : 7) * 86400000,
            ).toISOString()
          : null;
        insert.run(
          session.token_hash,
          session.user_id,
          session.kind === "ingestion" && session.expires_at > time
            ? null
            : session.expires_at,
          session.kind,
          session.label,
          created,
        );
      }
      db.exec(
        "DROP TABLE sessions; ALTER TABLE sessions_next RENAME TO sessions;",
      );
      db.prepare("INSERT INTO migrations VALUES(3,?)").run(time);
    }
  });
  return db;
}
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function owned(db, table, rowId, userId) {
  if (!["tasks", "notes", "suggestions", "devices"].includes(table))
    throw new Error("Invalid table");
  const row = db
    .prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`)
    .get(rowId, userId);
  if (!row || (table === "tasks" && row.stage === "deleted")) {
    const e = new Error("内容不存在或无权访问");
    e.status = 404;
    throw e;
  }
  return row;
}
