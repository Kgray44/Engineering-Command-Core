import { applicationId, repositoryName, uuid } from './application-config.mjs';
import { readBounded } from './github.mjs';
import { projectOperation } from './projects.mjs';
import { MAX_SYNC_BYTES } from './sync.mjs';
import { isTaskWorkerKey } from './task-engine.mjs';
import { sha256 } from './task-telemetry.mjs';
import { createWorker } from './worker.mjs';

const identityHeader = 'oai-authenticated-user-id';
const stagingWorkerOps = new Set(['claim', 'report', 'worker_pulse', 'recover_worker_candidate']);
const environmentKeys = [
  'DB', 'OBSERVATORY_TASK_ENGINE_OWNER_ID', 'OBSERVATORY_TASK_WORKER_KEY', 'OBSERVATORY_CI_OWNER_ID',
  'OBSERVATORY_INTEGRATION_MERGE_OWNER_ID', 'OBSERVATORY_INTEGRATION_PUBLISH_OWNER_ID',
  'OBSERVATORY_INTEGRATION_SOURCE_REPAIR_OWNER_ID', 'OBSERVATORY_INTEGRATION_TRANSFER_ENABLED', 'GITHUB_READ_TOKEN', 'GITHUB_PROPOSAL_TOKEN',
  'GITHUB_ACTIONS_TOKEN', 'GITHUB_INTEGRATION_MERGE_TOKEN', 'GITHUB_INTEGRATION_PUBLISH_TOKEN',
];
const secrets = environmentKeys.filter(key => key.endsWith('_KEY') || key.endsWith('_TOKEN'));
const toolSchema = {
  type: 'object', additionalProperties: false, required: ['application_id', 'request'],
  properties: { application_id: { type: 'string', pattern: applicationId.source }, verification: { type: 'string' },
    request: { type: 'object', required: ['op'], properties: {
      op: { enum: ['list', 'get', 'create', 'update', 'milestone', 'register_task', 'link_task', 'milestone_link', 'milestone_gate'] },
      id: { type: 'string', format: 'uuid', description: 'Project UUID' },
      expected_version: { type: 'integer', minimum: 1, description: 'Current row version for optimistic updates' },
      status: { enum: ['planned', 'active', 'paused', 'archived', 'verified', 'integrated', 'accepted'] },
      milestone_id: { type: 'string', format: 'uuid' },
      task_id: { type: 'string', description: 'Canonical Task ID' },
      operation_id: { type: 'string', format: 'uuid', description: 'Stable request UUID for Task registration' },
      name: { type: 'string', description: 'Milestone title' },
      acceptance: { type: 'string', description: 'Milestone acceptance requirements' },
      fields: { type: 'object', description: 'Project metadata or the canonical Task registration fields' },
    } } },
};
const response = (body, status = 200) => Response.json(body, {
  status, headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
});
const error = (message, status) => response({ error: message }, status);

function scopedEnvironment(env, binding) {
  return Object.fromEntries(environmentKeys.map(key => [key, env[binding]?.[key] ?? env[binding + '_' + key]]));
}

