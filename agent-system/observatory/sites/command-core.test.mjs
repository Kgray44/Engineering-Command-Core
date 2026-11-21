import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createCommandCore } from './command-core.mjs';

const fixture = [
  { id: 'aetherwake', name: 'Aetherwake', repository: 'synthetic/one', binding: 'ONE', origin: 'https://one.fixture.test' },
  { id: 'voyagewright', name: 'Voyagewright', repository: 'synthetic/two', binding: 'TWO', origin: 'https://two.fixture.test' },
];
const journal = JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json', import.meta.url)));

function partition(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  for (const { tag } of journal.entries) {
    sqlite.exec(readFileSync(new URL('./drizzle/' + tag + '.sql', import.meta.url), 'utf8'));
  }
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind: (...args) => ({
      first: async () => statement.get(...args) ?? null,
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: statement.run(...args) }),
    }) };
  } };
  return { sqlite, DB };
}

function setup(t) {
  const one = partition(t);
  const two = partition(t);
  for (const [part, app] of [[one, fixture[0]], [two, fixture[1]]]) {
    part.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)').run(app.id, app.repository, 'engineering');
  }
  const owner = 'synthetic-owner';
  const env = {
    ONE: { DB: one.DB, OBSERVATORY_TASK_ENGINE_OWNER_ID: owner, OBSERVATORY_TASK_WORKER_KEY: 'a'.repeat(64), GITHUB_READ_TOKEN: 'one-fixture' },
    TWO: { DB: two.DB, OBSERVATORY_TASK_ENGINE_OWNER_ID: owner, OBSERVATORY_TASK_WORKER_KEY: 'b'.repeat(64), GITHUB_READ_TOKEN: 'two-fixture' },
  };
  const requests = [];
  const engine = createCommandCore({
    applications: fixture, assets: {}, validate: () => true, validateEvent: () => true, sourceRevision: 'd'.repeat(40),
    fetcher: async (url, init) => {
      requests.push({ url, credential: new Headers(init?.headers).get('authorization') });
      return Response.json(String(url).endsWith('/git/ref/heads/main')
        ? { ref: 'refs/heads/main', object: { sha: 'a'.repeat(40) } }
        : { message: 'Synthetic provider response' }, { status: String(url).endsWith('/git/ref/heads/main') ? 200 : 404 });
    },
  });
  const call = async (app, path, body, identity = owner) => {
    const origin = fixture[app].origin;
    const response = await engine.fetch(new Request(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'oai-authenticated-user-id': identity, 'content-type': 'application/json', origin },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), env);
    return { status: response.status, body: await response.json() };
  };
  const task = (app, body) => call(app, '/api/task-engine/v1', body);
  const rpc = (app, name, args) => call(app, '/mcp', {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
  });
  return { call, task, rpc, requests, one, two, env };
}
const taskFields = { title: 'Synthetic task', objective: 'Write a synthetic evidence file', primary: 'backend',
  profile_id: 'backend', criteria: ['Evidence is readable'] };

