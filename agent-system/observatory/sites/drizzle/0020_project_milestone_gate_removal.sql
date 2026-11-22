CREATE INDEX project_milestone_gate_receipt
ON project_relationship_events(owner_id, namespace, task_id, milestone_id, event_id)
WHERE kind = 'milestone_gate_set';
--> statement-breakpoint
CREATE TRIGGER project_milestone_gate_removed AFTER DELETE ON project_task_gates
BEGIN
  INSERT INTO project_relationship_events(owner_id, namespace, project_id, task_id, milestone_id, kind, occurred_at)
  SELECT OLD.owner_id, OLD.namespace, p.project_id, OLD.task_id, OLD.milestone_id, 'milestone_gate_removed', strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM proposals p WHERE p.owner_id = OLD.owner_id AND p.namespace = OLD.namespace AND p.task_id = OLD.task_id
    AND p.project_id IS NOT NULL;
END;
