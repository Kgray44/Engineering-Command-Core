CREATE TABLE workspace_preferences (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  preferences TEXT NOT NULL CHECK (json_valid(preferences) AND json_type(preferences) = 'object'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace)
);
--> statement-breakpoint
CREATE TABLE workspace_preference_events (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  version INTEGER NOT NULL,
  preferences TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, version)
);
--> statement-breakpoint
CREATE TRIGGER workspace_preference_insert AFTER INSERT ON workspace_preferences
BEGIN
  INSERT INTO workspace_preference_events VALUES (NEW.owner_id, NEW.namespace, NEW.version, NEW.preferences, NEW.updated_at);
END;
--> statement-breakpoint
CREATE TRIGGER workspace_preference_update AFTER UPDATE ON workspace_preferences
BEGIN
  INSERT INTO workspace_preference_events VALUES (NEW.owner_id, NEW.namespace, NEW.version, NEW.preferences, NEW.updated_at);
END;
