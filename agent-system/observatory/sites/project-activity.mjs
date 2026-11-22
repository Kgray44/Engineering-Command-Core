export async function readProjectActivity(db, owner, namespace) {
  const { results } = await db.prepare(`
    WITH recent AS (
      SELECT 'project:' || project_id || ':' || version AS id, project_id,
        CASE WHEN version = 1 THEN 'project_created' ELSE 'project_changed' END AS kind,
        NULL AS task_id, NULL AS milestone_id, NULL AS milestone_name, occurred_at, status
      FROM project_events WHERE owner_id = ?1 AND namespace = ?2
      UNION ALL
      SELECT 'milestone:' || e.milestone_id || ':' || e.version, m.project_id, 'milestone_changed',
        NULL, e.milestone_id, m.name, e.occurred_at, e.status
      FROM project_milestone_events e JOIN milestones m
        ON m.owner_id = e.owner_id AND m.namespace = e.namespace AND m.id = e.milestone_id
      WHERE e.owner_id = ?1 AND e.namespace = ?2
      UNION ALL
      SELECT 'relationship:' || e.event_id, e.project_id, e.kind, e.task_id, e.milestone_id, m.name, e.occurred_at, NULL
      FROM project_relationship_events e LEFT JOIN milestones m
        ON m.owner_id = e.owner_id AND m.namespace = e.namespace AND m.id = e.milestone_id
      WHERE e.owner_id = ?1 AND e.namespace = ?2
      ORDER BY occurred_at DESC, id DESC LIMIT 24
    )
    SELECT recent.*, json_extract(p.metadata, '$.name') AS project_name
    FROM recent JOIN projects p ON p.owner_id = ?1 AND p.namespace = ?2 AND p.id = recent.project_id
    ORDER BY recent.occurred_at DESC, recent.id DESC
  `).bind(owner, namespace).all();
  return results.map(({ project_id, project_name, milestone_id, milestone_name, ...row }) => ({
    ...row,
    project: { id: project_id, name: project_name },
    ...(milestone_id ? { milestone: { id: milestone_id, name: milestone_name } } : {}),
  }));
}
