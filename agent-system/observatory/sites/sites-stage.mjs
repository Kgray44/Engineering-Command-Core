import { createCommandCore } from './command-core.mjs';
import { readBounded } from './github.mjs';
import { MAX_SYNC_BYTES } from './sync.mjs';
import { sha256 } from './task-telemetry.mjs';

const frontendPrefix = '/_ecc/frontend';
const partitionPath = '/_ecc/partition';
const identityPath = '/_ecc/identity';
const identityHeader = 'oai-authenticated-user-id';
const bridgeHeader = 'x-ecc-bridge-key';
const owner = 'ecc-stage-owner';
const methods = new Set(['first', 'all', 'run']);
const forwardedHeaders = ['authorization', 'content-type', 'origin', 'sec-fetch-site', 'x-observatory-verification',
  'x-observatory-sync-scope', 'x-observatory-request-id', 'x-observatory-publish'];
const reject = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'private, no-store' } });

async function authorizedBridge(request, expected) {
  const presented = request.headers.get(bridgeHeader);
  return !request.headers.has(identityHeader) && typeof expected === 'string' && expected.length >= 32 &&
    presented?.length === expected.length && await sha256(presented) === await sha256(expected);
}

function serviceHeaders(token, key) {
  if (!token || !key) throw Error('Private Sites bridge is unconfigured');
  return { 'OAI-Sites-Authorization': 'Bearer ' + token, [bridgeHeader]: key };
}

function forwardHeaders(request) {
  return new Headers(forwardedHeaders.filter(name => request.headers.has(name)).map(name => [name, request.headers.get(name)]));
}

function serviceRequest(url, request, headers) {
  return new Request(url, { method: request.method, headers,
    ...(request.body ? { body: request.body, duplex: 'half' } : {}) });
}

async function fetchBridge(fetcher, label, input, init) {
  try {
    const reply = await fetcher(input, { ...init, redirect: 'manual' });
    if (reply.status >= 300 && reply.status < 400) {
      await reply.body?.cancel();
      throw Error('Unexpected upstream redirect (' + reply.status + ')');
    }
    if (!reply.ok) console.warn('Command Core staging bridge HTTP status', label, reply.status);
    return reply;
  } catch (cause) {
    console.warn('Command Core staging bridge transport failed', label, cause.name, String(cause.message).slice(0, 160));
    throw cause;
  }
}

