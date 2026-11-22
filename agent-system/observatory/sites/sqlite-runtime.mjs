import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const journal = JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json', import.meta.url), 'utf8')).entries;
const readMigration = tag => readFileSync(new URL('./drizzle/' + tag + '.sql', import.meta.url), 'utf8');

export function applyMigrations(sqlite, { from = 0, to = journal.length } = {}) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const { tag } of journal.slice(from, to)) sqlite.exec(readMigration(tag));
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

export function sqliteBinding(sqlite) {
  return { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...args) => ({
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: statement.run(...args) }),
      }),
    };
  } };
}

export function openPartition(path) {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON');
  return { sqlite, DB: sqliteBinding(sqlite) };
}
