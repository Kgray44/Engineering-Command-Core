CREATE TABLE application_partition (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  application_id TEXT NOT NULL UNIQUE,
  repository TEXT NOT NULL,
  portfolio_id TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE projects (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'paused', 'archived')),
  metadata TEXT NOT NULL CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, id)
);
--> statement-breakpoint
CREATE TABLE project_events (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  metadata TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, project_id, version),
  FOREIGN KEY (owner_id, namespace, project_id) REFERENCES projects (owner_id, namespace, id)
);
--> statement-breakpoint
CREATE TRIGGER project_created AFTER INSERT ON projects
BEGIN
  INSERT INTO project_events VALUES (NEW.owner_id, NEW.namespace, NEW.id, NEW.version, NEW.status, NEW.metadata, NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER project_changed AFTER UPDATE ON projects
BEGIN
  INSERT INTO project_events VALUES (NEW.owner_id, NEW.namespace, NEW.id, NEW.version, NEW.status, NEW.metadata, NEW.updated_at);
END;
--> statement-breakpoint
CREATE TABLE milestones (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  name TEXT NOT NULL,
  acceptance TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'verified', 'integrated', 'accepted')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, id),
  UNIQUE (owner_id, namespace, project_id, id),
  FOREIGN KEY (owner_id, namespace, project_id) REFERENCES projects (owner_id, namespace, id)
);
--> statement-breakpoint
CREATE TABLE project_milestone_events (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, milestone_id, version),
  FOREIGN KEY (owner_id, namespace, milestone_id) REFERENCES milestones (owner_id, namespace, id)
);
--> statement-breakpoint
CREATE TRIGGER milestone_created AFTER INSERT ON milestones
BEGIN
  INSERT INTO project_milestone_events VALUES (NEW.owner_id, NEW.namespace, NEW.id, NEW.version, NEW.status, NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER milestone_changed AFTER UPDATE ON milestones
BEGIN
  INSERT INTO project_milestone_events VALUES (NEW.owner_id, NEW.namespace, NEW.id, NEW.version, NEW.status, NEW.updated_at);
END;
--> statement-breakpoint
ALTER TABLE proposals ADD COLUMN project_id TEXT;
--> statement-breakpoint
CREATE INDEX proposals_project ON proposals(owner_id, namespace, project_id);
--> statement-breakpoint
CREATE TRIGGER proposal_project_insert BEFORE INSERT ON proposals
WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE owner_id = NEW.owner_id AND namespace = NEW.namespace
    AND id = NEW.project_id AND status <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid project scope');
END;
--> statement-breakpoint
CREATE TRIGGER proposal_project_update BEFORE UPDATE OF project_id ON proposals
WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM projects WHERE owner_id = NEW.owner_id AND namespace = NEW.namespace
    AND id = NEW.project_id AND status <> 'archived'
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid project scope');
END;
--> statement-breakpoint
CREATE TABLE project_task_milestones (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, task_id, milestone_id),
  FOREIGN KEY (owner_id, namespace, task_id) REFERENCES proposals (owner_id, namespace, task_id),
  FOREIGN KEY (owner_id, namespace, project_id, milestone_id) REFERENCES milestones (owner_id, namespace, project_id, id)
);
--> statement-breakpoint
CREATE TABLE project_task_gates (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, task_id, milestone_id),
  FOREIGN KEY (owner_id, namespace, task_id) REFERENCES proposals (owner_id, namespace, task_id),
  FOREIGN KEY (owner_id, namespace, milestone_id) REFERENCES milestones (owner_id, namespace, id)
);
