import { uuid } from './application-config.mjs';

const statuses = ['planned', 'active', 'paused', 'archived'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const milestones = ['planned', 'verified', 'integrated', 'accepted'];
const metadataFields = {
  name: 150, description: 4000, objective: 16000, scope: 16000, acceptance: 16000,
  start_date: 10, target_date: 10, technical_state: 50, owner_review: 50,
};
const success = (body, status = 200) => ({ status, body });
const fail = (status, error) => success({ error }, status);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
const isId = value => typeof value === 'string' && uuid.test(value);
const taskId = value => typeof value === 'string' && value.startsWith('task_') && isId(value.slice(5));

function projectFields(fields, repository) {
  if (!isObject(fields)) throw Error('Project fields required');
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Object.hasOwn(metadataFields, key)) {
      if (typeof value !== 'string' || value.length > metadataFields[key]) throw Error('Invalid ' + key);
      if (key.endsWith('_date') && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw Error('Invalid date');
      result[key] = value.trim();
    } else if (key === 'priority' && priorities.includes(value)) {
      result[key] = value;
    } else if (key === 'participants' && Array.isArray(value) && value.length <= 30 &&
        value.every(item => typeof item === 'string' && item.trim() && item.length <= 150)) {
      result[key] = [...new Set(value.map(item => item.trim()))];
    } else if (key === 'repositories' && Array.isArray(value) && value.every(item => item === repository)) {
      result[key] = [...new Set(value)];
    } else {
      throw Error('Invalid project field');
    }
  }
  return result;
}

