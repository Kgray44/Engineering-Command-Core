import { useEffect, useState } from 'react';
import { Activity, Bell, Boxes, CalendarClock, Database, GitMerge, Github, Link2, Settings, ShieldCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { preferenceFields } from './workspace-preferences.mjs';

const categories = [
  ['general', 'General', 'Landing page and display preferences', Settings],
  ['projects', 'Projects', 'Default layout, sorting, and priority', Boxes],
  ['github', 'GitHub', 'Repository binding, access, and request budget', Github],
  ['workers', 'Codex & Workers', 'Worker heartbeat and execution slots', Activity],
  ['scheduling', 'Scheduling', 'Capacity and prerequisite policy', CalendarClock],
  ['integration', 'Integration', 'Pull request filters and protected actions', GitMerge],
  ['connections', 'Connections', 'Service, GitHub, worker, and connector observations', Link2],
  ['security', 'Security', 'Application access and settings audit', ShieldCheck],
  ['data', 'Data & Backup', 'Database, schema checks, and recovery evidence', Database],
  ['notifications', 'Notifications', 'Engineering attention and delivery availability', Bell],
];
const date = value => value ? new Date(value).toLocaleString() : 'Unverified';
const configured = value => value ? 'Configured' : 'Unconfigured';

export async function settingsRequest(headers, body, signal) {
  const response = await fetch('/api/settings', {
    cache: 'no-store', signal,
    ...(body ? { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(payload.error ?? 'Settings service unavailable'), { status: response.status });
  return payload;
}

function Facts({ rows }) {
  return <dl className="settings-facts">{rows.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value ?? 'Unavailable'}</dd></div>)}</dl>;
}

function Diagnostics({ category, settings, github, dispatch, worker, execution, engineState }) {
  const observed = github?.main?.observed_at;
  const githubState = github?.main?.status ?? 'unverified';
  const codex = dispatch?.at ? dispatch.label : 'Heartbeat unverified';
  const identities = [['Application', settings.application.name], ['Settings scope', 'Signed-in owner in this application']];
  const rows = {
    general: identities,
    projects: [['Project repository', settings.application.repository], ['Manual card order', 'Saved for the signed-in owner in this application']],
    github: [['Repository', settings.application.repository], ['Read credential', configured(settings.connections.github.credential_configured)],
      ['Authentication', github?.api?.authentication ?? 'Unverified'], ['Main revision', github?.main?.revision], ['Main observation', githubState + ' · ' + date(observed)],
      ['Latest read issue', github?.main?.reason ?? 'None reported'], ['Requests remaining', github?.api?.remaining], ['Rate limit reset', date(github?.api?.reset_at)]],
    workers: [['Executor credential', configured(settings.connections.codex.credential_configured)], ['Dispatch', codex],
      ['Last worker heartbeat', date(dispatch?.at)], ['Slots in use', worker?.active_slots], ['Maximum slots', settings.capacity]],
    scheduling: [['Task registry', engineState], ['Execution ceiling', settings.capacity],
      ['Prerequisites', 'The Task Engine checks dependency, milestone, and worker eligibility before claim.']],
    integration: [['Protected merge', settings.integration.merge_enabled ? 'Authorized' : 'Unavailable'], ['Publication', settings.integration.publish_enabled ? 'Authorized' : 'Unavailable'],
      ['Source repair', settings.integration.repair_enabled ? 'Owner authorized' : 'Unavailable'], ['Approval', 'Binds to the reviewed source revision']],
    connections: [['Backend and database', 'Verified · ' + date(settings.database_verified_at)], ['Site source revision', settings.revision],
      ['GitHub main', githubState + ' · ' + date(observed)], ['GitHub Actions', (github?.ci?.status ?? 'unverified') + ' · ' + date(github?.ci?.observed_at)],
      ['Codex workers', codex], ['Task scheduler', engineState], ['Telemetry snapshot', date(execution?.generated_at)], ['ChatGPT connector', 'Unverified from this Site']],
    security: [...identities, ['Credential access', 'Deployment-managed bindings'], ['Write access', 'Authenticated owner and same-origin mutation routes']],
    data: [['Database partition', 'Verified · ' + date(settings.database_verified_at)], ['Settings schema', 'Workspace preferences and audit available'],
      ['Backup and recovery', 'Requires deployment-side verification']],
    notifications: [['Attention Center', <a href="#activity">Open engineering activity</a>], ['External delivery', 'Unavailable from this Site']],
  };
  return <Facts rows={rows[category] ?? []}/>;
}

export function EngineeringSettings({ category, headers, settings, onSettings, github, dispatch, worker, execution, engineState, demo }) {
  const reduced = useReducedMotion();
  const active = categories.find(([id]) => id === category);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fields = Object.entries(preferenceFields).filter(([, field]) => field.category === category);
  const saved = settings?.preferences;
  const dirty = fields.some(([key]) => draft[key] !== undefined && draft[key] !== saved?.values[key]);
  useEffect(() => { setDraft({}); setMessage(''); }, [category]);
  async function update(op) {
    if (!saved || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const values = Object.fromEntries(fields.filter(([key]) => draft[key] !== undefined && saved.values[key] !== draft[key])
        .map(([key]) => [key, draft[key]]));
      const result = await settingsRequest(headers, { op, expected_version: saved.version,
        ...(op === 'save' ? { values } : { keys: fields.map(([key]) => key) }) });
      onSettings({ ...settings, preferences: result.preferences,
        audit: [result.preferences, ...settings.audit].slice(0, 15) });
      setDraft({});
      setMessage(op === 'save' ? 'Settings saved.' : 'Category defaults restored.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    setMessage('');
    try {
      onSettings(await settingsRequest(headers));
      setDraft({});
      setMessage('Settings refreshed.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  if (demo) return <p className="notice">Open Live mode to read and change engineering settings.</p>;
  if (!active) return <div className="settings-grid">{categories.map(([id, title, description, Icon]) =>
    <motion.a href={'#settings/' + id} className="panel settings-card" key={id} whileHover={reduced ? undefined : { y: -3 }}>
      <Icon size={24} aria-hidden="true"/><h2>{title}</h2><p>{description}</p>
    </motion.a>)}</div>;
  return <motion.section className="panel settings-detail" key={category}
    initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
    <a className="back" href="#settings">All settings</a>
    <h2>{active[1]}</h2>
    {settings && <Diagnostics {...{ category, settings, github, dispatch, worker, execution, engineState }}/>}
    {settings && fields.length > 0 && <form className="form" onSubmit={event => { event.preventDefault(); if (dirty) update('save'); }}>
      {fields.map(([key, field]) => <label key={key}>{field.label}
        <select value={draft[key] ?? saved.values[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}>
          {Object.entries(field.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>)}
      <div className="integration-actions">
        <button className="primary-button" disabled={busy || !dirty}>Save changes</button>
        <button type="button" className="quiet-button" disabled={busy || !dirty} onClick={() => setDraft({})}>Cancel changes</button>
        <button type="button" className="quiet-button" disabled={busy} onClick={() => update('reset')}>Restore defaults</button>
      </div>
    </form>}
    {category === 'security' && settings && <details><summary>Settings audit</summary>
      {settings.audit.length ? <ol>{settings.audit.map(entry => <li key={entry.version}>Revision {entry.version} · {date(entry.updated_at)}</li>)}</ol>
        : <p>No workspace preference changes recorded.</p>}
    </details>}
    <div className="integration-actions">
      <button type="button" className="quiet-button" disabled={busy} onClick={refresh}>{settings ? 'Refresh settings' : 'Load settings'}</button>
      {category === 'connections' && <a href="#activity">Open activity</a>}
    </div>
    <p role="status">{message || (!settings ? 'Waiting for the settings service.' : '')}</p>
  </motion.section>;
}
