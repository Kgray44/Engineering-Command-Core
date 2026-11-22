import { createServer } from 'node:http';
import { createCommandCore } from './command-core.mjs';

const owner = 'synthetic-staging-owner';
const workerKey = 'w'.repeat(64);
const proof = 'synthetic-transport-auth';
const fixtureRevision = 'a'.repeat(40);
const appId = 'aetherwake';
const repository = 'synthetic/observatory';
export async function startStage(part, { assets = {}, revision = fixtureRevision } = {}) {
  let core;
  let origin;
  const env = { FIRST: { DB: part.DB, OBSERVATORY_TASK_ENGINE_OWNER_ID: owner, OBSERVATORY_TASK_WORKER_KEY: workerKey } };
  const server = createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method;
      const request = new Request(origin + incoming.url, {
        headers: incoming.headers, method, ...(method === 'POST' ? { body: incoming, duplex: 'half' } : {}),
      });
      const response = await core.fetch(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  core = createCommandCore({
    legacyApplication: appId,
    applications: [{ id: appId, name: 'Synthetic staging application', repository, origin, binding: 'FIRST' }],
    trustedIdentity: request => request.headers.get('authorization') === 'Bearer ' + proof ? owner : null,
    validate: () => true, validateEvent: () => true, assets, sourceRevision: revision,
    fetcher: async url => String(url).endsWith('/git/ref/heads/main')
      ? Response.json({ ref: 'refs/heads/main', object: { sha: revision } }) : new Response('', { status: 404 }),
  });
  return {
    origin, proof,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    run: async (path, body, authenticated = true) => {
      const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
        origin, 'content-type': 'application/json', 'oai-authenticated-user-id': 'spoofed',
        ...(authenticated ? { authorization: 'Bearer ' + proof } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    },
  };
}
