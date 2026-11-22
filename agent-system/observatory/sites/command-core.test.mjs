import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createCommandCore } from './command-core.mjs';
import { openCommandCoreStageConnector } from '../../../scripts/agent/command-core-stage-connector.mjs';

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
    applications: fixture, assets: {}, trustedIdentity: request => request.headers.get('oai-authenticated-user-id'), validate: () => true, validateEvent: () => true, sourceRevision: 'd'.repeat(40),
    fetcher: async (url, init) => {
      requests.push({ url, credential: new Headers(init?.headers).get('authorization'), method: init?.method, body: init?.body });
      if (init?.method === 'PUT') return Response.json({}, { status: 201 });
      return Response.json(String(url).endsWith('/git/ref/heads/main')
        ? { ref: 'refs/heads/main', object: { sha: 'a'.repeat(40) } }
        : { message: 'Synthetic provider response' }, { status: String(url).endsWith('/git/ref/heads/main') ? 200 : 404 });
    },
  });
  const call = async (app, path, body, identity = owner, extraHeaders = {}) => {
    const origin = fixture[app].origin;
    const response = await engine.fetch(new Request(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'oai-authenticated-user-id': identity, 'content-type': 'application/json', origin, ...extraHeaders },
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
test('application authorization and storage identity fail closed', async t => {
  const { call, env, rpc } = setup(t);
  env.TWO.OBSERVATORY_TASK_ENGINE_OWNER_ID = 'different-owner';
  assert.equal((await call(1, '/api/projects')).status, 403);
  const applications = await rpc(0, 'list_applications', {});
  assert.deepEqual(applications.body.result.structuredContent.applications.map(app => app.id), ['aetherwake']);
  assert.equal((await rpc(0, 'task_engine_v1', { application_id: ['aetherwake', 'voyagewright'], request: { op: 'list' } })).body.error.code, -32602);
  assert.equal((await rpc(0, 'task_engine_v1', { application_id: 'voyagewright', request: { op: 'list' } })).status, 403);
  env.TWO.OBSERVATORY_TASK_ENGINE_OWNER_ID = env.ONE.OBSERVATORY_TASK_ENGINE_OWNER_ID;
  const original = env.TWO.DB;
  env.TWO.DB = env.ONE.DB;
  assert.equal((await call(1, '/api/projects')).status, 503);
  env.TWO.DB = original;
  env.TWO.GITHUB_READ_TOKEN = env.ONE.GITHUB_READ_TOKEN;
  assert.equal((await call(0, '/api/projects')).status, 503);
});

test('application Task dependencies and telemetry reject a request for the other repository', async t => {
  const { task, rpc, requests } = setup(t);
  const scoped = (app, name, params) => rpc(0, name, { application_id: fixture[app].id, ...params });
  const body = { op: 'register', operation_id: crypto.randomUUID(), fields: taskFields };
  const remote = await task(1, body);
  const mismatch = await task(0, { ...body, fields: { ...taskFields, repository: fixture[1].repository } });
  assert.equal(mismatch.status, 400);
  assert.equal(requests.some(({url}) => url.includes('/repos/synthetic/one/')), false);
  const denied = await task(0, { ...body, fields: { ...taskFields, dependencies: [remote.body.task.id] } });
  assert.equal(denied.status, 400);
  const local = await task(0, body);
  assert.equal(local.status, 201);
  const telemetry = record => ({ task_id: record.id, change: { base: null, generated_at: new Date().toISOString(),
    records: [record], events: [] } });
  const reject = await scoped(0, 'sync_task_telemetry', telemetry(remote.body.task));
  assert.equal(JSON.parse(reject.body.result.content[0].text).status, 400);
  const write = await scoped(0, 'sync_task_telemetry', telemetry(local.body.task));
  assert.match(JSON.parse(write.body.result.content[0].text).digest, /^[a-f0-9]{64}$/);
  const other = await scoped(1, 'sync_task_telemetry', { task_id: local.body.task.id });
  const baseline = JSON.parse(other.body.result.content[0].text).baseline;
  assert.equal(baseline, null);
});

test('concurrent claim retries keep one Attempt and archive only affects the owning Project', async t => {
  const { call, task, rpc } = setup(t);
  const id = crypto.randomUUID();
  const fields = { name: 'Synthetic same identity', objective: 'Verify archive and claim scope' };
  for (const app of [0, 1]) assert.equal((await call(app, '/api/projects', { op: 'create', id, fields })).status, 201);
  const linked = await call(0, '/api/projects', { op: 'register_task', id, operation_id: crypto.randomUUID(), fields: taskFields });
  const task_id = linked.body.task.id;
  assert.equal((await task(0, { op: 'command', task_id, operation_id: crypto.randomUUID(), expected_version: 1,
    action: { type: 'admit', executor: 'codex' } })).status, 200);
  const claim = async operation_id => (await rpc(0, 'task_engine_v1', { application_id: 'aetherwake', worker_key: 'a'.repeat(64),
    request: { op: 'claim', operation_id, task_ids: [task_id] } })).body.result.structuredContent;
  const operations = [crypto.randomUUID(), crypto.randomUUID()];
  const results = await Promise.all(operations.map(claim));
  assert.equal(results.filter(result => result.claim).length, 1);
  const winner = results.findIndex(result => result.claim);
  assert.equal((await claim(operations[winner])).claim.attempt.id, results[winner].claim.attempt.id);
  assert.equal((await task(0, { op: 'get', task_id })).body.attempts.length, 1);
  assert.equal((await call(0, '/api/projects', { op: 'update', id, status: 'archived', expected_version: 1 })).status, 200);
  assert.equal((await call(1, '/api/projects/' + id)).body.project.status, 'planned');
});

test('Project progress reports actual scoped execution, milestone gates and owner review', async t => {
  const { call, task, one, rpc } = setup(t);
  const project = request => call(0, '/api/projects', request);
  const id = crypto.randomUUID();
  const dependencyId = crypto.randomUUID();
  for (const projectId of [id, dependencyId]) {
    assert.equal((await project({ op: 'create', id: projectId, fields: {
      name: 'Fixture', objective: 'Verify reported progress', owner_review: projectId === id ? 'pending' : '',
    } })).status, 201);
  }
  const milestone_id = crypto.randomUUID();
  const milestone = { op: 'milestone', id: dependencyId, milestone_id, name: 'Foundation', acceptance: 'Evidence', status: 'planned' };
  assert.equal((await project(milestone)).status, 201);
  const registration = await project({ op: 'register_task', id, operation_id: crypto.randomUUID(), fields: taskFields });
  const task_id = registration.body.task.id;
  assert.equal((await project({ op: 'milestone_gate', id, task_id, milestone_id })).status, 200);
  assert.equal((await task(0, { op: 'command', task_id, expected_version: registration.body.version,
    operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } })).status, 200);
  const integrationId = crypto.randomUUID();
  const head = 'a'.repeat(40);
  const checks = [{ context: 'test', app: 9, source: 'ruleset', state: 'passed' }];
  const insertRun = one.sqlite.prepare("INSERT INTO integration_runs VALUES (?, 'live', ?, ?, ?, ?, ?, 'merged', 1, ?, ?, ?)");
  for (const [id, pr, observed_head] of [[integrationId, 42, head], [crypto.randomUUID(), 43, 'b'.repeat(40)]]) {
    insertRun.run('synthetic-owner', id, task_id, crypto.randomUUID(), head, pr,
      new Date().toISOString(), JSON.stringify({ evidence: { observed_head, policy_observed: true, checks } }),
      JSON.stringify({ operation_id: crypto.randomUUID() }));
  }
  const read = async () => (await call(0, '/api/projects/' + id)).body;
  const detail = await read();
  assert.equal(detail.progress.tasks.blocked, 1);
  assert.equal(detail.active_workers, 0);
  assert.equal(detail.progress.tasks.completed, 0);
  assert.equal(detail.progress.owner_review, 'pending');
  assert.deepEqual(detail.progress.integrations, { tracked: 2, merged: 2, deployed: 0 });
  assert.equal(detail.integrations[0].repository, fixture[0].repository);
  assert.deepEqual(detail.integrations.find(run => run.id === integrationId).required_checks, checks);
  assert.deepEqual(detail.integrations.find(run => run.id !== integrationId).required_checks, []);
  assert.ok(detail.history.some(event => event.kind === 'project_owner_review_changed' && event.name === 'Owner review requested'));
  assert.deepEqual(detail.tasks[0].blockers, [{ type: 'milestone', id: milestone_id, state: 'planned' }]);
  const portfolio = (await call(0, '/api/projects')).body;
  assert.deepEqual(portfolio.projects.find(item => item.id === id).progress, detail.progress);
  assert.equal((await call(1, '/api/projects')).body.projects.length, 0);
  assert.equal((await project({ ...milestone, expected_version: 1, status: 'accepted' })).status, 200);
  assert.equal((await read()).progress.tasks.ready, 1);
  const claim = await rpc(0, 'task_engine_v1', { application_id: 'aetherwake', worker_key: 'a'.repeat(64),
    request: { op: 'claim', operation_id: crypto.randomUUID(), worker_id: crypto.randomUUID() } });
  assert.equal(claim.body.result.structuredContent.claim.task.id, task_id);
  assert.equal((await read()).active_workers, 1);
  assert.equal((await call(0, '/api/projects/' + dependencyId)).body.active_workers, 0);
});

test('explicit proposal writes carry only the owning repository and its publication credential', async t => {
  const { call, env, requests } = setup(t);
  env.ONE.GITHUB_PROPOSAL_TOKEN = 'one-publish-fixture';
  env.TWO.GITHUB_PROPOSAL_TOKEN = 'two-publish-fixture';
  const headers = { 'x-observatory-publish': 'github', 'x-observatory-request-id': crypto.randomUUID() };
  const write = (app, repository, owner = 'synthetic-owner') => call(app, '/api/tasks', { ...taskFields, repository }, owner, headers);
  assert.equal((await write(0, fixture[1].repository)).status, 400);
  assert.equal((await write(1, fixture[1].repository, 'unassigned')).status, 403);
  assert.equal(requests.some(entry => entry.method === 'PUT'), false);
  for (const app of [0, 1]) {
    const result = await write(app, fixture[app].repository);
    assert.equal(result.status, 201);
    assert.equal(result.body.github.state, 'published');
    assert.match(result.body.github.url, new RegExp('github.com/' + fixture[app].repository + '/'));
  }
  const mutations = requests.filter(entry => entry.method === 'PUT');
  assert.equal(mutations.length, 2);
  for (const [index, mutation] of mutations.entries()) {
    assert.equal(mutation.credential, 'Bearer ' + [env.ONE, env.TWO][index].GITHUB_PROPOSAL_TOKEN);
    assert.ok(mutation.url.startsWith('https://api.github.com/repos/' + fixture[index].repository + '/contents/'));
    const payload = JSON.parse(mutation.body);
    assert.equal(payload.branch, 'observatory-proposed-tasks');
    assert.equal(JSON.parse(Buffer.from(payload.content, 'base64').toString()).repository, fixture[index].repository);
  }
});

test('staging worker transport claims only in its own partition with both ingress and executor credentials', async t => {
  const { task, env } = setup(t);
  const applications = fixture;
  const engine = createCommandCore({ applications, validate: () => true, trustedIdentity: () => null,
    trustedWorkerIngress: (request, _env, context) => context?.origin === new URL(request.url).origin });
  const { body: registered } = await task(0, { op: 'register', operation_id: crypto.randomUUID(), fields: taskFields });
  const taskId = registered.task.id;
  assert.equal((await task(0, { op: 'command', task_id: taskId, expected_version: registered.version,
    operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } })).status, 200);
  const connect = (originIndex, { appIndex = originIndex, accessIndex = originIndex, keyIndex = originIndex } = {}) =>
    openCommandCoreStageConnector({
      endpoint: applications[originIndex].origin + '/worker/mcp', application: applications[appIndex].id,
      workerKey: env[applications[keyIndex].binding].OBSERVATORY_TASK_WORKER_KEY, siteServiceToken: 'fixture-secret',
      fetcher: (url, init) => {
        const headers = new Headers(init.headers);
        assert.equal(headers.get('OAI-Sites-Authorization'), 'Bearer fixture-secret');
        assert.equal(init.redirect, 'error');
        assert.equal(Object.hasOwn(JSON.parse(init.body).params.arguments ?? {}, 'worker_key'), false);
        return engine.fetch(new Request(url, init), env, { origin: applications[accessIndex].origin });
      },
    });
  const claim = { op: 'claim', worker_id: crypto.randomUUID(), operation_id: crypto.randomUUID(), task_ids: [taskId] };
  const tool = 'staging.task_engine_v1';
  const worker = connect(0);
  await worker.ready();
  await assert.rejects(connect(1, { accessIndex: 0 }).ready(), { status: 401 });
  await assert.rejects(connect(1, { keyIndex: 0 }).ready(), { status: 403 });
  await assert.rejects(connect(0, { appIndex: 1 }).call({ request: claim }, tool), { status: 403 });
  await assert.rejects(worker.call({ request: { op: 'list' } }, tool), { status: 403 });
  await assert.rejects(worker.call({ request: { op: 'command' } }, tool), { status: 403 });
  await assert.rejects(connect(1).call({ task_id: taskId }, 'staging.sync_task_telemetry'), { status: 404 });
  assert.equal((await worker.call({ task_id: taskId }, 'staging.sync_task_telemetry')).baseline, null);
  const claimed = await worker.call({ request: claim, worker_key: 'never-sent-in-the-body' }, tool);
  assert.equal(claimed.claim.task.id, taskId);
});

