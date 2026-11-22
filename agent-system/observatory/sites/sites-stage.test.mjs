import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMigrations, openPartition } from './sqlite-runtime.mjs';
import { createSitesStage } from './sites-stage.mjs';

const applications = [
  { id: 'aetherwake', name: 'Aetherwake', repository: 'Kgray44/Aetherwake', origin: 'https://aetherwake.test.chatgpt.site', binding: 'AW' },
  { id: 'voyagewright', name: 'Voyagewright', repository: 'Kgray44/treasurehuntSoT', origin: 'https://voyagewright.test.chatgpt.site', binding: 'VW' },
];
const revision = 'a'.repeat(40);

test('two private Sites share an engine and keep durable Projects in distinct database bindings', async t => {
  const parts = applications.map(() => openPartition(':memory:'));
  for (const { sqlite } of parts) {
    applyMigrations(sqlite);
    t.after(() => sqlite.close());
  }
  const envs = parts.map(({ DB }, index) => ({
    DB, ECC_SITE_OWNER_ID: 'verified-user-' + index,
    ECC_FRONTEND_BRIDGE_KEY: 'f'.repeat(64), ECC_STORAGE_BRIDGE_KEY: 's'.repeat(64),
    ECC_AETHERWAKE_SITE_SERVICE_TOKEN: 'site-service-0', ECC_VOYAGEWRIGHT_SITE_SERVICE_TOKEN: 'site-service-1',
    AW_OBSERVATORY_TASK_WORKER_KEY: 'a'.repeat(64), VW_OBSERVATORY_TASK_WORKER_KEY: 'b'.repeat(64),
  }));
  let sites;
  const fetcher = (input, init) => {
    const request = new Request(input, init);
    const origin = new URL(request.url).origin;
    const index = applications.findIndex(app => app.origin === origin);
    if (index < 0) throw Error('Unexpected upstream request');
    assert.equal(request.headers.get('OAI-Sites-Authorization'), 'Bearer site-service-' + index);
    assert.equal(request.headers.has('oai-authenticated-user-id'), false);
    return sites[index].fetch(request, envs[index]);
  };
  const restart = () => {
    sites = applications.map(app => createSitesStage({ role: app.id, applications, fetcher, sourceRevision: revision }));
  };
  restart();
  const call = (index, path, body, identity = envs[index].ECC_SITE_OWNER_ID, headers = {}) => {
    const { origin } = applications[index];
    return sites[index].fetch(new Request(origin + path, {
      headers: { ...(identity ? { 'oai-authenticated-user-id': identity } : {}), ...headers,
        ...(body ? { origin, 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body), method: 'POST' } : {}),
    }), envs[index]);
  };

  const status = await Promise.all(applications.map((app, i) => call(i, '/api/status').then(result => result.json())));
  assert.deepEqual(status.map(entry => entry.application.repository), applications.map(app => app.repository));
  assert.ok(status.every(entry => entry.revision === revision));
  const created = await Promise.all(applications.map((app, i) => call(i, '/api/projects', {
    op: 'create', id: crypto.randomUUID(), fields: { name: app.name, objective: 'Qualify the staged integration' },
  })));
  assert.deepEqual(created.map(entry => entry.status), [201, 201]);
  const projects = await Promise.all(created.map(result => result.json()));
  restart();
  for (let index = 0; index < sites.length; index++) {
    const list = await (await call(index, '/api/projects')).json();
    assert.deepEqual(list.projects.map(project => project.id), [projects[index].project.id]);
    assert.equal((await call(index, '/api/projects/' + projects[1 - index].project.id)).status, 404);
    assert.equal((await call(index, '/api/projects', undefined, envs[1 - index].ECC_SITE_OWNER_ID)).status, 403);
  }
  assert.equal((await call(0, '/_ecc/frontend/api/projects', undefined, '', { 'x-ecc-bridge-key': 's'.repeat(64) })).status, 403);
  assert.equal((await call(1, '/_ecc/partition', undefined, '', { 'x-ecc-bridge-key': 'f'.repeat(64) })).status, 403);
  assert.equal((await call(0, '/api/projects', undefined, '', { 'x-ecc-bridge-key': 'f'.repeat(64) })).status, 403);
  assert.equal(parts[0].sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1);
  assert.equal(parts[1].sqlite.prepare('SELECT COUNT(*) AS count FROM projects').get().count, 1);
});
