import { accountEngineeringTokens } from '../src/engineering-token-accounting.mjs';
import { readTaskRows, storedTaskDispatch, taskAttemptRecord } from './task-engine.mjs';
import { combinedTelemetry } from './task-telemetry.mjs';
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

function projectProgress(project, tasks, milestones, integrations) {
  const byState = states => Object.fromEntries(states.map(state => [state, tasks.filter(task => task.state === state).length]));
  const active = tasks.filter(task => ['running', 'pausing', 'cancelling'].includes(task.state)).length;
  return {
    tasks: { total: tasks.length, active, ...byState(['blocked', 'ready', 'verifying', 'failed']),
      completed: tasks.filter(task => ['completed', 'accepted'].includes(task.state) ||
        (task.state === 'archived' && task.owner_acceptance === 'accepted')).length,
      accepted: tasks.filter(task => task.owner_acceptance === 'accepted').length },
    milestones: { total: milestones.length, accepted: milestones.filter(item => item.status === 'accepted').length },
    integrations: { tracked: integrations.length, merged: integrations.filter(item => ['merged', 'deployed'].includes(item.state)).length,
      deployed: integrations.filter(item => item.state === 'deployed').length },
    technical_state: project.technical_state || null,
    owner_review: project.owner_review || null,
  };
}