test('Project presentation and manual order persist in the authorized scope', async t => {
  const { call } = setup(t);
  const projects = '/api/projects';
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const peer = crypto.randomUUID();
  const fields = { name: 'Project', objective: 'Verify library settings', icon: 'rocket', accent: 'violet' };
  for (const [app, id] of [[0, first], [0, second], [1, peer]]) {
    const created = await call(app, projects, { op: 'create', id, fields });
    assert.equal(created.status, 201);
    assert.equal(created.body.project.icon, 'rocket');
    assert.equal(created.body.project.accent, 'violet');
  }
  for (const badFields of [{ icon: 'arbitrary' }, { accent: 'url(example)' }]) {
    assert.equal((await call(0, projects, { op: 'update', id: first, expected_version: 1, fields: badFields })).status, 400);
  }
  const order = { op: 'reorder', project_ids: [second, first], expected_version: 0 };
  assert.equal((await call(0, projects, { ...order, project_ids: [second, peer] })).status, 400);
  assert.equal((await call(0, projects, { ...order, project_ids: [second, second] })).status, 400);
  assert.equal((await call(0, projects, order, 'unassigned')).status, 403);
  assert.equal((await call(0, projects, order, undefined, { origin: fixture[1].origin })).status, 403);
  const writes = await Promise.all([call(0, projects, order), call(0, projects, { ...order, project_ids: [first, second] })]);
  assert.deepEqual(writes.map(write => write.status).sort(), [200, 409]);
  const persisted = (await call(0, projects)).body.manual_order;
  assert.deepEqual(persisted, writes.find(write => write.status === 200).body.manual_order);
  assert.equal(persisted.version, 1);
  assert.deepEqual((await call(1, projects)).body.manual_order, { version: 0, project_ids: [] });
  const verification = { 'x-observatory-verification': crypto.randomUUID() };
  assert.deepEqual((await call(0, projects, undefined, undefined, verification)).body.manual_order, { version: 0, project_ids: [] });
  const third = crypto.randomUUID();
  assert.equal((await call(0, projects, { op: 'create', id: third, fields })).status, 201);
  assert.equal((await call(0, projects, { ...order, expected_version: 1 })).status, 409);
  assert.deepEqual((await call(0, projects)).body.manual_order, persisted);
});

