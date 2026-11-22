CREATE TABLE project_manual_order (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  project_ids TEXT NOT NULL CHECK (json_valid(project_ids) AND json_type(project_ids) = 'array'),
  PRIMARY KEY (owner_id, namespace)
);
