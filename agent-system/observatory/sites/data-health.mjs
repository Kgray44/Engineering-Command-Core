const inspectedObjects = new Map([
  ['application_partition', 'table'],
  ['migration_receipt', 'table'],
  ['private_projection', 'table'],
  ['task_telemetry', 'table'],
  ['task_engine_events', 'table'],
  ['projects', 'table'],
  ['project_events', 'table'],
  ['project_manual_order', 'table'],
  ['project_relationship_events', 'table'],
  ['milestones', 'table'],
  ['project_milestone_events', 'table'],
  ['project_task_milestones', 'table'],
  ['project_task_gates', 'table'],
  ['proposals', 'table'],
  ['integration_runs', 'table'],
  ['integration_events', 'table'],
  ['workspace_preferences', 'table'],
  ['workspace_preference_events', 'table'],
  ['project_task_moved_out', 'trigger'],
]);

export async function readDataHealth(db, owner, namespace) {
  const names = [...inspectedObjects.keys()];
  const { results } = await db.prepare(
    'SELECT name, type FROM sqlite_schema WHERE name IN (' + names.map(() => '?').join(', ') + ')',
  ).bind(...names).all();
  const observed = new Map(results.map(row => [row.name, row.type]));
  const missing = names.filter(name => observed.get(name) !== inspectedObjects.get(name));
  const schema = { status: missing.length ? 'incomplete' : 'current', checked_objects: names.length, missing,
    ...(observed.get('project_task_moved_out') === 'trigger' ? { observed_migration_marker: '0019_project_task_move_history' } : {}) };
  const base = { schema, backup: { status: 'unverified' }, import: { status: 'no_checkpoint_in_served_partition' } };
  if (missing.length) return { ...base, checked_at: new Date().toISOString(), integrity: { status: 'unverified' } };

  const counts = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM projects p WHERE p.owner_id = ?1 AND p.namespace = ?2 AND NOT EXISTS (
        SELECT 1 FROM project_events e WHERE e.owner_id = p.owner_id AND e.namespace = p.namespace
          AND e.project_id = p.id AND e.version = p.version AND e.status = p.status
      )) AS projects_without_receipts,
      (SELECT COUNT(*) FROM milestones m WHERE m.owner_id = ?1 AND m.namespace = ?2 AND NOT EXISTS (
        SELECT 1 FROM project_milestone_events e WHERE e.owner_id = m.owner_id AND e.namespace = m.namespace
          AND e.milestone_id = m.id AND e.version = m.version AND e.status = m.status
      )) AS milestones_without_receipts,
      (SELECT COUNT(*) FROM proposals t WHERE t.owner_id = ?1 AND t.namespace = ?2 AND t.project_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM projects p WHERE p.owner_id = t.owner_id AND p.namespace = t.namespace AND p.id = t.project_id
      )) AS tasks_without_projects,
      (SELECT COUNT(*) FROM proposals t WHERE t.owner_id = ?1 AND t.namespace = ?2
        AND t.engine IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM task_engine_events e WHERE e.owner_id = t.owner_id AND e.namespace = t.namespace
            AND e.task_id = t.task_id AND e.operation_id = json_extract(t.engine, '$.event.operation_id')
            AND e.event = json_extract(t.engine, '$.event')
        )
      ) AS tasks_without_engine_receipts,
      (SELECT COUNT(*) FROM (
        SELECT item.type, item.value
        FROM project_manual_order saved JOIN json_each(saved.project_ids) item
        WHERE saved.owner_id = ?1 AND saved.namespace = ?2
        GROUP BY item.type, item.value
        HAVING item.type <> 'text' OR COUNT(*) > 1 OR NOT EXISTS (
          SELECT 1 FROM projects p WHERE p.owner_id = ?1 AND p.namespace = ?2 AND p.id = item.value
        )
      )) AS invalid_project_order_references,
      (SELECT COUNT(*) FROM project_task_milestones link WHERE link.owner_id = ?1 AND link.namespace = ?2 AND NOT EXISTS (
        SELECT 1 FROM proposals t JOIN milestones m ON m.owner_id = t.owner_id AND m.namespace = t.namespace AND m.project_id = t.project_id
        WHERE t.owner_id = link.owner_id AND t.namespace = link.namespace AND t.task_id = link.task_id
          AND t.project_id = link.project_id AND m.id = link.milestone_id
      )) AS invalid_milestone_links,
      (SELECT COUNT(*) FROM project_task_gates g WHERE g.owner_id = ?1 AND g.namespace = ?2 AND (
        NOT EXISTS (SELECT 1 FROM proposals t WHERE t.owner_id = g.owner_id AND t.namespace = g.namespace AND t.task_id = g.task_id)
        OR NOT EXISTS (SELECT 1 FROM milestones m WHERE m.owner_id = g.owner_id AND m.namespace = g.namespace AND m.id = g.milestone_id)
      )) AS invalid_milestone_gates,
      (SELECT COUNT(*) FROM workspace_preferences p WHERE p.owner_id = ?1 AND p.namespace = ?2 AND NOT EXISTS (
        SELECT 1 FROM workspace_preference_events e WHERE e.owner_id = p.owner_id AND e.namespace = p.namespace
          AND e.version = p.version AND e.preferences = p.preferences AND e.updated_at = p.updated_at
      )) AS preferences_without_receipts,
      (SELECT COUNT(*) FROM integration_runs r WHERE r.owner_id = ?1 AND r.namespace = ?2 AND NOT EXISTS (
        SELECT 1 FROM integration_events e WHERE e.owner_id = r.owner_id AND e.namespace = r.namespace
          AND e.integration_id = r.id AND e.version = r.version AND e.event = r.event
      )) AS integrations_without_receipts
  `).bind(owner, namespace).first();
  return {
    ...base, checked_at: new Date().toISOString(),
    integrity: { status: Object.values(counts).some(count => count > 0) ? 'issues_found' : 'passed', ...counts },
  };
}
