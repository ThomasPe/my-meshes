import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export type DatabaseConnection = BetterSqlite3.Database;

export const createDatabase = (databasePath: string): DatabaseConnection => {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new BetterSqlite3(databasePath);

  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS library_roots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'online',
      sync_state TEXT NOT NULL DEFAULT 'idle',
      error_message TEXT,
      last_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS library_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_id INTEGER NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      extension TEXT NOT NULL,
      project_folder TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'online',
      UNIQUE(root_id, relative_path)
    );
  `);

  return database;
};