import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { startStage } from './staging-fixture.mjs';
import { applyMigrations, openPartition } from './sqlite-runtime.mjs';
import { stageSnapshot } from './stage-snapshot.mjs';
import { taskOperation } from './task-engine.mjs';

const owner = 'synthetic-staging-owner';
const workerKey = 'w'.repeat(64);
const revision = 'a'.repeat(40);
const appId = 'aetherwake';
const repository = 'synthetic/observatory';
const fields = { title: 'Synthetic staging task', objective: 'Verify persisted lifecycle', primary: 'backend',
  profile_id: 'backend', criteria: ['Check the recorded staging lifecycle'] };

async function files(t) {
  const root = await mkdtemp(join(tmpdir(), 'command-core-stage-'));
  t.after(async () => {
    for (const item of await readdir(root)) await rm(join(root, item), { force: true });
    await rmdir(root);
  });
  return name => join(root, name + '.sqlite');
}

function configure(part) {
  part.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)').run(appId, repository, 'engineering');
}

async function legacyTask(part, name) {
  const register = await taskOperation({ db: part.DB, owner, namespace: 'live', repository,
    body: { op: 'register', operation_id: crypto.randomUUID(), fields: { ...fields, title: name } },
    access: 'owner', validate: () => true, revision: async () => revision });
  assert.equal(register.status, 201);
  const task_id = register.body.task.id;
  const mutate = (body, type = 'owner') => taskOperation({ db: part.DB, owner, namespace: 'live', repository,
    body: { ...body, operation_id: crypto.randomUUID() }, access: type, validate: () => true, revision: async () => revision });
  assert.equal((await mutate({ op: 'command', task_id, expected_version: 1, action: { type: 'admit', executor: 'codex' } })).status, 200);
  return (await mutate({ op: 'claim', task_ids: [task_id] }, 'worker')).body.claim;
}

test('local HTTP staging authenticates, persists an in-flight lease, restarts, and contains malformed reports', async t => {
  const file = await files(t);
  const part = openPartition(file('stage'));
  applyMigrations(part.sqlite);
  configure(part);
  const stage = await startStage(part);
  let restarted;
  let reopened;
  try {
    assert.equal((await stage.run('/healthz')).status, 200);
    assert.equal((await stage.run('/api/projects', undefined, false)).status, 401);
    assert.equal((await stage.run('/api/projects')).status, 200);
    const taskApi = body => stage.run('/api/task-engine/v1', body);
    const registered = await taskApi({ op: 'register', operation_id: crypto.randomUUID(), fields });
    assert.equal(registered.status, 201);
    assert.equal((await taskApi({ op: 'command', task_id: registered.body.task.id, expected_version: 1,
      operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } })).status, 200);
    const claimed = await stage.run('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'task_engine_v1', arguments: { worker_key: workerKey, application_id: appId,
        request: { op: 'claim', operation_id: crypto.randomUUID(), worker_id: crypto.randomUUID() } },
    } });
    const claim = claimed.body.result.structuredContent.claim;
    assert.equal(claim.task.id, registered.body.task.id);
    await stage.close();
    part.sqlite.close();

    reopened = openPartition(file('stage'));
    restarted = await startStage(reopened);
    const task_id = claim.task.id;
    const attempt_id = claim.attempt.id;
    const report = async lease => {
      const request = { op: 'report', task_id, attempt_id, lease, operation_id: crypto.randomUUID(), report: { type: 'failed', failure: 'Synthetic interruption' } };
      return (await restarted.run('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'task_engine_v1', arguments: { application_id: appId, worker_key: workerKey, request } } })).body.result.structuredContent;
    };
    assert.ok((await report(crypto.randomUUID())).status >= 400);
    assert.equal((await report(claim.lease)).status, 200);
    const task = await restarted.run('/api/task-engine/v1', { op: 'get', task_id });
    assert.equal(task.body.task.id, task_id);
    assert.equal(task.body.attempts[0].id, attempt_id);
    assert.equal(task.body.lifecycle.state, 'failed');
  } finally {
    if (restarted) {
      await restarted.close();
      reopened.sqlite.close();
    }
  }
});

test('an isolated checkpoint import preserves canonical rows, replays idempotently, and fences copied leases', async t => {
  const file = await files(t);
  const source = openPartition(file('source'));
  applyMigrations(source.sqlite, { to: 16 });
  const claim = await legacyTask(source, 'Legacy in-flight task');
  const original = source.sqlite.prepare('SELECT * FROM proposals').all();
  const events = source.sqlite.prepare('SELECT * FROM task_engine_events ORDER BY version').all();
  source.sqlite.close();
  const before = await readFile(file('source'));
  const options = { source: file('source'), destination: file('prepared'), application: appId, repository, portfolio: 'engineering' };
  const imported = await stageSnapshot(options);
  assert.equal(imported.counts.proposals, 1);
  assert.equal(imported.counts.attempts, 1);
  assert.equal(imported.replayed, false);
  assert.equal((await stageSnapshot(options)).replayed, true);
  await assert.rejects(stageSnapshot({ ...options, application: 'voyagewright' }), /different migration receipt/);
  assert.deepEqual(await readFile(file('source')), before);
  const isolated = openPartition(options.destination);
  try {
    assert.deepEqual(isolated.sqlite.prepare('SELECT owner_id, namespace, task_id, created_at, record, github_state, stale_revision, version, priority, receipts, engine FROM proposals').all(), original);
    assert.deepEqual(isolated.sqlite.prepare('SELECT * FROM task_engine_events ORDER BY version').all(), events);
    const stage = await startStage(isolated);
    try {
      assert.equal((await stage.run('/api/task-engine/v1', { op: 'get', task_id: claim.task.id })).status, 503);
    } finally { await stage.close(); }
  } finally { isolated.sqlite.close(); }
  await rm(options.destination);
  assert.equal((await stageSnapshot(options)).replayed, false);
  assert.deepEqual(await readFile(file('source')), before);
});