test('workspace settings persist, audit concurrent changes, and never reveal credentials', async t => {
  const { call } = setup(t);
  const path = '/api/settings';
  const initial = await call(0, path);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.preferences.version, 0);
  assert.equal(initial.body.preferences.values.project_sort, 'manual');
  assert.equal(initial.body.connections.github.credential_configured, true);
  assert.doesNotMatch(JSON.stringify(initial.body), /one-fixture|a{64}/);
  const change = { op: 'save', expected_version: 0, values: { project_sort: 'priority', density: 'compact' } };
  assert.equal((await call(0, path, { ...change, values: { density: 'bad' } })).status, 400);
  assert.equal((await call(0, path, { ...change, values: { repository: 'peer/repo' } })).status, 400);
  assert.equal((await call(0, path, change, 'unassigned')).status, 403);
  assert.equal((await call(0, path, change, undefined, { origin: fixture[1].origin })).status, 403);
  const saved = await call(0, path, change);
  assert.equal(saved.status, 200);
  assert.equal((await call(0, path, change)).status, 409);
  const current = await call(0, path);
  assert.equal(current.body.preferences.values.project_sort, 'priority');
  assert.equal(current.body.audit[0].values.density, 'compact');
  assert.equal((await call(1, path)).body.preferences.version, 0);
  assert.equal((await call(0, path, undefined, undefined, { 'x-observatory-verification': crypto.randomUUID() })).body.preferences.version, 0);
  const reset = await call(0, path, { op: 'reset', expected_version: 1, keys: ['project_sort'] });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.preferences.values.project_sort, 'manual');
  assert.equal(reset.body.preferences.values.density, 'compact');
  assert.equal((await call(0, path)).body.audit.length, 2);
});