export function createCommandCore({ applications, portfolio = { id: 'engineering', name: 'Engineering' },
  legacyApplication, trustedIdentity, trustedWorkerIngress, ...workerOptions }) {
  if (typeof trustedIdentity !== 'function') throw Error('Verified request identity adapter required');
  if (!Array.isArray(applications) || !applications.length || !applicationId.test(portfolio.id)) throw Error('Invalid portfolio');
  const byId = new Map();
  const byOrigin = new Map();
  const bindings = new Set();
  const repositories = new Set();
  for (const config of applications) {
    const { id, name, repository, origin, binding } = config;
    if (typeof id !== 'string' || !applicationId.test(id) || typeof name !== 'string' || !name ||
      typeof repository !== 'string' || !repositoryName.test(repository) || repository.endsWith('/.') || repository.endsWith('/..') ||
      typeof binding !== 'string' || !/^[A-Z][A-Z0-9_]{0,47}$/.test(binding) ||
      typeof origin !== 'string' || !/^(?:https:\/\/|http:\/\/127\.0\.0\.1:)/.test(origin) || new URL(origin).origin !== origin ||
      byId.has(id) || byOrigin.has(origin) || bindings.has(binding) || repositories.has(repository.toLowerCase())) {
      throw Error('Invalid or duplicate application configuration');
    }
    bindings.add(binding);
    repositories.add(repository.toLowerCase());
    const application = Object.freeze({ id, name, repository, portfolio_id: portfolio.id });
    const worker = createWorker({ ...workerOptions, assets: config.assets ?? workerOptions.assets, application });
    const runtime = { application, worker, binding };
    byId.set(id, runtime);
    byOrigin.set(origin, runtime);
  }
  if (legacyApplication !== undefined && !byId.has(legacyApplication)) throw Error('Unknown legacy application');

  function resolve(env, owner, runtime) {
    if (!runtime) return null;
    const scoped = scopedEnvironment(env, runtime.binding);
    if (scoped.OBSERVATORY_TASK_ENGINE_OWNER_ID !== owner) return null;
    if (trustedWorkerIngress) {
      delete scoped.GITHUB_INTEGRATION_MERGE_TOKEN;
      delete scoped.GITHUB_ACTIONS_TOKEN;
      delete scoped.OBSERVATORY_INTEGRATION_TRANSFER_ENABLED;
      delete scoped.GITHUB_PROPOSAL_TOKEN;
      delete scoped.GITHUB_INTEGRATION_PUBLISH_TOKEN;
    }
    return scoped;
  }

  async function checkPartition(env, runtime, scoped) {
    if (!scoped.DB) return false;
    for (const other of byId.values()) {
      if (other === runtime) continue;
      const peer = scopedEnvironment(env, other.binding);
      if (scoped.DB === peer.DB || secrets.some(key => scoped[key] && secrets.some(otherKey => scoped[key] === peer[otherKey]))) {
        return false;
      }
    }
    const binding = await scoped.DB.prepare('SELECT application_id, repository, portfolio_id FROM application_partition WHERE singleton = 1 AND NOT EXISTS (SELECT 1 FROM migration_receipt)')
      .bind().first();
    return binding?.application_id === runtime.application.id && binding?.repository === runtime.application.repository &&
      binding?.portfolio_id === portfolio.id;
  }

  async function project(runtime, scoped, owner, verification, body) {
    if (verification !== undefined && (typeof verification !== 'string' || !uuid.test(verification))) {
      return { status: 400, body: { error: 'Invalid verification namespace' } };
    }
    const namespace = verification ? 'verification:' + verification : 'live';
    return projectOperation({ db: scoped.DB, owner, namespace, application: runtime.application, body,
      registerTask: (projectId, task) => runtime.worker.registerProjectTask({ env: scoped, owner, namespace, body: task, projectId }),
    });
  }

  async function workerRequest(request, env, context, runtime, url) {
    if (!trustedWorkerIngress || !await trustedWorkerIngress(request, env, context)) {
      return error('Worker ingress authorization required', 401);
    }
    const owner = scopedEnvironment(env, runtime.binding).OBSERVATORY_TASK_ENGINE_OWNER_ID;
    const scoped = owner && resolve(env, owner, runtime);
    const workerKey = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!scoped || !isTaskWorkerKey(workerKey) || !isTaskWorkerKey(scoped.OBSERVATORY_TASK_WORKER_KEY) ||
        await sha256(workerKey) !== await sha256(scoped.OBSERVATORY_TASK_WORKER_KEY)) {
      return error('Executor authorization required', 403);
    }
    if (request.method !== 'POST') return error('Method not allowed', 405);
    if (request.headers.has('origin') || request.headers.has('sec-fetch-site')) return error('Worker client required', 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return error('Expected JSON', 415);
    }
    if (!await checkPartition(env, runtime, scoped)) return error('Application partition unavailable', 503);
    let message;
    try { message = JSON.parse(await readBounded(request.body, MAX_SYNC_BYTES)); }
    catch { return error('Invalid or oversized RPC request', 400); }
    if (message?.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof message.id)) return error('Invalid RPC envelope', 400);
    if (message.method === 'server/discover') {
      return response({ jsonrpc: '2.0', id: message.id, result: { supportedVersions: ['2026-07-28'] } });
    }
    const { name, arguments: args } = message.params ?? {};
    if (message.method !== 'tools/call' || args?.application_id !== runtime.application.id) {
      return error('Worker application scope required', 403);
    }
    const { application_id: _applicationId, ...params } = args;
    if (name === 'task_engine_v1' && stagingWorkerOps.has(params.request?.op)) {
      params.worker_key = workerKey;
    } else if (name === 'sync_task_telemetry') {
      if (typeof params.task_id !== 'string' || params.verification !== undefined &&
          (typeof params.verification !== 'string' || !uuid.test(params.verification))) return error('Invalid Task telemetry scope', 400);
      const namespace = params.verification ? 'verification:' + params.verification : 'live';
      const task = await scoped.DB.prepare('SELECT task_id FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ? AND engine IS NOT NULL')
        .bind(owner, namespace, params.task_id).first();
      if (!task) return error('Task unavailable in this application', 404);
    } else return error('Worker scope does not allow this operation', 403);
    const forwarded = new Request(new URL('/mcp', url), {
      method: 'POST', headers: { [identityHeader]: owner, 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, params: { name, arguments: params } }),
    });
    return runtime.worker.fetch(forwarded, scoped);
  }

  return {
    async fetch(request, env, context) {
      const url = new URL(request.url);
      if (url.pathname === '/healthz' && request.method === 'GET') return response({ status: 'ready', service: 'engineering-command-core' });
      const originRuntime = byOrigin.get(url.origin);
      if (!originRuntime) return error('Application origin unavailable', 404);
      try {
        if (trustedWorkerIngress && url.pathname === '/worker/mcp') return await workerRequest(request, env, context, originRuntime, url);
        const owner = await trustedIdentity(request, env, context);
        if (!owner) return error('Authenticated caller required', 401);
        const headers = new Headers(request.headers);
        headers.set(identityHeader, owner);
        request = new Request(request, { headers });
        if (url.pathname === '/mcp') {
          if (request.method !== 'POST') return error('Method not allowed', 405);
          const origin = request.headers.get('origin');
          if ((origin !== null && origin !== url.origin) ||
              ![null, 'none', 'same-origin'].includes(request.headers.get('sec-fetch-site'))) return error('Cross-origin request rejected', 403);
          if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return error('Expected JSON', 415);
          let message;
          try { message = JSON.parse(await readBounded(request.body, MAX_SYNC_BYTES)); }
          catch { return error('Invalid or oversized RPC request', 400); }
          const allowed = [...byId.values()].filter(app => resolve(env, owner, app));
          if (!allowed.length) return error('Application access denied', 403);
          if (message?.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof message.id)) return error('Invalid RPC envelope', 400);
          const rpc = result => response({ jsonrpc: '2.0', id: message.id, result });
          const reject = (code, messageText) => response({ jsonrpc: '2.0', id: message.id, error: { code, message: messageText } });
          const named = message.params?.name;
          const args = message.params?.arguments ?? {};
          const forward = (runtime, scoped, payload) => runtime.worker.fetch(new Request(url, {
            method: 'POST', headers: request.headers, body: JSON.stringify(payload),
          }), scoped);
          if (message.method === 'tools/list') {
            const app = allowed[0];
            const original = await (await forward(app, resolve(env, owner, app), message)).json();
            const existing = original.result.tools.map(tool => ({ ...tool, inputSchema: { ...tool.inputSchema,
              properties: { ...tool.inputSchema.properties, application_id: toolSchema.properties.application_id },
            } }));
            return rpc({ tools: [...existing, { name: 'projects_v1', description: 'List and manage scoped engineering Projects', inputSchema: toolSchema },
              { name: 'list_applications', description: 'List engineering applications assigned to the authenticated caller',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} } }] });
          }
          if (message.method !== 'tools/call') return forward(allowed[0], resolve(env, owner, allowed[0]), message);
          if (typeof args !== 'object' || !args || Array.isArray(args)) return reject(-32602, 'Invalid tool arguments');
          if (named === 'list_applications') {
            if (Object.keys(args).length) return reject(-32602, 'Unexpected arguments');
            const structuredContent = { portfolio, applications: allowed.map(app => app.application) };
            return rpc({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] });
          }
          const { application_id: selected, ...params } = args;
          const compatible = named !== 'projects_v1' && originRuntime.application.id === legacyApplication;
          if (selected === undefined && !compatible || selected !== undefined && (typeof selected !== 'string' || !applicationId.test(selected))) {
            return reject(-32602, 'Explicit application identity required');
          }
          const runtime = byId.get(selected ?? legacyApplication);
          const scoped = resolve(env, owner, runtime);
          if (!scoped) return error('Application access denied', 403);
          if (!await checkPartition(env, runtime, scoped)) return error('Application partition unavailable', 503);
          if (named === 'projects_v1') {
            if (Object.keys(params).some(key => !['verification', 'request'].includes(key))) return reject(-32602, 'Invalid Projects arguments');
            const result = await project(runtime, scoped, owner, params.verification, params.request);
            const structuredContent = { status: result.status, ...result.body };
            return rpc({ structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }], isError: result.status >= 400 });
          }
          return forward(runtime, scoped, { ...message, params: { name: named, arguments: params } });
        }
        const scoped = resolve(env, owner, originRuntime);
        if (!scoped) return error('Application access denied', 403);
        if (url.pathname === '/api/applications' && request.method === 'GET') {
          return response({ portfolio, applications: [...byId.values()].filter(app => resolve(env, owner, app)).map(app => app.application) });
        }
        if (!await checkPartition(env, originRuntime, scoped)) return error('Application partition unavailable', 503);
        if (url.pathname === '/api/status' && request.method === 'GET') {
          return response({ status: 'ready', application: originRuntime.application, revision: workerOptions.sourceRevision ?? null });
        }
        if (url.pathname === '/api/projects' || url.pathname.startsWith('/api/projects/')) {
          let body;
          if (request.method === 'GET') body = url.pathname === '/api/projects' ? { op: 'list' } : { op: 'get', id: url.pathname.slice('/api/projects/'.length) };
          else if (request.method === 'POST' && url.pathname === '/api/projects') {
            if (request.headers.get('origin') !== url.origin || ![null, 'same-origin'].includes(request.headers.get('sec-fetch-site'))) {
              return error('Same-origin request required', 403);
            }
            if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return error('Expected JSON', 415);
            try { body = JSON.parse(await readBounded(request.body, MAX_SYNC_BYTES)); }
            catch { return error('Invalid Projects payload', 400); }
          } else return error('Method not allowed', 405);
          const result = await project(originRuntime, scoped, owner, request.headers.get('x-observatory-verification') ?? undefined, body);
          return response(result.body, result.status);
        }
        return originRuntime.worker.fetch(request, scoped);
      } catch {
        return error('Engineering data temporarily unavailable. Read current state before retrying writes.', 503);
      }
    },
  };
}
