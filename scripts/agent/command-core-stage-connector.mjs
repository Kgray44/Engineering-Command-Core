export function openCommandCoreStageConnector({ endpoint, application, workerKey, siteServiceToken, fetcher = fetch }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.pathname !== '/worker/mcp' || url.search || url.hash || url.username || url.password ||
      !application || !workerKey || !siteServiceToken) throw Error('Invalid staged worker connection');
  const headers = {
    'content-type': 'application/json',
    authorization: 'Bearer ' + workerKey,
    'OAI-Sites-Authorization': 'Bearer ' + siteServiceToken,
  };
  let sequence = 0;
  async function rpc(method, params, signal) {
    const id = ++sequence;
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetcher(url, {
      method: 'POST', redirect: 'error', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw Object.assign(Error('Staged Command Core connection rejected'), { status: response.status });
    const reply = await response.json();
    if (reply.jsonrpc !== '2.0' || reply.id !== id || !reply.result || reply.error) {
      throw Error('Invalid staged Command Core reply');
    }
    return reply.result;
  }
  return {
    close() {},
    async ready(signal) {
      const discovery = await rpc('server/discover', {}, signal);
      if (!discovery.supportedVersions?.includes('2026-07-28')) throw Error('Staged worker protocol is unavailable');
    },
    async call(args, tool, { signal } = {}) {
      const { worker_key: _workerKey, ...parameters } = args;
      const name = tool.split('.').at(-1);
      const result = await rpc('tools/call', { name, arguments: { ...parameters, application_id: application } }, signal);
      const value = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
      if (result.isError || value.error || (value.status !== undefined && (value.status < 200 || value.status >= 300))) {
        const error = Object.assign(Error('Staged Command Core operation rejected'), { status: value.status });
        if (value.error === 'Task graph changed. Reload or replay the same operation ID.') error.code = 'task_version_conflict';
        if (value.error === 'Attempt lease is stale or invalid') error.code = 'lease_rejected';
        throw error;
      }
      return value;
    },
  };
}