test('Project milestone ordering and eligible Task moves preserve canonical records', async t => {
  const { call } = setup(t);
  const projects = '/api/projects';
  const from = crypto.randomUUID();
  const to = crypto.randomUUID();
  const fields = { name: 'Project', objective: 'Verify scope' };
  for (const id of [from, to]) {
    assert.equal((await call(0, projects, { op: 'create', id, fields })).status, 201);
  }
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  const peer = crypto.randomUUID();
  for (const [id, milestone_id] of [[from, first], [from, second], [to, peer]]) {
    assert.equal((await call(0, projects, { op: 'milestone', id, milestone_id, name: 'Milestone',
      acceptance: 'Review evidence', status: 'planned' })).status, 201);
  }
  const reorder = { op: 'reorder_milestones', id: from, expected_version: 1, milestone_ids: [second, first] };
  assert.equal((await call(0, projects, { ...reorder, milestone_ids: [second, peer] })).status, 400);
  assert.equal((await call(0, projects, reorder)).status, 200);
  assert.equal((await call(0, projects, reorder)).status, 409);
  const readFrom = () => call(0, projects + '/' + from);
  assert.deepEqual((await readFrom()).body.milestones.map(item => item.id), [second, first]);

  const parent = await call(0, projects, { op: 'register_task', id: from, operation_id: crypto.randomUUID(), fields: taskFields });
  const child = await call(0, projects, { op: 'register_task', id: from, operation_id: crypto.randomUUID(),
    fields: { ...taskFields, dependencies: [parent.body.task.id] } });
  const task_id = child.body.task.id;
  const source = await readFrom();
  assert.ok(source.body.task_prerequisites.some(item => item.task_id === task_id && item.id === parent.body.task.id &&
    item.status === 'unsatisfied'));
  const move = { op: 'move_task', id: to, source_project_id: from, task_id, expected_version: child.body.version };
  const result = await call(0, projects, move);
  assert.equal(result.status, 200);
  assert.equal((await call(0, projects, move)).status, 404);
  const after = await call(0, projects + '/' + to);
  assert.equal(after.body.tasks[0].id, task_id);
  assert.equal(after.body.tasks[0].version, child.body.version);
  assert.ok((await readFrom()).body.history.some(event => event.kind === 'task_moved_out' && event.task_id === task_id));
  await call(0, projects, { op: 'milestone_link', id: to, milestone_id: peer, task_id });
  assert.equal((await call(0, projects, { ...move, source_project_id: to, id: from })).status, 409);
});