export async function projectOperation({ db, owner, namespace, application, body, registerTask }) {
  if (!isObject(body)) return fail(400, 'Invalid Projects request');
  const scope = (sql, ...args) => db.prepare(sql).bind(owner, namespace, ...args);
  const getProject = id => scope('SELECT * FROM projects WHERE owner_id = ? AND namespace = ? AND id = ?', id).first();
  const serialize = row => ({
    ...JSON.parse(row.metadata), id: row.id, application_id: application.id, owner: row.owner_id,
    status: row.status, version: row.version, created_at: row.created_at, updated_at: row.updated_at,
  });
  async function readProgress() {
    const now = Date.now();
    const [taskRows, milestones, gates, integrations] = await Promise.all([
      readTaskRows({ db, owner, namespace, now, reconcileExpired: false }),
      scope('SELECT id, project_id, version, name, acceptance, status, updated_at FROM milestones WHERE owner_id = ? AND namespace = ? ORDER BY updated_at, id').all(),
      scope('SELECT g.task_id, m.id AS milestone_id, m.project_id, m.name, m.status FROM project_task_gates g JOIN milestones m ON m.owner_id = g.owner_id AND m.namespace = g.namespace AND m.id = g.milestone_id WHERE g.owner_id = ? AND g.namespace = ?').all(),
      scope('SELECT r.id, r.task_id, r.pr_number, r.head_sha, r.state, t.project_id FROM integration_runs r JOIN proposals t ON t.owner_id = r.owner_id AND t.namespace = r.namespace AND t.task_id = r.task_id WHERE r.owner_id = ? AND r.namespace = ? AND t.project_id IS NOT NULL').all(),
    ]);
    const rows = new Map(taskRows.map(row => [row.task_id, row]));
    return {
      taskRows,
      forProject(project) {
        const linked = taskRows.filter(row => row.project_id === project.id);
        const taskIds = new Set(linked.map(row => row.task_id));
        const dependencies = gates.results.filter(gate => taskIds.has(gate.task_id));
        const tasks = linked.map(row => {
          const task = JSON.parse(row.record);
          const engine = row.engine && JSON.parse(row.engine);
          const dispatch = storedTaskDispatch(row, rows, now);
          const blockers = [...dispatch.blockers];
          if (['admitted', 'queued', 'scheduled'].includes(engine?.state)) {
            if (['paused', 'archived'].includes(project.status)) blockers.push({ type: 'project', id: project.id, state: project.status });
            for (const gate of dependencies.filter(item => item.task_id === row.task_id && item.status !== 'accepted')) {
              blockers.push({ type: 'milestone', id: gate.milestone_id, state: gate.status });
            }
          }
          return { id: row.task_id, title: task.title, version: row.version, priority: row.priority, branch: engine?.attempts.at(-1)?.branch ?? null,
            state: blockers.length ? 'blocked' : dispatch.state, blockers,
            owner_acceptance: task.owner_acceptance, attempts: engine?.attempts.length ?? 0 };
        });
        const projectMilestones = milestones.results.filter(item => item.project_id === project.id);
        const projectIntegrations = integrations.results.filter(item => item.project_id === project.id);
        return { linked, tasks, milestones: projectMilestones, dependencies, integrations: projectIntegrations.map(({ project_id, ...integration }) => ({ ...integration, repository: application.repository })),
          progress: projectProgress(project, tasks, projectMilestones, projectIntegrations) };
      },
    };
  }
  if (body.op === 'list') {
    const [{ results }, view] = await Promise.all([
      scope('SELECT * FROM projects WHERE owner_id = ? AND namespace = ? ORDER BY updated_at DESC, id').all(),
      readProgress(),
    ]);
    const projects = results.map(serialize);
    return success({ application, projects: projects.map(project => ({ ...project, progress: view.forProject(project).progress })),
      unassigned_tasks: view.taskRows.filter(row => !row.project_id).length });
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
    const [view, history, milestoneHistory, relationshipHistory, associations, incremental, checkpoint] = await Promise.all([
      readProgress(),
      scope("SELECT 'project_changed' AS kind, version, status, occurred_at FROM project_events WHERE owner_id = ? AND namespace = ? AND project_id = ? ORDER BY version", body.id).all(),
      scope("SELECT 'milestone_changed' AS kind, e.version, e.status, e.occurred_at, e.milestone_id, m.name FROM project_milestone_events e JOIN milestones m ON m.owner_id = e.owner_id AND m.namespace = e.namespace AND m.id = e.milestone_id WHERE e.owner_id = ? AND e.namespace = ? AND m.project_id = ?", body.id).all(),
      scope('SELECT event_id, task_id, milestone_id, kind, occurred_at FROM project_relationship_events WHERE owner_id = ? AND namespace = ? AND project_id = ?', body.id).all(),
      scope('SELECT task_id, milestone_id FROM project_task_milestones WHERE owner_id = ? AND namespace = ? AND project_id = ?', body.id).all(),
      scope('SELECT t.* FROM task_telemetry t JOIN proposals p USING (owner_id, namespace, task_id) WHERE t.owner_id = ? AND t.namespace = ? AND p.project_id = ?', body.id).all(),
      scope('SELECT payload FROM private_projection WHERE owner_id = ? AND namespace = ?').first(),
    ]);
    const project = serialize(current);
    const { linked, ...summary } = view.forProject(project);
    const projectTasks = [], projectAttempts = [], artifacts = [], github = [];
    const telemetry = { attempts: 0, retries: 0, failures: 0, execution_ms: null, costs: null, ci_usage: null };
    for (const row of linked) {
      const task = JSON.parse(row.record);
      const engine = row.engine ? JSON.parse(row.engine) : null;
      projectTasks.push(task);
      artifacts.push(...(task.artifacts ?? []).map(artifact => ({ task_id: row.task_id, ...artifact })));
      for (const item of [...(engine?.links ?? []), ...(engine?.evidence ?? [])]) {
        if (typeof item.uri === 'string' && item.uri.startsWith('https://github.com/' + application.repository + '/')) {
          github.push({ task_id: row.task_id, uri: item.uri, kind: item.kind });
        }
      }
      telemetry.retries += Math.max(0, (engine?.attempts.length ?? 0) - 1);
      for (const attempt of engine?.attempts ?? []) {
        telemetry.attempts++;
        if (['failed', 'orphaned'].includes(attempt.state)) telemetry.failures++;
        projectAttempts.push(taskAttemptRecord(task, attempt));
        const elapsed = Date.parse(attempt.finished_at) - Date.parse(attempt.started_at);
        if (Number.isFinite(elapsed) && elapsed >= 0) telemetry.execution_ms = (telemetry.execution_ms ?? 0) + elapsed;
      }
    }
    const ids = new Set(projectTasks.map(task => task.id));
    const projected = combinedTelemetry(checkpoint && JSON.parse(checkpoint.payload), incremental.results);
    const events = (projected?.events ?? []).filter(event => ids.has(event.task_id) && event.repository === application.repository);
    const measured = accountEngineeringTokens({ tasks: projectTasks, attempts: projectAttempts, events, days: [], cutoff: Date.now(), sourceConflicts: 0 });
    Object.assign(telemetry, { measured_attempts: measured.byAttempt.filter(attempt => attempt.observed.totalTokens !== null).length,
      input_tokens: measured.observed.inputTokens, cached_input_tokens: measured.observed.cachedInputTokens,
      output_tokens: measured.observed.outputTokens });
    return success({ project, ...summary, artifacts, github,
      history: [...history.results, ...milestoneHistory.results, ...relationshipHistory.results].sort((a,b) => a.occurred_at.localeCompare(b.occurred_at)), task_milestones: associations.results, telemetry });
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
      ? await scope("INSERT INTO milestones (owner_id, namespace, id, project_id, name, acceptance, status, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE owner_id = ? AND namespace = ? AND id = ? AND status <> 'archived') ON CONFLICT DO NOTHING RETURNING id, version, status",
        body.milestone_id, body.id, ...values, owner, namespace, body.id).first()
      : await db.prepare('UPDATE milestones SET name = ?, acceptance = ?, status = ?, updated_at = ?, version = version + 1 WHERE owner_id = ? AND namespace = ? AND id = ? AND project_id = ? AND version = ? AND EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = milestones.owner_id AND p.namespace = milestones.namespace AND p.id = milestones.project_id AND p.status <> \'archived\') RETURNING id, version, status')
        .bind(...values, owner, namespace, body.milestone_id, body.id, body.expected_version).first();
    return row ? success({ milestone: row }, body.expected_version === undefined ? 201 : 200) : fail(409, 'Milestone identity or version changed');
  }
  if (!['link_task', 'milestone_gate', 'milestone_link'].includes(body.op) || !taskId(body.task_id)) return fail(400, 'Invalid Projects operation');
  const task = await scope('SELECT project_id, version, engine FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?', body.task_id).first();
  if (!task || (task.project_id && task.project_id !== body.id)) return fail(404, 'Task not found in Project scope');
  if (body.op === 'link_task') {
    if (task.project_id === body.id) return success({ linked: true });
    if (!Number.isSafeInteger(body.expected_version) || body.expected_version < 1) return fail(400, 'Expected Task version required');
    const row = await db.prepare('UPDATE proposals SET project_id = ? WHERE owner_id = ? AND namespace = ? AND task_id = ? AND project_id IS NULL AND version = ? AND EXISTS (SELECT 1 FROM projects p WHERE p.owner_id = proposals.owner_id AND p.namespace = proposals.namespace AND p.id = ? AND p.status <> \'archived\') RETURNING task_id')
      .bind(body.id, owner, namespace, body.task_id, body.expected_version, body.id).first();
    return row ? success({ linked: true }) : fail(409, 'Task association changed');
  }
  if (task.project_id !== body.id || !isId(body.milestone_id)) return fail(400, 'Task and milestone identities required');
  const milestone = await scope('SELECT project_id FROM milestones WHERE owner_id = ? AND namespace = ? AND id = ?', body.milestone_id).first();
  if (!milestone) return fail(404, 'Milestone not found');
  if (body.op === 'milestone_link') {
    if (milestone.project_id !== body.id) return fail(403, 'Milestone belongs to a different Project');
    const row = await scope("INSERT INTO project_task_milestones SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE owner_id = ? AND namespace = ? AND id = ? AND status <> 'archived') ON CONFLICT DO NOTHING RETURNING task_id",
      body.id, body.task_id, body.milestone_id, owner, namespace, body.id).first();
    if (!row && !await scope('SELECT task_id FROM project_task_milestones WHERE owner_id = ? AND namespace = ? AND task_id = ? AND milestone_id = ?', body.task_id, body.milestone_id).first()) {
      return fail(409, 'Project state changed');
    }
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
        AND EXISTS (SELECT 1 FROM projects WHERE owner_id = ? AND namespace = ? AND id = ? AND status <> 'archived')
      ON CONFLICT DO NOTHING RETURNING task_id
    `).bind(owner, namespace, milestone.project_id, owner, namespace, body.task_id, body.milestone_id,
      body.id, owner, namespace, body.task_id, body.id, owner, namespace, body.id).first();
    if (!linked) return fail(409, 'Milestone gate would create a cycle or Task state changed');
  }
  return success({ linked: true });
}
