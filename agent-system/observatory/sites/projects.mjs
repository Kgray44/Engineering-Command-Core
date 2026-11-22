import { accountEngineeringTokens } from '../src/engineering-token-accounting.mjs';
import { readTaskRows, storedTaskDispatch, storedTaskPrerequisites, taskAttemptRecord } from './task-engine.mjs';
import { combinedTelemetry } from './task-telemetry.mjs';
import { uuid } from './application-config.mjs';
import { orderBySavedIds, projectAccents, projectIconGroups } from '../src/project-presentation.mjs';
import { safeActivityUrl } from '../src/task-activity.mjs';

const projectIcons = new Set(Object.values(projectIconGroups).flat());

const statuses = ['planned', 'active', 'paused', 'archived'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const milestones = ['planned', 'verified', 'integrated', 'accepted'];
const reviewHistoryLabels = {
  pending: 'Owner review requested', accepted: 'Owner accepted Project', declined: 'Owner declined Project', '': 'Owner review cleared',
};
const executionHistoryLimit = 120;
const heartbeatHistoryLimit = 40;
const projectTaskActivity = {
  register: 'Task registered', admit: 'Task admitted', claim: 'Task claimed', finished: 'Candidate reported',
  failed: 'Task attempt failed', accept: 'Task accepted', reject: 'Task returned for changes',
  pause: 'Task paused', resume: 'Task resumed', cancel: 'Task canceled', retry: 'Task retried',
  lease_expired: 'Worker lease expired', attempt_time_limit_reached: 'Task attempt timed out',
};

function latestProjectActivity(project, { tasks, milestones, integrations }) {
  let latest = { label: project.version === 1 ? 'Project created' : 'Project updated', at: project.updated_at };
  const consider = (label, at) => {
    if (label && at && at > latest.at) latest = { label, at };
  };
  for (const milestone of milestones) consider(milestone.status === 'accepted' ? 'Milestone accepted' : 'Milestone updated', milestone.updated_at);
  for (const task of tasks) {
    const kind = task.last_activity?.kind;
    if (Object.hasOwn(projectTaskActivity, kind)) consider(projectTaskActivity[kind], task.last_activity.at);
    consider('Task claimed', task.attempt_started_at);
  }
  for (const run of integrations) {
    const label = { merged: 'Integration landed', deployed: 'Deployment recorded', blocked: 'Integration blocked' }[run.state];
    consider(label, run.updated_at);
  }
  return latest;
}
const artifactReferenceKinds = new Set(['artifact', 'document', 'url', 'test', 'pull_request', 'ci_run']);

function collectProjectArtifact(artifacts, repository, task_id, reference, evidence) {
  if (typeof reference?.uri !== 'string' || (!evidence && !artifactReferenceKinds.has(reference.kind))) return;
  const href = safeActivityUrl(reference.uri);
  const source = 'https://github.com/' + repository + '/';
  const route = href?.startsWith(source) ? href.slice(source.length) : '';
  let kind = evidence || reference.kind === 'test' ? 'verification' : 'artifact';
  if (/^pull\/\d+(?:[\/#]|$)/.test(route)) kind = 'pull_request';
  else if (/^actions\/runs\/\d+(?:[\/#]|$)/.test(route)) kind = 'ci_run';
  else if (['pull_request', 'ci_run'].includes(reference.kind)) return;
  const revision = /^[0-9a-f]{40}$/i.test(reference.revision ?? '') ? reference.revision : null;
  artifacts.set(JSON.stringify([task_id, kind, href, revision, evidence ?? null]),
    { task_id, kind, href, revision, ...(evidence ? { evidence } : {}) });
}
const executionHistoryQuery = `
  WITH boundaries AS (
    SELECT task_id, kind, occurred_at,
      lead(occurred_at) OVER (PARTITION BY task_id ORDER BY event_id) AS ends_at
    FROM project_relationship_events
    WHERE owner_id = ?1 AND namespace = ?2 AND project_id = ?3
      AND kind IN ('task_registered', 'task_linked', 'task_moved_out')
  ), membership AS (
    SELECT task_id, occurred_at, ends_at FROM boundaries WHERE kind IN ('task_registered', 'task_linked')
  ), receipts AS (
    SELECT 'task' AS source, e.task_id, e.version, e.event,
      NULL AS integration_id
    FROM task_engine_events e
    WHERE e.owner_id = ?1 AND e.namespace = ?2 AND e.task_id IN (SELECT task_id FROM membership)
    UNION ALL
    SELECT 'integration', r.task_id, e.version, e.event, e.integration_id
    FROM integration_runs r JOIN integration_events e ON e.owner_id = r.owner_id
      AND e.namespace = r.namespace AND e.integration_id = r.id
    WHERE r.owner_id = ?1 AND r.namespace = ?2 AND r.task_id IN (SELECT task_id FROM membership)
  ), scoped AS (
    SELECT r.source, r.task_id, r.version, r.integration_id, json_extract(r.event, '$.at') AS occurred_at,
      json_extract(r.event, '$.kind') AS kind, json_extract(r.event, '$.state') AS status,
      json_extract(r.event, '$.pr_number') AS pr_number, json_extract(t.record, '$.title') AS task_title
    FROM receipts r JOIN proposals t ON t.owner_id = ?1 AND t.namespace = ?2 AND t.task_id = r.task_id
    WHERE EXISTS (SELECT 1 FROM membership m WHERE m.task_id = r.task_id
      AND json_extract(r.event, '$.at') >= m.occurred_at
      AND (m.ends_at IS NULL OR json_extract(r.event, '$.at') < m.ends_at))
      AND json_extract(r.event, '$.kind') IS NOT NULL
  ), ranked AS (
    SELECT *, row_number() OVER (PARTITION BY source = 'task' AND kind = 'heartbeat'
      ORDER BY occurred_at DESC, source, task_id, integration_id, version DESC) AS receipt_rank
    FROM scoped
  )
  SELECT * FROM ranked
  WHERE receipt_rank <= CASE WHEN source = 'task' AND kind = 'heartbeat' THEN ?5 ELSE ?4 END
  ORDER BY occurred_at DESC, source, task_id, integration_id, version DESC
`;
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
    } else if ((key === 'icon' && projectIcons.has(value)) || (key === 'accent' && projectAccents.includes(value))) {
      result[key] = value;
    } else if (key === 'milestone_suggestions' && Array.isArray(value) && value.length <= 12 &&
        value.every(item => typeof item === 'string' && item.trim() && item.length <= 150)) {
      result[key] = [...new Set(value.map(item => item.trim()))];
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
      scope(`SELECT r.id, r.task_id, r.pr_number, r.head_sha, r.state, r.updated_at, t.project_id,
        CASE WHEN t.project_id = ?3 AND json_extract(r.record, '$.evidence.observed_head') = r.head_sha
          AND json_extract(r.record, '$.evidence.policy_observed') = 1
          AND json_type(r.record, '$.evidence.checks') = 'array'
          THEN json_extract(r.record, '$.evidence.checks') END AS checks,
        CASE WHEN t.project_id = ?3 THEN json_extract(r.record, '$.evidence.base_sha') END AS observed_base
        FROM integration_runs r JOIN proposals t ON t.owner_id = r.owner_id AND t.namespace = r.namespace AND t.task_id = r.task_id
        WHERE r.owner_id = ?1 AND r.namespace = ?2 AND t.project_id IS NOT NULL ORDER BY r.updated_at DESC, r.id`,
      body.op === 'get' ? body.id : null).all(),
    ]);
    const rows = new Map(taskRows.map(row => [row.task_id, row]));
    return {
      taskRows,
      milestoneDependents(projectId) {
        return gates.results.filter(gate => gate.project_id === projectId).flatMap(gate => {
          const dependent = rows.get(gate.task_id);
          return dependent?.project_id ? [{
            milestone_id: gate.milestone_id, task_id: gate.task_id,
            project_id: dependent.project_id, title: JSON.parse(dependent.record).title,
          }] : [];
        });
      },
      prerequisitesFor(row) {
        return storedTaskPrerequisites(row, rows).map(check => {
          const source = check.type === 'task' ? rows.get(check.id) : null;
          return { ...check, task_id: row.task_id, title: source ? JSON.parse(source.record).title : null };
        });
      },
      forProject(project) {
        const linked = taskRows.filter(row => row.project_id === project.id);
        const taskIds = new Set(linked.map(row => row.task_id));
        const dependencies = gates.results.filter(gate => taskIds.has(gate.task_id));
        const activeWorkers = new Set();
        const tasks = linked.map(row => {
          const task = JSON.parse(row.record);
          const engine = row.engine && JSON.parse(row.engine);
          const attempt = engine?.attempts.at(-1);
          if (attempt?.worker_id && attempt.lease_until > now &&
              ['running', 'pausing', 'cancelling'].includes(engine.state)) activeWorkers.add(attempt.worker_id);
          const dispatch = storedTaskDispatch(row, rows, now);
          const blockers = [...dispatch.blockers];
          if (['admitted', 'queued', 'scheduled'].includes(engine?.state)) {
            if (['paused', 'archived'].includes(project.status)) blockers.push({ type: 'project', id: project.id, state: project.status });
            for (const gate of dependencies.filter(item => item.task_id === row.task_id && item.status !== 'accepted')) {
              blockers.push({ type: 'milestone', id: gate.milestone_id, state: gate.status });
            }
          }
          return { id: row.task_id, title: task.title, version: row.version, created_at: row.created_at,
            priority: row.priority, branch: attempt?.branch ?? null,
            state: blockers.length ? 'blocked' : dispatch.state, blockers,
            attempt_started_at: attempt?.started_at ?? null,
            ...(engine?.event?.kind && engine.event.at ? { last_activity: { kind: engine.event.kind, at: engine.event.at } } : {}),
            candidate_revision: ['verifying', 'succeeded'].includes(attempt?.state) ? attempt.candidate_revision ?? null : null,
            owner_acceptance: task.owner_acceptance, attempts: engine?.attempts.length ?? 0 };
        });
        const projectMilestones = orderBySavedIds(milestones.results.filter(item => item.project_id === project.id),
          project.milestone_order ?? []);
        const projectIntegrations = integrations.results.filter(item => item.project_id === project.id);
        return { linked, tasks, active_workers: activeWorkers.size, milestones: projectMilestones, dependencies,
          integrations: projectIntegrations.map(({ project_id, checks, observed_base, ...integration }) => ({
            ...integration, repository: application.repository,
            required_checks: checks ? JSON.parse(checks) : [],
            check_base_sha: checks && /^[0-9a-f]{40}$/.test(observed_base ?? '') ? observed_base : null,
          })),
          progress: projectProgress(project, tasks, projectMilestones, projectIntegrations) };
      },
    };
  }
  const orderPayload = row => row
    ? { version: row.version, project_ids: JSON.parse(row.project_ids) }
    : { version: 0, project_ids: [] };
  const getOrder = () => scope('SELECT version, project_ids FROM project_manual_order WHERE owner_id = ? AND namespace = ?').first();
  if (body.op === 'reorder') {
    const { project_ids: ids, expected_version: version } = body;
    if (!Array.isArray(ids) || !ids.every(isId) || new Set(ids).size !== ids.length ||
        !Number.isSafeInteger(version) || version < 0) return fail(400, 'Invalid Project order');
    const { results } = await scope('SELECT id FROM projects WHERE owner_id = ? AND namespace = ?').all();
    const existing = new Set(results.map(row => row.id));
    if (ids.some(id => !existing.has(id))) return fail(400, 'Project unavailable in this application');
    if (ids.length !== existing.size) return fail(409, 'Projects changed. Refresh the library and reorder again.');
    const row = await db.prepare(`
      INSERT INTO project_manual_order (owner_id, namespace, version, project_ids)
      SELECT ?1, ?2, ?3 + 1, ?4
      WHERE COALESCE((SELECT version FROM project_manual_order WHERE owner_id = ?1 AND namespace = ?2), 0) = ?3
        AND (SELECT COUNT(*) FROM projects WHERE owner_id = ?1 AND namespace = ?2) = ?5
      ON CONFLICT (owner_id, namespace) DO UPDATE SET version = excluded.version, project_ids = excluded.project_ids
      RETURNING version, project_ids
    `).bind(owner, namespace, version, JSON.stringify(ids), ids.length).first();
    return row ? success({ manual_order: orderPayload(row) }) : fail(409, 'Projects changed. Refresh the library and reorder again.');
  }
  if (body.op === 'list') {
    const [{ results }, view, order] = await Promise.all([
      scope('SELECT * FROM projects WHERE owner_id = ? AND namespace = ? ORDER BY updated_at DESC, id').all(),
      readProgress(),
      getOrder(),
    ]);
    const projects = results.map(serialize);
    return success({ application, projects: projects.map(project => {
      const projection = view.forProject(project);
      return { ...project, progress: projection.progress, latest_activity: latestProjectActivity(project, projection) };
    }),
      manual_order: orderPayload(order),
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
    const [view, history, milestoneHistory, relationshipHistory, executionHistory, associations, incremental, checkpoint] = await Promise.all([
      readProgress(),
      scope(`WITH snapshots AS (
          SELECT version, status, occurred_at, json_extract(metadata, '$.owner_review') AS owner_review,
            json_remove(metadata, '$.owner_review') AS configuration
          FROM project_events WHERE owner_id = ? AND namespace = ? AND project_id = ?
        )
        SELECT CASE WHEN version = 1 THEN 'project_created'
          WHEN configuration <> lag(configuration) OVER (ORDER BY version) THEN 'project_configuration_changed'
          ELSE 'project_changed' END AS kind, version, status, occurred_at, owner_review
        FROM snapshots ORDER BY version`, body.id).all(),
      scope("SELECT 'milestone_changed' AS kind, e.version, e.status, e.occurred_at, e.milestone_id, m.name FROM project_milestone_events e JOIN milestones m ON m.owner_id = e.owner_id AND m.namespace = e.namespace AND m.id = e.milestone_id WHERE e.owner_id = ? AND e.namespace = ? AND m.project_id = ?", body.id).all(),
      scope('SELECT event_id, task_id, milestone_id, kind, occurred_at FROM project_relationship_events WHERE owner_id = ? AND namespace = ? AND project_id = ?', body.id).all(),
      scope(executionHistoryQuery, body.id, executionHistoryLimit + 1, heartbeatHistoryLimit + 1).all(),
      scope('SELECT task_id, milestone_id FROM project_task_milestones WHERE owner_id = ? AND namespace = ? AND project_id = ?', body.id).all(),
      scope('SELECT t.* FROM task_telemetry t JOIN proposals p USING (owner_id, namespace, task_id) WHERE t.owner_id = ? AND t.namespace = ? AND p.project_id = ?', body.id).all(),
      scope('SELECT payload FROM private_projection WHERE owner_id = ? AND namespace = ?').first(),
    ]);
    const project = serialize(current);
    const { linked, ...summary } = view.forProject(project);
    const projectTasks = [], projectAttempts = [], artifacts = [], github = [];
    const artifactSources = new Map();
    const telemetry = { attempts: 0, retries: 0, failures: 0, execution_ms: null, costs: null, ci_usage: null };
    for (const row of linked) {
      const task = JSON.parse(row.record);
      const engine = row.engine ? JSON.parse(row.engine) : null;
      projectTasks.push(task);
      artifacts.push(...(task.artifacts ?? []).map(artifact => ({ task_id: row.task_id, ...artifact })));
      for (const reference of [...(task.artifacts ?? []), ...(engine?.links ?? [])]) {
        collectProjectArtifact(artifactSources, application.repository, row.task_id, reference);
      }
      for (const reference of engine?.evidence ?? []) {
        collectProjectArtifact(artifactSources, application.repository, row.task_id, reference, { source: 'owner_review' });
      }
      for (const item of [...(engine?.links ?? []), ...(engine?.evidence ?? [])]) {
        if (typeof item.uri === 'string' && item.uri.startsWith('https://github.com/' + application.repository + '/')) {
          github.push({ task_id: row.task_id, uri: item.uri, kind: item.kind });
        }
      }
      telemetry.retries += Math.max(0, (engine?.attempts.length ?? 0) - 1);
      for (const attempt of engine?.attempts ?? []) {
        telemetry.attempts++;
        if (['failed', 'orphaned'].includes(attempt.state)) telemetry.failures++;
        const elapsed = Date.parse(attempt.finished_at) - Date.parse(attempt.started_at);
        const execution_ms = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
        projectAttempts.push({ ...taskAttemptRecord(task, attempt), recorded_state: attempt.state, execution_ms });
        if (execution_ms !== null) telemetry.execution_ms = (telemetry.execution_ms ?? 0) + execution_ms;
      }
    }
    const ids = new Set(projectTasks.map(task => task.id));
    const projected = combinedTelemetry(checkpoint && JSON.parse(checkpoint.payload), incremental.results);
    const events = (projected?.events ?? []).filter(event => ids.has(event.task_id) && event.repository === application.repository);
    for (const item of projected?.records ?? []) {
      if (item.record_type !== 'evidence' || !ids.has(item.task_id) || item.repository !== application.repository) continue;
      collectProjectArtifact(artifactSources, application.repository, item.task_id,
        { ...item.artifact, revision: item.revision }, { source: 'reported', kind: item.kind, result: item.result, synthetic: Boolean(item.synthetic) });
    }
    const measured = accountEngineeringTokens({ tasks: projectTasks, attempts: projectAttempts, events, days: [], cutoff: Date.now(), sourceConflicts: 0 });
    Object.assign(telemetry, { measured_attempts: measured.byAttempt.filter(attempt => attempt.observed.totalTokens !== null).length,
      input_tokens: measured.observed.inputTokens, cached_input_tokens: measured.observed.cachedInputTokens,
      output_tokens: measured.observed.outputTokens });
    const tokensByAttempt = new Map(measured.byAttempt.map(item => [item.attemptId, item]));
    telemetry.recent_attempts = projectAttempts.sort((a, b) => b.started_at.localeCompare(a.started_at) || a.id.localeCompare(b.id))
      .slice(0, 20).map(attempt => {
        const tokens = tokensByAttempt.get(attempt.id);
        return {
          id: attempt.id, task_id: attempt.task_id, number: attempt.attempt_number,
          state: attempt.recorded_state, started_at: attempt.started_at, execution_ms: attempt.execution_ms,
          provider: attempt.provider, failure_category: attempt.failure_category,
          observed_tokens: tokens?.observed.totalTokens ?? null, token_coverage: tokens?.coverage ?? 'unavailable',
        };
      });
    let previousReview = '';
    const projectHistory = history.results.flatMap(({ owner_review, ...event }) => {
      const review = owner_review ?? '';
      const changed = review !== previousReview;
      previousReview = review;
      return changed ? [event, { kind: 'project_owner_review_changed', version: event.version, occurred_at: event.occurred_at,
        name: Object.hasOwn(reviewHistoryLabels, review) ? reviewHistoryLabels[review] : 'Owner review updated' }] : [event];
    });
    const linkable_tasks = project.status === 'archived' ? [] : view.taskRows
      .filter(row => !row.project_id && taskId(row.task_id))
      .map(row => ({ id: row.task_id, title: JSON.parse(row.record).title, version: row.version }));
    const isHeartbeat = event => event.source === 'task' && event.kind === 'heartbeat';
    const receipts = executionHistory.results.filter(event => event.receipt_rank <= (isHeartbeat(event) ? heartbeatHistoryLimit : executionHistoryLimit))
      .map(({ receipt_rank, ...event }) => event);
    return success({ project, ...summary, artifacts, artifact_sources: [...artifactSources.values()], github, linkable_tasks,
      task_prerequisites: linked.flatMap(view.prerequisitesFor),
      history: [...projectHistory, ...milestoneHistory.results, ...relationshipHistory.results,
        ...receipts].sort((a,b) => a.occurred_at.localeCompare(b.occurred_at)),
      execution_history_truncated: executionHistory.results.some(event => !isHeartbeat(event) && event.receipt_rank > executionHistoryLimit),
      heartbeat_history_truncated: executionHistory.results.some(event => isHeartbeat(event) && event.receipt_rank > heartbeatHistoryLimit),
      task_milestones: associations.results, milestone_dependents: view.milestoneDependents(body.id), telemetry });
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
  if (body.op === 'reorder_milestones') {
    const { milestone_ids: ids, expected_version: version } = body;
    if (!Array.isArray(ids) || !ids.every(isId) || new Set(ids).size !== ids.length || !Number.isSafeInteger(version) || version < 1) {
      return fail(400, 'Invalid milestone order');
    }
    const { results } = await scope('SELECT id FROM milestones WHERE owner_id = ? AND namespace = ? AND project_id = ?', body.id).all();
    const available = new Set(results.map(row => row.id));
    if (ids.some(id => !available.has(id))) return fail(400, 'Milestone belongs to a different Project');
    if (ids.length !== available.size) return fail(409, 'Milestones changed. Read current state before retrying.');
    const row = await db.prepare(`
      UPDATE projects SET metadata = json_set(metadata, '$.milestone_order', json(?1)), updated_at = ?2, version = version + 1
      WHERE owner_id = ?3 AND namespace = ?4 AND id = ?5 AND version = ?6 AND status <> 'archived'
        AND (SELECT COUNT(*) FROM milestones WHERE owner_id = ?3 AND namespace = ?4 AND project_id = ?5) = ?7
      RETURNING *
    `).bind(JSON.stringify(ids), at, owner, namespace, body.id, version, ids.length).first();
    return row ? success({ project: serialize(row) }) : fail(409, 'Project or milestones changed. Read current state before retrying.');
  }
  if (body.op === 'move_task') {
    if (!taskId(body.task_id) || !isId(body.source_project_id) || body.id === body.source_project_id ||
        !Number.isSafeInteger(body.expected_version) || body.expected_version < 1) return fail(400, 'Invalid Task move');
    const task = await scope('SELECT project_id, version FROM proposals WHERE owner_id = ? AND namespace = ? AND task_id = ?', body.task_id).first();
    if (task?.project_id !== body.source_project_id) return fail(404, 'Task not found in source Project');
    if (task.version !== body.expected_version) return fail(409, 'Task version changed');
    const row = await db.prepare(`
      UPDATE proposals SET project_id = ?1
      WHERE owner_id = ?2 AND namespace = ?3 AND task_id = ?4 AND version = ?5 AND project_id = ?6
        AND (json_extract(engine, '$.executor') IS NULL OR json_extract(engine, '$.state') IN ('completed','archived','cancelled'))
        AND EXISTS (SELECT 1 FROM projects WHERE owner_id = ?2 AND namespace = ?3 AND id = ?1 AND status <> 'archived')
        AND NOT EXISTS (SELECT 1 FROM project_task_milestones WHERE owner_id = ?2 AND namespace = ?3 AND task_id = ?4)
        AND NOT EXISTS (SELECT 1 FROM project_task_gates WHERE owner_id = ?2 AND namespace = ?3 AND task_id = ?4)
      RETURNING task_id
    `).bind(body.id, owner, namespace, body.task_id, body.expected_version, body.source_project_id).first();
    return row ? success({ task_id: row.task_id, project_id: body.id }) :
      fail(409, 'Only unadmitted or finished Tasks without milestone links can move to a current Project');
  }
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
