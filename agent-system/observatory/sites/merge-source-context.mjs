import { readTaskRows, storedTaskPrerequisites } from './task-engine.mjs';

const positive = number => Number.isSafeInteger(number) && number > 0;
const limit = 50;
const discoveryLimit = 200;
const discoveryFeedLimit = 40;

const sourceTasks = `
  WITH requested(number, uri) AS (
    SELECT value, 'https://github.com/' || ?3 || '/pull/' || value FROM json_each(?4)
  ), linked(number, task_id) AS (
    SELECT q.number, r.task_id FROM integration_runs r JOIN requested q ON q.number = r.pr_number
      WHERE r.owner_id = ?1 AND r.namespace = ?2 AND r.task_id IS NOT NULL
        AND json_extract(r.record, '$.repository') = ?3
    UNION
    SELECT q.number, t.task_id FROM proposals t
      JOIN json_each(t.engine, '$.links') ref
      JOIN requested q ON q.uri = json_extract(ref.value, '$.uri')
      WHERE t.owner_id = ?1 AND t.namespace = ?2 AND json_extract(ref.value, '$.kind') = 'pull_request'
    UNION
    SELECT q.number, t.task_id FROM proposals t
      JOIN json_each(t.engine, '$.evidence') ref
      JOIN requested q ON q.uri = json_extract(ref.value, '$.uri')
      WHERE t.owner_id = ?1 AND t.namespace = ?2 AND json_extract(ref.value, '$.kind') = 'pull_request'
  )`;
const scopedLinks = `
  FROM linked l JOIN proposals t ON t.task_id = l.task_id AND t.owner_id = ?1 AND t.namespace = ?2
  LEFT JOIN projects p ON p.owner_id = t.owner_id AND p.namespace = t.namespace AND p.id = t.project_id
  WHERE json_extract(t.record, '$.repository') = ?3
`;

export async function readMergeDiscoveryLinks({ db, owner, namespace, repository, query }) {
  if (typeof query !== 'string' || query.length > discoveryFeedLimit * 17 - 1) return { status: 400, body: { error: 'Invalid linked PR query' } };
  const ids = query.split(',');
  const numbers = ids.map(Number);
  if (numbers.length > discoveryFeedLimit || !numbers.every((number, index) => positive(number) && String(number) === ids[index])) {
    return { status: 400, body: { error: 'Invalid linked PR query' } };
  }
  const { results } = await db.prepare(sourceTasks + `
    SELECT l.number, json_extract(t.record, '$.title') AS task, json_extract(p.metadata, '$.name') AS project
    ` + scopedLinks + ' ORDER BY l.number, t.task_id LIMIT ?5')
    .bind(owner, namespace, repository, JSON.stringify([...new Set(numbers)]), discoveryLimit + 1).all();
  return { status: 200, body: { matches: results.slice(0, discoveryLimit), truncated: results.length > discoveryLimit } };
}

export async function readMergeSourceContext({ db, owner, namespace, repository, number }) {
  if (!positive(number)) return { status: 400, body: { error: 'Invalid pull request number' } };
  const uri = 'https://github.com/' + repository + '/pull/' + number;
  const scope = [owner, namespace];
  const [tasks, runs] = await Promise.all([
    db.prepare(sourceTasks + ' SELECT t.task_id, t.record, t.engine, p.id AS project_id, p.metadata ' +
      scopedLinks + ' ORDER BY t.task_id LIMIT ?5').bind(...scope, repository, JSON.stringify([number]), limit + 1).all(),
    db.prepare(`
      SELECT record, updated_at FROM integration_runs
      WHERE owner_id = ? AND namespace = ? AND pr_number = ? AND json_extract(record, '$.repository') = ?
      ORDER BY updated_at DESC, id DESC LIMIT ?
    `).bind(...scope, number, repository, limit + 1).all(),
  ]);
  const linked = tasks.results.slice(0, limit);
  const linkedIds = linked.map(row => row.task_id);
  const taskIds = [...new Set([...linkedIds, ...linked.flatMap(row => JSON.parse(row.record).prerequisites.task_ids)])];
  const [dependencyRows, gates] = linked.length ? await Promise.all([
    readTaskRows({ db, owner, namespace, taskIds, reconcileExpired: false }),
    db.prepare(`
      SELECT g.task_id, g.milestone_id, m.project_id, m.name, m.status
      FROM project_task_gates g LEFT JOIN milestones m
        ON m.owner_id = g.owner_id AND m.namespace = g.namespace AND m.id = g.milestone_id
      WHERE g.owner_id = ? AND g.namespace = ? AND g.task_id IN (SELECT value FROM json_each(?))
      ORDER BY g.task_id, g.milestone_id
    `).bind(...scope, JSON.stringify(linkedIds)).all(),
  ]) : [[], { results: [] }];
  const rows = new Map(dependencyRows.filter(row => JSON.parse(row.record).repository === repository)
    .map(row => [row.task_id, row]));
  const decoded = runs.results.slice(0, limit).map(row => ({ ...JSON.parse(row.record), updated_at: row.updated_at }));
  const associations = linked.map(row => {
    const task = JSON.parse(row.record);
    const engine = JSON.parse(row.engine ?? '{}');
    const references = new Map();
    for (const value of [...(engine.evidence ?? []), ...(engine.links ?? [])]) {
      if (value.kind === 'pull_request' && value.uri === uri) {
        references.set(value.revision, { revision: value.revision, uri, source: 'task_record' });
      }
    }
    for (const run of decoded) {
      if (run.task?.id === row.task_id && !references.has(run.head_sha)) {
        references.set(run.head_sha, { revision: run.head_sha, uri, source: 'integration_run' });
      }
    }
    const prerequisites = storedTaskPrerequisites(row, rows).map(check => {
      const source = check.type === 'task' && rows.get(check.id);
      return { ...check, ...(source ? { title: JSON.parse(source.record).title } : {}) };
    });
    for (const gate of gates.results.filter(item => item.task_id === row.task_id)) {
      prerequisites.push({ type: 'milestone', id: gate.milestone_id, title: gate.name, project_id: gate.project_id,
        state: gate.status ?? 'missing', status: gate.status === 'accepted' ? 'satisfied' : gate.status ? 'unsatisfied' : 'unverified' });
    }
    return {
      prerequisites,
      task: { id: row.task_id, title: task.title },
      project: row.project_id ? { id: row.project_id, name: JSON.parse(row.metadata).name } : null,
      references: [...references.values()],
    };
  });
  return { status: 200, body: {
    associations, runs: decoded, truncated: tasks.results.length > limit || runs.results.length > limit,
  } };
}