export async function projectOperation({ db, owner, namespace, application, body, registerTask }) {
  if (!isObject(body)) return fail(400, 'Invalid Projects request');
  const scope = (sql, ...args) => db.prepare(sql).bind(owner, namespace, ...args);
  const getProject = id => scope('SELECT * FROM projects WHERE owner_id = ? AND namespace = ? AND id = ?', id).first();
  const serialize = row => ({
    ...JSON.parse(row.metadata), id: row.id, application_id: application.id, owner: row.owner_id,
    status: row.status, version: row.version, created_at: row.created_at, updated_at: row.updated_at,
  });
  if (body.op === 'list') {
    const [{ results }, unassigned] = await Promise.all([
      scope('SELECT * FROM projects WHERE owner_id = ? AND namespace = ? ORDER BY updated_at DESC, id').all(),
      scope('SELECT count(*) AS total FROM proposals WHERE owner_id = ? AND namespace = ? AND project_id IS NULL').first(),
    ]);
    return success({ application, projects: results.map(serialize), unassigned_tasks: unassigned.total });
  }
  if (!isId(body.id)) return fail(400, 'Invalid Project ID');
  const at = new Date().toISOString();
  if (body.op === 'create') {
    let fields;
    try { fields = projectFields(body.fields, application.repository); }
    catch (error) { return fail(400, error.message); }
    if (!fields.name || !fields.objective) return fail(400, 'Name and objective required');
    if (fields.start_date && fields.target_date && fields.start_date > fields.target_date) return fail(400, 'Target follows start date');
    const prior = await getProject(body.id);
    const metadata = { priority: 'normal', repositories: [application.repository], ...fields };
    if (prior) {
      const initial = await scope('SELECT metadata FROM project_events WHERE owner_id = ? AND namespace = ? AND project_id = ? AND version = 1', body.id).first();
      return initial.metadata === JSON.stringify(metadata)
        ? success({ project: serialize(prior) }) : fail(409, 'Project identity already used');
    }
    const row = await scope("INSERT INTO projects (owner_id, namespace, id, status, metadata, created_at, updated_at) VALUES (?, ?, ?, 'planned', ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *",
      body.id, JSON.stringify(metadata), at, at).first();
    return row ? success({ project: serialize(row) }, 201) : fail(409, 'Project changed. Read current state before retrying.');
  }
  const current = await getProject(body.id);
  if (!current) return fail(404, 'Project not found');
  if (body.op === 'get') {
    const [tasks, milestoneRows, history, gates, associations] = await Promise.all([
      scope('SELECT task_id, version, priority, record, engine FROM proposals WHERE owner_id = ? AND namespace = ? AND project_id = ? ORDER BY created_at, task_id', body.id).all(),
      scope('SELECT id, project_id, version, name, acceptance, status, updated_at FROM milestones WHERE owner_id = ? AND namespace = ? AND project_id = ? ORDER BY updated_at, id', body.id).all(),
      scope('SELECT version, status, occurred_at FROM project_events WHERE owner_id = ? AND namespace = ? AND project_id = ? ORDER BY version', body.id).all(),
      scope('SELECT g.task_id, m.id AS milestone_id, m.project_id, m.name, m.status FROM project_task_gates g JOIN proposals t USING (owner_id, namespace, task_id) JOIN milestones m ON m.owner_id = g.owner_id AND m.namespace = g.namespace AND m.id = g.milestone_id WHERE g.owner_id = ? AND g.namespace = ? AND t.project_id = ?', body.id).all(),
      scope('SELECT task_id, milestone_id FROM project_task_milestones WHERE owner_id = ? AND namespace = ? AND project_id = ?', body.id).all(),
    ]);
    const telemetry = { attempts: 0, failures: 0, measured_attempts: 0, input_tokens: null, cached_input_tokens: null, output_tokens: null };
    const summaries = tasks.results.map(row => {
      const task = JSON.parse(row.record);
      const engine = row.engine ? JSON.parse(row.engine) : null;
      for (const attempt of engine?.attempts ?? []) {
        telemetry.attempts++;
        if (['failed', 'orphaned'].includes(attempt.state)) telemetry.failures++;
        const usage = attempt.usage;
        if (!usage?.complete) continue;
        telemetry.measured_attempts++;
        for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens']) {
          if (Number.isSafeInteger(usage[key])) telemetry[key] = (telemetry[key] ?? 0) + usage[key];
        }
      }
      return { id: row.task_id, title: task.title, version: row.version, priority: row.priority,
        state: engine?.state ?? task.state, owner_acceptance: task.owner_acceptance, attempts: engine?.attempts.length ?? 0 };
    });
    return success({ project: serialize(current), tasks: summaries, milestones: milestoneRows.results,
      history: history.results, dependencies: gates.results, task_milestones: associations.results, telemetry });
  }
  if (body.op === 'register_task') {
    if (current.status === 'archived') return fail(409, 'Project is archived');
    if (!isId(body.operation_id) || !isObject(body.fields)) return fail(400, 'Invalid Task registration');
    return registerTask(body.id, { op: 'register', operation_id: body.operation_id, fields: body.fields });
  }
  if (body.op === 'update') {
    if (!Number.isSafeInteger(body.expected_version)) return fail(400, 'Expected Project version required');
    let fields;
    try { fields = projectFields(body.fields ?? {}, application.repository); }
    catch (error) { return fail(400, error.message); }
    const status = body.status ?? current.status;
    const metadata = { ...JSON.parse(current.metadata), ...fields };
    if (!statuses.includes(status) || !metadata.name || !metadata.objective) return fail(400, 'Invalid Project state');
    if (metadata.start_date && metadata.target_date && metadata.start_date > metadata.target_date) return fail(400, 'Target follows start date');
    const updated = await db.prepare('UPDATE projects SET status = ?, metadata = ?, updated_at = ?, version = version + 1 WHERE owner_id = ? AND namespace = ? AND id = ? AND version = ? RETURNING *')
      .bind(status, JSON.stringify(metadata), at, owner, namespace, body.id, body.expected_version).first();
    return updated ? success({ project: serialize(updated) }) : fail(409, 'Project version changed');
  }
  if (current.status === 'archived') return fail(409, 'Project is archived');
  if (body.op === 'milestone') {
    if (!isId(body.milestone_id) || !milestones.includes(body.status) ||
        typeof body.name !== 'string' || !body.name.trim() || body.name.length > 150 ||
        typeof body.acceptance !== 'string' || !body.acceptance.trim() || body.acceptance.length > 16000) {
      return fail(400, 'Invalid milestone');
    }
    const values = [body.name.trim(), body.acceptance.trim(), body.status, at];
    const row = body.expected_version === undefined
      ? await scope("INSERT INTO milestones (owner_id, namespace, id, project_id, name, acceptance, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id, version, status",
        body.milestone_id, body.id, ...values).first()
      : await db.prepare('UPDATE milestones SET name = ?, acceptance = ?, status = ?, updated_at = ?, version = version + 1 WHERE owner_id = ? AND namespace = ? AND id = ? AND project_id = ? AND version = ? RETURNING id, version, status')
        .bind(...values, owner, namespace, body.milestone_id, body.id, body.expected_version).first();
    return row ? success({ milestone: row }, body.expected_version === undefined ? 201 : 200) : fail(409, 'Milestone identity or version changed');
  }
  if (!['link_task', 'milestone_gate', 'milestone_link'].includes(body.op) || !taskId(body.task_id)) return fail(400, 'Invalid Projects operation');
  const task = await scope('SELECT project_id, version, engine FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?', body.task_id).first();
  if (!task || (task.project_id && task.project_id !== body.id)) return fail(404, 'Task not found in Project scope');
  if (body.op === 'link_task') {
    if (task.project_id === body.id) return success({ linked: true });
    const row = await db.prepare('UPDATE proposals SET project_id = ? WHERE owner_id = ? AND namespace = ? AND task_id = ? AND project_id IS NULL AND version = ? RETURNING task_id')
      .bind(body.id, owner, namespace, body.task_id, body.expected_version).first();
    return row ? success({ linked: true }) : fail(409, 'Task association changed');
  }
  if (task.project_id !== body.id || !isId(body.milestone_id)) return fail(400, 'Task and milestone identities required');
  const milestone = await scope('SELECT project_id FROM milestones WHERE owner_id = ? AND namespace = ? AND id = ?', body.milestone_id).first();
  if (!milestone) return fail(404, 'Milestone not found');
  if (body.op === 'milestone_link') {
    if (milestone.project_id !== body.id) return fail(403, 'Milestone belongs to a different Project');
    await scope('INSERT OR IGNORE INTO project_task_milestones VALUES (?, ?, ?, ?, ?)', body.id, body.task_id, body.milestone_id).run();
  } else {
    if (milestone.project_id === body.id) return fail(400, 'Milestone gate requires a different Project');
    if (JSON.parse(task.engine ?? '{}').executor) return fail(409, 'Set milestone gates before Task admission');
    const alreadyLinked = await scope('SELECT task_id FROM project_task_gates WHERE owner_id = ? AND namespace = ? AND task_id = ? AND milestone_id = ?', body.task_id, body.milestone_id).first();
    if (alreadyLinked) return success({ linked: true });
    const linked = await db.prepare(`
      WITH RECURSIVE edges(source, target) AS (
        SELECT p.project_id, m.project_id FROM project_task_gates g
        JOIN proposals p USING (owner_id, namespace, task_id)
        JOIN milestones m ON m.owner_id = g.owner_id AND m.namespace = g.namespace AND m.id = g.milestone_id
        WHERE g.owner_id = ? AND g.namespace = ?
      ), reachable(id) AS (
        SELECT ? UNION SELECT edges.target FROM edges JOIN reachable ON reachable.id = edges.source
      )
      INSERT INTO project_task_gates
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM reachable WHERE id = ?)
        AND EXISTS (SELECT 1 FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?
          AND project_id = ? AND json_extract(engine, '$.executor') IS NULL)
      ON CONFLICT DO NOTHING RETURNING task_id
    `).bind(owner, namespace, milestone.project_id, owner, namespace, body.task_id, body.milestone_id,
      body.id, owner, namespace, body.task_id, body.id).first();
    if (!linked) return fail(409, 'Milestone gate would create a cycle or Task state changed');
  }
  return success({ linked: true });
}