function databaseBridge(origin, env, fetcher) {
  return { prepare: sql => ({ bind: (...values) => Object.fromEntries([...methods].map(method => [method, async () => {
    const reply = await fetchBridge(fetcher, 'Voyagewright database', origin + partitionPath, {
      method: 'POST',
      headers: { ...serviceHeaders(env.ECC_VOYAGEWRIGHT_SITE_SERVICE_TOKEN, env.ECC_STORAGE_BRIDGE_KEY),
        'content-type': 'application/json' },
      body: JSON.stringify({ sql, values, method }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!reply.ok) throw Error('Voyagewright database unavailable');
    return (await reply.json()).result;
  }])) }) };
}

async function partitionRequest(request, env, application, portfolio) {
  if (!await authorizedBridge(request, env.ECC_STORAGE_BRIDGE_KEY)) return reject('Storage bridge authorization required', 403);
  if (request.method !== 'POST') return reject('Method not allowed', 405);
  let body;
  try { body = JSON.parse(await readBounded(request.body, 3 * MAX_SYNC_BYTES)); }
  catch { return reject('Invalid partition request', 400); }
  if (!methods.has(body?.method) || typeof body.sql !== 'string' || !Array.isArray(body.values) ||
      body.values.some(value => value !== null && !['string', 'number'].includes(typeof value))) {
    return reject('Invalid partition operation', 400);
  }
  await initializePartition(env.DB, application, portfolio);
  const result = await env.DB.prepare(body.sql).bind(...body.values)[body.method]();
  return Response.json({ result }, { headers: { 'cache-control': 'private, no-store' } });
}

async function initializePartition(db, application, portfolio) {
  if (!db) throw Error('Private Site database is missing');
  const existing = await db.prepare('SELECT application_id FROM application_partition WHERE singleton = 1').bind().first();
  if (!existing) await db.prepare('INSERT OR IGNORE INTO application_partition VALUES (1, ?, ?, ?)')
    .bind(application.id, application.repository, portfolio).run();
}

export function createSitesStage({ role, applications, portfolio = { id: 'engineering', name: 'Engineering' },
  fetcher = fetch, ...options }) {
  const aetherwake = applications.find(app => app.id === 'aetherwake');
  const voyagewright = applications.find(app => app.id === 'voyagewright');
  if (applications.length !== 2 || !aetherwake || !voyagewright || !['aetherwake', 'voyagewright'].includes(role) ||
      !applications.every(app => /^https:\/\/[^/]+\.chatgpt\.site$/.test(app.origin)) ||
      aetherwake.origin === voyagewright.origin) throw Error('Two distinct private ChatGPT Sites are required');
  const isEngine = role === 'aetherwake';
  const site = isEngine ? aetherwake : voyagewright;
  const core = isEngine ? createCommandCore({ ...options, applications, portfolio, fetcher,
    trustedIdentity: (_request, _env, context) => context?.visitor ? owner : null,
    trustedWorkerIngress: (_request, _env, context) => context?.worker === true,
  }) : null;

  return { async fetch(request, env) {
    const url = new URL(request.url);
    const user = request.headers.get(identityHeader);
    const visitor = Boolean(user && user === env.ECC_SITE_OWNER_ID);
    if (url.origin !== site.origin) return reject('Unexpected Site origin', 404);
    if (url.pathname === identityPath && request.method === 'GET') {
      return user ? Response.json({ user }, { headers: { 'cache-control': 'private, no-store' } }) :
        reject('Site sign-in required', 401);
    }
    try {
      if (!isEngine) {
        if (url.pathname === partitionPath) return await partitionRequest(request, env, site, portfolio.id);
        const worker = !user && url.pathname === '/worker/mcp';
        if (!visitor && !worker) return reject('Staging owner access required', 403);
        if (url.pathname === '/mcp' || url.pathname.startsWith('/_ecc/')) return reject('Unknown Site route', 404);
        const target = new URL(aetherwake.origin);
        target.pathname = frontendPrefix + url.pathname;
        target.search = url.search;
        const headers = forwardHeaders(request);
        for (const [key, value] of Object.entries(serviceHeaders(env.ECC_AETHERWAKE_SITE_SERVICE_TOKEN, env.ECC_FRONTEND_BRIDGE_KEY))) {
          headers.set(key, value);
        }
        const forwarded = serviceRequest(target, request, headers);
        return await fetchBridge(fetcher, 'canonical frontend', forwarded, { signal: AbortSignal.timeout(25_000) });
      }
      let effective = request;
      const worker = url.pathname === '/worker/mcp' && !user;
      let identity = { worker, visitor };
      if (url.pathname.startsWith(frontendPrefix + '/')) {
        if (!await authorizedBridge(request, env.ECC_FRONTEND_BRIDGE_KEY)) return reject('Frontend bridge authorization required', 403);
        const target = new URL(voyagewright.origin);
        target.pathname = url.pathname.slice(frontendPrefix.length);
        target.search = url.search;
        if (target.pathname === '/mcp' || target.pathname.startsWith('/_ecc/')) return reject('Unknown Site route', 404);
        effective = serviceRequest(target, request, forwardHeaders(request));
        const workerPath = target.pathname === '/worker/mcp';
        identity = { visitor: !workerPath, worker: workerPath };
      }
      if (!identity.visitor && !identity.worker) return reject('Staging owner access required', 403);
      await initializePartition(env.DB, aetherwake, portfolio.id);
      const remote = databaseBridge(voyagewright.origin, env, fetcher);
      const scoped = {
        ...env,
        [aetherwake.binding + '_DB']: env.DB,
        [voyagewright.binding + '_DB']: remote,
        [aetherwake.binding + '_OBSERVATORY_TASK_ENGINE_OWNER_ID']: owner,
        [voyagewright.binding + '_OBSERVATORY_TASK_ENGINE_OWNER_ID']: owner,
      };
      return await core.fetch(effective, scoped, identity);
    } catch {
      return reject('Staging service unavailable. Read current state before retrying writes.', 503);
    }
  } };
}