test('one engine keeps equal task IDs, credentials, and queues independent across applications', async t => {
  const { task, rpc, requests } = setup(t);
  const operation_id = crypto.randomUUID();
  const tasks = await Promise.all([0, 1].map(app => task(app, { op: 'register', operation_id, fields: taskFields })));
  assert.deepEqual(tasks.map(result => result.status), [201, 201]);
  assert.equal(tasks[0].body.task.id, tasks[1].body.task.id);
  assert.deepEqual(tasks.map(result => result.body.task.repository), ['synthetic/one', 'synthetic/two']);
  for (const {url, credential} of requests.filter(request => request.url.includes('/repos/'))) {
    assert.match(url, credential === 'Bearer one-fixture' ? /\/repos\/synthetic\/one\// : /\/repos\/synthetic\/two\//);
  }
  for (const [index, result] of tasks.entries()) {
    assert.equal((await task(index, { op: 'command', task_id: result.body.task.id, expected_version: result.body.version,
      operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } })).status, 200);
  }
  const claim = { op: 'claim', operation_id: crypto.randomUUID(), worker_id: crypto.randomUUID() };
  const worker = (id, key, request = claim) => rpc(0, 'task_engine_v1', {
    application_id: fixture[id].id, request, worker_key: key.repeat(64),
  });
  const denied = await worker(1, 'a');
  assert.equal(denied.body.result.structuredContent.status, 403);
  const results = await Promise.all([worker(0, 'a'), worker(1, 'b')]);
  const claims = results.map(result => result.body.result.structuredContent.claim);
  assert.ok(claims.every(Boolean));
  assert.notEqual(claims[0].attempt.id, claims[1].attempt.id);
  const report = (app, claim, key) => worker(app, key, { op: 'report', operation_id: crypto.randomUUID(),
    task_id: claim.task.id, attempt_id: claim.attempt.id, lease: claim.lease, report: { type: 'failed', failure: 'Synthetic worker interruption' } });
  assert.ok((await report(1, claims[0], 'b')).body.result.structuredContent.status >= 400);
  assert.equal((await report(0, claims[0], 'a')).body.result.structuredContent.status, 200);
  const independent = await task(1, { op: 'get', task_id: claims[1].task.id });
  assert.equal(independent.body.lifecycle.state, 'running');
});

test('project records are application-scoped and enforce optimistic updates', async t => {
  const { call, rpc } = setup(t);
  const id = crypto.randomUUID();
  const created = await call(0, '/api/projects', { op: 'create', id, fields: { name: 'Synthetic project', objective: 'Prove scoped storage' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.application_id, 'aetherwake');
  assert.equal((await call(1, '/api/projects/' + id)).status, 404);
  assert.equal((await call(0, '/api/projects/' + id, undefined, 'unassigned')).status, 403);
  assert.equal((await call(0, '/api/projects', { op: 'update', id, expected_version: 0, fields: { name: 'Stale' } })).status, 409);
  assert.equal((await rpc(0, 'projects_v1', { request: { op: 'get', id } })).body.error.code, -32602);
  const result = await rpc(0, 'projects_v1', { application_id: 'aetherwake', request: { op: 'get', id } });
  assert.equal(result.body.result.structuredContent.project.name, 'Synthetic project');
});

test('a Project milestone gate blocks claims until the dependency is accepted', async t => {
  const { call, task, rpc } = setup(t);
  const project = (body) => call(0, '/api/projects', body);
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  for (const id of [first, second]) {
    assert.equal((await project({ op: 'create', id, fields: { name: 'Synthetic project', objective: 'Prove acceptance gate' } })).status, 201);
    assert.equal((await project({ op: 'update', id, expected_version: 1, status: 'active' })).status, 200);
  }
  const milestone_id = crypto.randomUUID();
  const milestone = { op: 'milestone', id: second, milestone_id, name: 'Synthetic acceptance', acceptance: 'Confirm a reviewed receipt' };
  assert.equal((await project({ ...milestone, status: 'integrated' })).status, 201);
  const created = await project({ op: 'register_task', id: first, operation_id: crypto.randomUUID(), fields: taskFields });
  assert.equal(created.status, 201);
  assert.equal(created.body.project_id, first);
  const task_id = created.body.task.id;
  assert.equal((await project({ op: 'milestone_gate', id: first, task_id, milestone_id })).status, 200);
  assert.equal((await task(0, { op: 'command', task_id, operation_id: crypto.randomUUID(), expected_version: created.body.version,
    action: { type: 'admit', executor: 'codex' } })).status, 200);
  const claim = async () => (await rpc(0, 'task_engine_v1', { application_id: 'aetherwake', worker_key: 'a'.repeat(64),
    request: { op: 'claim', operation_id: crypto.randomUUID(), worker_id: crypto.randomUUID() } })).body.result.structuredContent.claim;
  assert.equal(await claim(), null);
  assert.equal((await project({ ...milestone, status: 'accepted', expected_version: 1 })).status, 200);
  assert.equal((await claim()).task.id, task_id);
});
