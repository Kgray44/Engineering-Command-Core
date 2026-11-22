import { validCustomProjectTemplates } from '../src/project-templates.mjs';
import { defaultPreferences, preferenceFields } from '../src/workspace-preferences.mjs';

const snapshot = row => ({
  version: row?.version ?? 0,
  values: { ...defaultPreferences, ...(row ? JSON.parse(row.preferences) : {}) },
  updated_at: row?.updated_at ?? null,
});
const result = (body, status = 200) => ({ body, status });
const error = (message, status) => result({ error: message }, status);

export async function workspaceSettings({ db, owner, namespace, body, facts }) {
  const select = sql => db.prepare(sql).bind(owner, namespace);
  const current = await select('SELECT version, preferences, updated_at FROM workspace_preferences WHERE owner_id = ? AND namespace = ?').first();
  if (body === undefined) {
    const { results } = await select('SELECT version, preferences, updated_at FROM workspace_preference_events WHERE owner_id = ? AND namespace = ? ORDER BY version DESC LIMIT 15').all();
    return result({ ...facts, preferences: snapshot(current), audit: results.map(snapshot) });
  }
  if (!body || !['save', 'reset'].includes(body.op) || !Number.isSafeInteger(body.expected_version) || body.expected_version < 0) {
    return error('Invalid settings request', 400);
  }
  const keys = body.op === 'save' ? Object.keys(body.values ?? {}) : body.keys;
  const allowed = key => {
    if (key === 'project_templates') return body.op === 'save' && validCustomProjectTemplates(body.values[key]);
    if (typeof key !== 'string' || !Object.hasOwn(preferenceFields, key)) return false;
    return body.op === 'reset' || (typeof body.values[key] === 'string' && Object.hasOwn(preferenceFields[key].choices, body.values[key]));
  };
  if (!Array.isArray(keys) || !keys.length || !keys.every(allowed)) {
    return error('Invalid or unsupported workspace preference', 400);
  }
  const version = body.expected_version;
  if (version !== (current?.version ?? 0)) return error('Settings changed. Reload them before saving.', 409);
  const values = { ...snapshot(current).values };
  for (const key of keys) values[key] = body.op === 'save' ? body.values[key] : defaultPreferences[key];
  const row = await db.prepare(`
    INSERT INTO workspace_preferences (owner_id, namespace, version, preferences, updated_at)
    SELECT ?1, ?2, ?3 + 1, ?4, ?5
    WHERE COALESCE((SELECT version FROM workspace_preferences WHERE owner_id = ?1 AND namespace = ?2), 0) = ?3
    ON CONFLICT (owner_id, namespace) DO UPDATE SET version = excluded.version,
      preferences = excluded.preferences, updated_at = excluded.updated_at
    RETURNING version, preferences, updated_at
  `).bind(owner, namespace, version, JSON.stringify(values), new Date().toISOString()).first();
  return row ? result({ preferences: snapshot(row) }) : error('Settings changed. Reload them before saving.', 409);
}
