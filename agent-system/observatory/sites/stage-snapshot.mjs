import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, link, mkdtemp, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { applicationId, repositoryName } from './application-config.mjs';
import { applyMigrations } from './sqlite-runtime.mjs';

const sourceTables = [
  'proposals', 'task_engine_events', 'task_telemetry', 'private_projection', 'task_worker_liveness',
  'integration_runs', 'integration_events', 'ci_operations', 'github_snapshot', 'github_details',
];

function tableColumns(sqlite) {
  return sourceTables.map(table => [table, sqlite.prepare('PRAGMA table_info(' + table + ')').all().map(column => column.name)]);
}

function contentDigest(sqlite, schema) {
  const hash = createHash('sha256');
  for (const [table, columns] of schema) {
    hash.update(table + '\n');
    for (const row of sqlite.prepare('SELECT ' + columns.join(', ') + ' FROM ' + table + ' ORDER BY rowid').iterate()) {
      hash.update(JSON.stringify(row) + '\n');
    }
  }
  return hash.digest('hex');
}

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function inventory(sqlite) {
  const check = sqlite.prepare('PRAGMA integrity_check').all();
  if (check.length !== 1 || check[0].integrity_check !== 'ok' || sqlite.prepare('PRAGMA foreign_key_check').all().length) {
    throw Error('Snapshot integrity verification failed');
  }
  const counts = Object.fromEntries(sourceTables.map(name => [name, sqlite.prepare('SELECT count(*) AS count FROM ' + name).get().count]));
  const measurements = sqlite.prepare("SELECT coalesce(sum(json_array_length(engine,'$.attempts')),0) AS attempts FROM proposals WHERE engine IS NOT NULL").get();
  const receipts = sqlite.prepare('SELECT count(*) AS count FROM task_engine_events e LEFT JOIN proposals p USING (owner_id, namespace, task_id) WHERE p.task_id IS NULL').get();
  if (receipts.count !== 0) throw Error('Task audit record is missing its Task');
  return { ...counts, attempts: measurements.attempts };
}

export async function stageSnapshot({ source, destination, application, repository, portfolio }) {
  if (!applicationId.test(application) || !applicationId.test(portfolio) || !repositoryName.test(repository)) {
    throw Error('Explicit application, repository and portfolio are required');
  }
  source = resolve(source);
  destination = resolve(destination);
  if (source.toLowerCase() === destination.toLowerCase() || ['-wal', '-shm', '-journal'].some(suffix => existsSync(source + suffix))) {
    throw Error('An immutable, standalone v15 checkpoint and separate destination are required');
  }
  const targetDirectory = await realpath(dirname(destination));
  for (let path = targetDirectory; ; path = dirname(path)) {
    if (existsSync(join(path, '.git'))) throw Error('Store checkpoint copies outside Git checkouts');
    if (path === dirname(path)) break;
  }
  destination = join(targetDirectory, destination.slice(dirname(destination).length + 1));
  const digest = await fileDigest(source);
  const sourceReader = new DatabaseSync(source, { readOnly: true });
  let schema;
  try { schema = tableColumns(sourceReader); } finally { sourceReader.close(); }
  if (existsSync(destination)) {
    const existing = new DatabaseSync(destination, { readOnly: true });
    try {
      const receipt = existing.prepare('SELECT * FROM migration_receipt WHERE singleton = 1').get();
      const partition = existing.prepare('SELECT application_id, repository, portfolio_id FROM application_partition WHERE singleton = 1').get();
      if (receipt?.source_digest !== digest || partition?.application_id !== application ||
        partition?.repository !== repository || partition?.portfolio_id !== portfolio) {
        throw Error('Destination already exists with a different migration receipt');
      }
      if (JSON.stringify(inventory(existing)) !== receipt.counts || contentDigest(existing, schema) !== receipt.content_digest) {
        throw Error('Existing staged checkpoint diverges from its receipt');
      }
      return { replayed: true, counts: JSON.parse(receipt.counts), runtime_mode: 'frozen' };
    } finally {
      existing.close();
    }
  }
  const temporary = await mkdtemp(join(dirname(destination), '.snapshot-'));
  const prepared = join(temporary, 'prepared.sqlite');
  try {
    if (process.platform === 'win32') {
      const script = [
        '$ErrorActionPreference = "Stop"',
        '$path = $env:COMMAND_CORE_PRIVATE_DIR',
        '$acl = [IO.Directory]::GetAccessControl($path)',
        '$acl.SetAccessRuleProtection($true, $false)',
        'foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleAll($rule) }',
        '$ids = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")), (New-Object System.Security.Principal.SecurityIdentifier("S-1-5-32-544")))',
        'foreach ($id in $ids) { $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($id, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"); $acl.SetAccessRule($rule) }',
        '[IO.Directory]::SetAccessControl($path, $acl)',
      ].join('; ');
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        env: { ...process.env, COMMAND_CORE_PRIVATE_DIR: temporary }, timeout: 10000, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      });
    }
    const input = new DatabaseSync(source, { readOnly: true });
    let counts, content;
    try {
      counts = inventory(input);
      content = contentDigest(input, schema);
      const repositoryRows = [
        ['proposals', 'record'], ['integration_runs', 'record'], ['task_telemetry', 'payload'],
        ['private_projection', 'payload'], ['github_snapshot', 'snapshot'],
      ];
      for (const [table, field] of repositoryRows) {
        const wrong = input.prepare("SELECT 1 FROM " + table + " WHERE " + field + " IS NOT NULL AND json_extract(" + field + ",'$.repository') IS NOT ? LIMIT 1").get(repository);
        if (wrong) throw Error('Snapshot row repository does not match the destination in ' + table);
      }
      const prefix = 'https://github.com/' + repository + '/';
      const wrongDetail = input.prepare("SELECT 1 FROM github_details WHERE json_extract(payload,'$.detail') IS NOT NULL AND substr(json_extract(payload,'$.detail.url'),1,?) IS NOT ? LIMIT 1")
        .get(prefix.length, prefix);
      if (wrongDetail) throw Error('Snapshot GitHub detail repository does not match the destination');
      await backup(input, prepared);
    } finally {
      input.close();
    }
    if (await fileDigest(source) !== digest) throw Error('Source checkpoint changed during copy');
    const output = new DatabaseSync(prepared);
    try {
      applyMigrations(output, { from: 16 });
      output.exec('BEGIN IMMEDIATE');
      output.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)').run(application, repository, portfolio);
      output.prepare('INSERT INTO migration_receipt VALUES (1, ?, ?, ?)').run(digest, content, JSON.stringify(counts));
      output.exec('COMMIT');
      if (JSON.stringify(inventory(output)) !== JSON.stringify(counts) || contentDigest(output, schema) !== content) throw Error('Snapshot content mismatch');
    } finally {
      output.close();
    }
    if (process.platform !== 'win32') {
      await chmod(prepared, 0o600);
      if ((await stat(prepared)).mode & 0o077) throw Error('Checkpoint file permissions could not be restricted');
    }
    // An atomic no-replace publication keeps a racing importer from overwriting the prepared copy.
    await link(prepared, destination);
    return { replayed: false, counts, runtime_mode: 'frozen' };
  } finally {
    await rm(prepared, { force: true });
    await rmdir(temporary);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination, application, repository, portfolio] = process.argv.slice(2);
  if (!source || !destination) throw Error('Usage: stage-snapshot.mjs SOURCE DESTINATION APP REPOSITORY PORTFOLIO');
  const result = await stageSnapshot({ source, destination, application, repository, portfolio });
  process.stdout.write(JSON.stringify(result) + '\n');
}