test('Merge source discovery reads scoped Task and Project associations before an integration run exists', async t => {
  const { call, task } = setup(t);
  const projectId = crypto.randomUUID();
  const head = 'b'.repeat(40);
  const operationId = crypto.randomUUID();
  for (const app of [0, 1]) {
    const project = await call(app, '/api/projects', { op: 'create', id: projectId,
      fields: { name: app ? 'Peer project' : 'Delivery project', objective: 'Review source relationships' } });
    assert.equal(project.status, 201);
    const created = await call(app, '/api/projects', { op: 'register_task', id: projectId,
      operation_id: operationId, fields: { ...taskFields, title: app ? 'Peer review' : 'Source review' } });
    assert.equal(created.status, 201);
    const attached = await task(app, { op: 'command', task_id: created.body.task.id,
      expected_version: created.body.version, operation_id: crypto.randomUUID(),
      action: { type: 'associate', reference: { kind: 'pull_request', uri: 'https://github.com/' + fixture[app].repository + '/pull/81', revision: head } } });
    assert.equal(attached.status, 200);
  }
  const path = '/api/integrations/v1?pr_number=81';
  const primary = await call(0, path);
  assert.equal(primary.status, 200);
  assert.deepEqual(primary.body.associations.map(item => ({
    title: item.task.title, project: item.project?.name, revisions: item.references.map(ref => ref.revision),
  })), [{ title: 'Source review', project: 'Delivery project', revisions: [head] }]);
  assert.equal((await call(1, path)).body.associations[0].task.title, 'Peer review');
  assert.deepEqual((await call(0, path, undefined, undefined, { 'x-observatory-verification': crypto.randomUUID() })).body.associations, []);
  assert.equal((await call(0, path, undefined, 'unassigned')).status, 403);
  assert.equal((await call(0, '/api/integrations/v1?pr_number=81junk')).status, 400);
});

