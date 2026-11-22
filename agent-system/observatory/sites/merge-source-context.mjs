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
  const decoded = runs.results.slice(0, limit).map(row => ({ ...JSON.parse(row.record), updated_at: row.updated_at }));
  const associations = tasks.results.slice(0, limit).map(row => {
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
    return {
      task: { id: row.task_id, title: task.title },
      project: row.project_id ? { id: row.project_id, name: JSON.parse(row.metadata).name } : null,
      references: [...references.values()],
    };
  });
  return { status: 200, body: {
    associations, runs: decoded, truncated: tasks.results.length > limit || runs.results.length > limit,
  } };
}
