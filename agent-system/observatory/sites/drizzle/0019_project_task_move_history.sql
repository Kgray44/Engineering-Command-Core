CREATE TRIGGER project_task_moved_out AFTER UPDATE OF project_id ON proposals
WHEN OLD.project_id IS NOT NULL AND NEW.project_id IS NOT OLD.project_id
BEGIN
  INSERT INTO project_relationship_events(owner_id, namespace, project_id, task_id, kind, occurred_at)
  VALUES (OLD.owner_id, OLD.namespace, OLD.project_id, OLD.task_id, 'task_moved_out', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