test('Activity reads recent Project events from the current owner and verification namespace', async t => {
  const { call } = setup(t);
  const verification = { 'x-observatory-verification': crypto.randomUUID() };
  const id = crypto.randomUUID();
  const operations = [
    { op: 'create', id, fields: { name: 'Activity project', objective: 'Verify scoped events' } },
    { op: 'update', id, expected_version: 1, fields: { name: 'Updated activity project' } },
    { op: 'milestone', id, milestone_id: crypto.randomUUID(), name: 'Delivery check', status: 'planned', acceptance: 'Check evidence' },
  ];
  for (const operation of operations) {
    assert.ok((await call(0, '/api/projects', operation, undefined, verification)).status < 300);
  }
  const live = await call(0, '/api/activity');
  assert.equal(live.status, 200);
  assert.deepEqual(live.body.project_events, []);
  assert.deepEqual((await call(1, '/api/activity', undefined, undefined, verification)).body.project_events, []);
  const scoped = await call(0, '/api/activity', undefined, undefined, verification);
  assert.equal(scoped.status, 200);
  assert.deepEqual(scoped.body.project_events.map(item => item.kind).sort(), ['milestone_changed', 'project_changed', 'project_created']);
  assert.ok(scoped.body.project_events.every(item => item.project.id === id && item.project.name === 'Updated activity project'));
  assert.ok(scoped.body.project_events.some(item => item.milestone?.name === 'Delivery check'));
  assert.equal((await call(0, '/api/activity', undefined, 'unassigned', verification)).status, 403);
  assert.equal((await call(0, '/api/activity', undefined, undefined, { 'x-observatory-verification': 'invalid' })).status, 400);
  assert.equal((await call(0, '/api/activity', {})).status, 405);
});

test('Settings data checks validate the active scoped Project history', async t => {
  const { call, one } = setup(t);
  const path = '/api/settings/data';
  const id = crypto.randomUUID();
  const created = await call(0, '/api/projects', { op: 'create', id,
    fields: { name: 'Data check fixture', objective: 'Verify the integrity of Project receipts' } });
  assert.equal(created.status, 201);
  const first = await call(0, path);
  assert.equal(first.status, 200);
  assert.equal(first.body.schema.status, 'current');
  assert.equal(first.body.schema.observed_migration_marker, '0019_project_task_move_history');
  assert.equal(first.body.integrity.status, 'passed');
  assert.equal(first.body.integrity.projects_without_receipts, 0);
  assert.equal(first.body.backup.status, 'unverified');
  assert.ok(Date.parse(first.body.checked_at) > 0);
  assert.doesNotMatch(JSON.stringify(first.body), /one-fixture|a{64}|synthetic-owner/);
  one.sqlite.prepare('DELETE FROM project_events WHERE project_id = ?').run(id);
  const affected = await call(0, path);
  assert.equal(affected.body.integrity.status, 'issues_found');
  assert.equal(affected.body.integrity.projects_without_receipts, 1);
  assert.equal((await call(1, path)).body.integrity.status, 'passed');
  assert.equal((await call(0, path, undefined, undefined, { 'x-observatory-verification': crypto.randomUUID() })).body.integrity.status, 'passed');
  assert.equal((await call(0, path, undefined, 'unassigned')).status, 403);
  assert.equal((await call(0, path, {})).status, 405);
});
