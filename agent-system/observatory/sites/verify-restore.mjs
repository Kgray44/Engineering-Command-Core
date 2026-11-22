import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { applicationId, repositoryName } from './application-config.mjs';
import { applyMigrations, journal } from './sqlite-runtime.mjs';

const schema = db => db.prepare(
  "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE substr(name, 1, 7) <> 'sqlite_' ORDER BY type, name",
).all();
const quoteIdentifier = name => '"' + name.replaceAll('"', '""') + '"';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function currentObjects() {
  const db = new DatabaseSync(':memory:');
  try {
    applyMigrations(db);
    return schema(db).map(({ type, name, tbl_name }) => JSON.stringify([type, name, tbl_name]));
  } finally {
    db.close();
  }
}

function tableEvidence(db, name) {
  const table = quoteIdentifier(name);
  const columns = db.prepare('PRAGMA table_xinfo(' + table + ')').all()
    .filter(column => column.hidden !== 1).map(column => column.name);
  const expressions = columns.map(quoteIdentifier);
  const order = expressions.map(column => 'typeof(' + column + '), ' + column + ' COLLATE BINARY').join(', ');
  const rows = db.prepare('SELECT ' + expressions.join(', ') + ' FROM ' + table + ' ORDER BY ' + order);
  rows.setReadBigInts(true);
  const hash = createHash('sha256');
  hash.update(JSON.stringify(columns) + '\n');
  let count = 0;
  for (const row of rows.iterate()) {
    const values = columns.map(column => {
      const value = row[column];
      if (typeof value === 'bigint') return ['integer', value.toString()];
      if (value instanceof Uint8Array) return ['blob', Buffer.from(value).toString('hex')];
      if (typeof value === 'number') return ['real', String(value)];
      return value;
    });
    hash.update(JSON.stringify(values) + '\n');
    count++;
  }
  return { count, digest: hash.digest('hex') };
}

function inspect(path, expected, required) {
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA trusted_schema = OFF; BEGIN');
    const checks = db.prepare('PRAGMA integrity_check').all();
    if (checks.length !== 1 || checks[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').get()) {
      throw Error('Database integrity or foreign key verification failed');
    }
    const objects = schema(db);
    const observed = new Set(objects.map(({ type, name, tbl_name }) => JSON.stringify([type, name, tbl_name])));
    if (required.some(key => !observed.has(key))) throw Error('Required Command Core schema objects are missing');
    const partition = db.prepare('SELECT * FROM application_partition').all();
    if (partition.length !== 1 || partition[0].singleton !== 1 || partition[0].application_id !== expected.application ||
        partition[0].repository !== expected.repository || partition[0].portfolio_id !== expected.portfolio) {
      throw Error('Database identity does not match the expected application, repository and portfolio');
    }
    const tables = Object.fromEntries(objects.filter(object => object.type === 'table')
      .map(({ name }) => [name, tableEvidence(db, name)]));
    return { schema: digest(objects), tables };
  } finally {
    db.close();
  }
}

export function verifyRestore(source, restored, { application, repository, portfolio }) {
  if (!applicationId.test(application) || !repositoryName.test(repository) || !applicationId.test(portfolio)) {
    throw Error('Explicit application, repository and portfolio are required');
  }
  source = realpathSync(source);
  restored = realpathSync(restored);
  const first = statSync(source, { bigint: true });
  const second = statSync(restored, { bigint: true });
  if (!first.isFile() || !second.isFile() || (first.dev === second.dev && first.ino === second.ino)) {
    throw Error('The checkpoint and restore must be separate files');
  }
  if ([source, restored].some(path => ['-journal', '-wal', '-shm'].some(suffix => existsSync(path + suffix)))) {
    throw Error('Checkpoint and restore must be standalone SQLite files');
  }
  const expected = { application, repository, portfolio };
  const required = currentObjects();
  const checkpoint = inspect(source, expected, required);
  const target = inspect(restored, expected, required);
  if (checkpoint.schema !== target.schema) throw Error('Restored schema differs from the checkpoint');
  for (const [name, value] of Object.entries(checkpoint.tables)) {
    if (value.count !== target.tables[name]?.count || value.digest !== target.tables[name]?.digest) {
      throw Error('Restored records differ in table ' + JSON.stringify(name));
    }
  }
  return {
    ...expected,
    required_schema_revision: journal.at(-1).tag,
    digest: digest(checkpoint),
    tables: Object.fromEntries(Object.entries(checkpoint.tables).map(([name, value]) => [name, value.count])),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, restored, application, repository, portfolio] = process.argv.slice(2);
  if (process.argv.length !== 7) {
    process.stderr.write('Usage: verify-restore.mjs CHECKPOINT RESTORED APPLICATION REPOSITORY PORTFOLIO\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(JSON.stringify(verifyRestore(source, restored, { application, repository, portfolio })) + '\n');
    } catch (error) {
      process.stderr.write((error.code ? 'Could not read both checkpoint and restored databases' : error.message) + '\n');
      process.exitCode = 1;
    }
  }
}