test('current application partitions restore from independent SQLite checkpoints with their relationships intact', async t => {
  const file = await files(t);
  for (const applicationId of ['aetherwake', 'voyagewright']) {
    const applicationRepository = 'synthetic/' + applicationId;
    const source = openPartition(file(applicationId + '-source'));
    applyMigrations(source.sqlite);
    source.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)').run(applicationId, applicationRepository, 'engineering');
    const stage = await startStage(source, { applicationId, applicationRepository });
    const projectId = crypto.randomUUID();
    const secondProject = crypto.randomUUID();
    const milestoneId = crypto.randomUUID();
    let taskId, attemptId, inventory;
    const schema = db => db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const contents = db => Object.fromEntries(schema(db).filter(item => item.type === 'table')
      .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]));
    try {
      for (const id of [projectId, secondProject]) {
        assert.equal((await stage.run('/api/projects', { op: 'create', id, fields: {
          name: 'Synthetic recovery Project', objective: 'Verify the checkpoint preserves Project records',
        } })).status, 201);
      }
      const order = [secondProject, projectId];
      assert.equal((await stage.run('/api/projects', { op: 'reorder', project_ids: order, expected_version: 0 })).status, 200);
      const task = await stage.run('/api/projects', { op: 'register_task', id: projectId, operation_id: crypto.randomUUID(), fields });
      assert.equal(task.status, 201);
      taskId = task.body.task.id;
      assert.equal((await stage.run('/api/projects', { op: 'milestone', id: projectId, milestone_id: milestoneId,
        name: 'Recovery evidence', acceptance: 'Record stable identifiers', status: 'planned' })).status, 201);
      assert.equal((await stage.run('/api/projects', { op: 'milestone_link', id: projectId, task_id: taskId, milestone_id: milestoneId })).status, 200);
      assert.equal((await stage.run('/api/task-engine/v1', { op: 'command', task_id: taskId, expected_version: task.body.version,
        operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } })).status, 200);
      const claim = (await stage.run('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'task_engine_v1', arguments: { worker_key: workerKey, application_id: applicationId,
          request: { op: 'claim', operation_id: crypto.randomUUID(), worker_id: crypto.randomUUID() } },
      } })).body.result.structuredContent.claim;
      attemptId = claim.attempt.id;
      assert.equal((await stage.run('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
        name: 'task_engine_v1', arguments: { worker_key: workerKey, application_id: applicationId,
          request: { op: 'report', task_id: taskId, attempt_id: attemptId, lease: claim.lease,
            operation_id: crypto.randomUUID(), report: { type: 'failed', failure: 'Synthetic result before backup' } } },
      } })).body.result.structuredContent.status, 200);
      assert.equal((await stage.run('/api/settings', { op: 'save', expected_version: 0, values: { density: 'compact' } })).status, 200);
      inventory = { schema: schema(source.sqlite), contents: contents(source.sqlite) };
      await backup(source.sqlite, file(applicationId + '-checkpoint'));
      assert.equal((await stage.run('/api/settings', { op: 'save', expected_version: 1, values: { density: 'comfortable' } })).status, 200);
      assert.equal((await stage.run('/api/settings')).body.preferences.values.density, 'comfortable');
    } finally {
      await stage.close();
      source.sqlite.close();
    }
    const checkpoint = new DatabaseSync(file(applicationId + '-checkpoint'), { readOnly: true });
    try {
      await backup(checkpoint, file(applicationId + '-restore'));
    } finally {
      checkpoint.close();
    }
    const restored = openPartition(file(applicationId + '-restore'));
    const recovered = await startStage(restored, { applicationId, applicationRepository });
    try {
      assert.deepEqual(schema(restored.sqlite), inventory.schema);
      assert.deepEqual(contents(restored.sqlite), inventory.contents);
      assert.equal(restored.sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.deepEqual(restored.sqlite.prepare('PRAGMA foreign_key_check').all(), []);
      const project = (await recovered.run('/api/projects/' + projectId)).body;
      assert.equal(project.project.application_id, applicationId);
      assert.equal(project.tasks[0].id, taskId);
      assert.deepEqual(project.task_milestones, [{ task_id: taskId, milestone_id: milestoneId }]);
      assert.deepEqual((await recovered.run('/api/projects')).body.manual_order.project_ids, [secondProject, projectId]);
      const task = (await recovered.run('/api/task-engine/v1', { op: 'get', task_id: taskId })).body;
      assert.equal(task.attempts[0].id, attemptId);
      assert.equal(task.lifecycle.state, 'failed');
      assert.equal((await recovered.run('/api/settings')).body.preferences.values.density, 'compact');
      assert.equal((await recovered.run('/api/settings/data')).body.integrity.status, 'passed');
      const peerId = applicationId === 'aetherwake' ? 'voyagewright' : 'aetherwake';
      const mismatched = await startStage(restored, { applicationId: peerId, applicationRepository: 'synthetic/' + peerId });
      try {
        assert.equal((await mismatched.run('/api/projects')).status, 503);
      } finally {
        await mismatched.close();
      }
    } finally {
      await recovered.close();
      restored.sqlite.close();
    }
  }
});
