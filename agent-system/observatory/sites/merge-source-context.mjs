import { readTaskRows, storedTaskPrerequisites } from './task-engine.mjs';

const positive = number => Number.isSafeInteger(number) && number > 0;
const limit = 50;

export async function readMergeSourceContext({ db, owner, namespace, repository, number }) {
  if (!positive(number)) return { status: 400, body: { error: 'Invalid pull request number' } };
  const uri = 'https://github.com/' + repository + '/pull/' + number;
  const scope = [owner, namespace];
  const [tasks, runs] = await Promise.all([
    db.prepare(`
      SELECT t.task_id, t.record, t.engine, p.id AS project_id, p.metadata
      FROM proposals t
      LEFT JOIN projects p ON p.owner_id = t.owner_id AND p.namespace = t.namespace AND p.id = t.project_id
      WHERE t.owner_id = ?1 AND t.namespace = ?2 AND json_extract(t.record, '$.repository') = ?3
      AND (
        EXISTS (
          SELECT 1 FROM integration_runs r WHERE r.owner_id = t.owner_id AND r.namespace = t.namespace
            AND r.task_id = t.task_id AND r.pr_number = ?4 AND json_extract(r.record, '$.repository') = ?3
        )
        OR EXISTS (SELECT 1 FROM json_each(t.engine, '$.links') WHERE json_extract(value, '$.kind') = 'pull_request' AND json_extract(value, '$.uri') = ?5)
        OR EXISTS (SELECT 1 FROM json_each(t.engine, '$.evidence') WHERE json_extract(value, '$.kind') = 'pull_request' AND json_extract(value, '$.uri') = ?5)
      )
      ORDER BY t.task_id LIMIT ?6
    `).bind(...scope, repository, number, uri, limit + 1).all(),
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
