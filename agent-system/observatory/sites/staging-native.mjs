import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkoutIdentity, checkWorkerStorage, executeAppServer, runClaim } from '../../../scripts/agent/observatory-task-worker.mjs';
import { openLocalRepairConnector } from '../../../scripts/agent/observatory-connector.mjs';
import { applyMigrations, openPartition } from './sqlite-runtime.mjs';
import { startStage } from './staging-fixture.mjs';

const runFile = promisify(execFile);
const application_id = 'aetherwake';
const repository = 'synthetic/observatory';
const taskUUID = crypto.randomUUID();
const task_id = 'task_' + taskUUID;
const executable = process.env.COMMAND_CORE_NATIVE_CODEX;
const storageGuard = process.env.COMMAND_CORE_RESERVE_GUARD;
const root = process.env.COMMAND_CORE_NATIVE_ROOT;
if (process.platform !== 'win32' || !executable || !root || !storageGuard) {
  throw Error('Windows, a signed-in Codex executable, an isolated root and Windows ReserveGuard are required');
}
const guard = ['powershell.exe', '-NoProfile', '-File', storageGuard, '-EstimatedCBytes', '536870912', '-EstimatedDBytes', '67108864'];
await checkWorkerStorage(guard, root);
const workspace = await realpath(await mkdtemp(join(root, 'command-core-native-stage-')));
const git = async (...args) => (await runFile('git', args, { cwd: workspace, windowsHide: true, timeout: 5000 })).stdout.trim();
await git('init', '-b', 'codex/aads-task-' + taskUUID);
await git('config', 'user.name', 'Synthetic Command Core Staging');
await git('config', 'user.email', 'synthetic@invalid.example');
await git('remote', 'add', 'origin', 'https://github.com/' + repository + '.git');
await writeFile(join(workspace, 'README.md'), 'Synthetic local staging fixture.\n');
await git('add', 'README.md');
await git('commit', '-m', 'Initialize synthetic staging fixture');
const revision = await git('rev-parse', 'HEAD');
const part = openPartition(join(workspace, '.git', 'staging.sqlite'));
applyMigrations(part.sqlite);
part.sqlite.prepare('INSERT INTO application_partition VALUES (1, ?, ?, ?)').run(application_id, repository, 'engineering');
const stage = await startStage(part, { revision });
try {
  const taskApi = body => stage.run('/api/task-engine/v1', body);
  const rpc = (name, args) => stage.run('/mcp', {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { ...args, application_id } },
  });
  const send = async request => {
    const reply = await rpc('task_engine_v1', { request, worker_key: 'w'.repeat(64) });
    const result = reply.body.result?.structuredContent;
    if (!result || result.status >= 400) throw Object.assign(Error('Stage worker operation rejected'), { status: result?.status ?? reply.status });
    return result;
  };
  const managedConnection = { repository, async call(args) {
    const reply = await rpc('sync_task_telemetry', args);
    const result = JSON.parse(reply.body.result.content[0].text);
    if (reply.body.result.isError) throw Object.assign(Error('Stage telemetry operation rejected'), { status: result.status });
    return result;
  } };
  const registered = await taskApi({ op: 'register', operation_id: taskUUID, fields: {
    title: 'Write synthetic staging receipt',
    objective: 'The supervising worker has already run the required Windows ReserveGuard against C: and D: and will independently read back the final artifact. Use apply_patch to create a UTF-8 file named stage-receipt.txt in this dedicated synthetic checkout with one line containing exactly COMMAND_CORE_NATIVE_STAGE_OK. Leave the change uncommitted. Use the live reserve check supplied by the supervising worker and avoid PowerShell, network calls and other files.',
    primary: 'backend', profile_id: 'backend', deliverables: ['stage-receipt.txt'], criteria: ['The only changed file is stage-receipt.txt with the requested text'],
  } });
  assert.equal(registered.status, 201);
  const admitted = await taskApi({ op: 'command', task_id, expected_version: 1,
    operation_id: crypto.randomUUID(), action: { type: 'admit', executor: 'codex' } });
  assert.equal(admitted.status, 200);
  const { claim } = await send({ op: 'claim', operation_id: crypto.randomUUID(), worker_id: crypto.randomUUID(), task_ids: [task_id] });
  await runClaim({ claim, send, workspace, executable, signal: AbortSignal.timeout(90_000),
    identify: (path, pin) => checkoutIdentity(path, pin, { repository }), managedConnection,
    providerStream: 'codex_app_server', execute: async options => {
      const connector = await openLocalRepairConnector({ cwd: workspace, executable, signal: options.signal });
      try {
        await options.onProviderProcess(connector.processId);
        return await executeAppServer(connector, options);
      } finally { connector.close(); }
    },
    admitStorage: () => checkWorkerStorage(guard, workspace),
  });
  const { body } = await taskApi({ op: 'get', task_id });
  const attempt = body.attempts.at(-1);
  assert.equal(body.lifecycle.state, 'verifying', JSON.stringify({ state: body.lifecycle.state, attemptState: attempt.state, kind: attempt.failure_kind, failure: attempt.failure }));
  assert.equal(attempt.id, claim.attempt.id);
  assert.equal(await git('rev-parse', 'HEAD'), attempt.candidate_revision);
  assert.equal(await git('diff', '--name-only', revision, attempt.candidate_revision), 'stage-receipt.txt');
  assert.equal((await readFile(join(workspace, 'stage-receipt.txt'), 'utf8')).trim(), 'COMMAND_CORE_NATIVE_STAGE_OK');
  const telemetry = await rpc('sync_task_telemetry', { task_id });
  const baseline = JSON.parse(telemetry.body.result.content[0].text).baseline;
  process.stdout.write(JSON.stringify({ lifecycle: body.lifecycle.state, candidate_verified: true, attempt_state: attempt.state,
    session_observed: Boolean(attempt.session_id), telemetry_records: baseline?.projection.records.length ?? 0,
    telemetry_events: baseline?.projection.events.length ?? 0 }) + '\n');
} finally {
  await stage.close();
  part.sqlite.close();
}
