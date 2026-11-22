import { useEffect, useRef, useState } from 'react';
import { Activity, Bell, Boxes, CalendarClock, Database, GitMerge, Github, Link2, Settings, ShieldCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { customTemplateLimits, validCustomProjectTemplates } from './project-templates.mjs';
import { taskHref } from './task-workspace.mjs';
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
  const telemetryReceipt = (execution?.sources ?? []).map(source => source.received_at).filter(Boolean).sort().at(-1);
  const identities = [['Application', settings.application.name], ['Settings scope', 'Signed-in owner in this application']];
  const rows = {
    general: identities,
    projects: [['Project repository', settings.application.repository], ['Manual card order', 'Saved for the signed-in owner in this application']],
    github: [['Repository', settings.application.repository], ['Read credential', configured(settings.connections.github.credential_configured)],
      ['Dedicated integration read credential', configured(settings.connections.github.integration_read_credential_configured)],
      ['Authentication', github?.api?.authentication ?? 'Unverified'], ['Main revision', github?.main?.revision], ['Main observation', githubState + ' · ' + date(observed)],
      ['Latest read issue', github?.main?.reason ?? 'None reported'], ['Requests remaining', github?.api?.remaining], ['Rate limit reset', date(github?.api?.reset_at)]],
    workers: [['Executor credential', configured(settings.connections.codex.credential_configured)], ['Dispatch', codex],
      ['Last worker heartbeat', date(dispatch?.at)],
      ['Last worker issue', worker?.last_error ? worker.last_error.state.replaceAll('_', ' ') + ' · ' + date(worker.last_error.at) : 'None reported'],
      ['Slots in use', worker?.active_slots], ['Maximum slots', settings.capacity]],
    scheduling: [['Task registry', engineState], ['Execution ceiling', settings.capacity],
      ['Prerequisites', 'The Task Engine checks dependency, milestone, and worker eligibility before claim.']],
    integration: [['Protected merge', settings.integration.merge_enabled ? 'Authorized' : 'Unavailable'], ['Publication', settings.integration.publish_enabled ? 'Authorized' : 'Unavailable'],
      ['Source repair', settings.integration.repair_enabled ? 'Owner authorized' : 'Unavailable'], ['Approval', 'Binds to the reviewed source revision']],
    connections: [['Backend and database', 'Verified · ' + date(settings.database_verified_at)], ['Site source revision', settings.revision],
      ['GitHub main', githubState + ' · ' + date(observed)], ['GitHub Actions', (github?.ci?.status ?? 'unverified') + ' · ' + date(github?.ci?.observed_at)],
      ['Latest GitHub Actions issue', github?.ci?.reason ?? 'None reported'], ['GitHub request budget', github?.api?.remaining],
      ['Codex workers', codex], ['Last worker issue', worker?.last_error ? worker.last_error.state.replaceAll('_', ' ') + ' · ' + date(worker.last_error.at) : 'None reported'],
      ['Task registry read', { available: 'Verified', checking: 'Checking', absent: 'Unavailable', error: 'Latest read failed' }[engineState]],
      ['Telemetry snapshot generated', date(execution?.generated_at)], ['Latest Task telemetry receipt', date(telemetryReceipt)]],
    security: [...identities, ['Credential access', 'Deployment-managed bindings'], ['Write access', 'Authenticated owner and same-origin mutation routes']],
    data: [['Database partition', 'Verified · ' + date(settings.database_verified_at)], ['Settings schema', 'Workspace preferences and audit available'],
      ['Backup and recovery', 'Requires deployment-side verification']],
    notifications: [['Attention Center', <a href="#activity">Open engineering activity</a>], ['External delivery', 'Unavailable from this Site']],
  };
  return <Facts rows={rows[category] ?? []}/>;
}

async function connectionProbe(path, init, interpret) {
  try {
    const response = await fetch(path, { ...init, cache: 'no-store' });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const message = interpret(await response.json());
    return { message, at: new Date().toISOString(), ok: true };
  } catch (error) {
    const message = /^HTTP \d{3}$/.test(error.message) ? error.message : 'Unexpected or unavailable response';
    return { message, at: new Date().toISOString(), ok: false };
  }
}

function ConnectionChecks({ settings, headers }) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  const connector = settings.connections.chatgpt;
  const run = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const probes = [['service', connectionProbe('/api/status', { headers, signal: controller.signal }, body => {
      if (body.status !== 'ready' || body.application?.id !== settings.application.id || !/^[0-9a-f]{40}$/.test(body.revision)) throw Error();
      return <>Ready for {settings.application.name} <code title={body.revision}>{body.revision.slice(0, 12)}</code></>;
    })]];
    if (connector?.discovery_here) probes.push(['discovery', connectionProbe('/api/settings/discovery', {
      headers, signal: controller.signal,
    }, body => {
      const names = new Set(body.tools);
      if (!['list_applications', 'task_engine_v1', 'projects_v1'].every(name => names.has(name))) throw Error();
      return 'Required tools discovered';
    })]);
    const outcomes = await Promise.all(probes.map(async ([key, probe]) => [key, await probe]));
    if (!controller.signal.aborted) {
      setResults(previous => Object.fromEntries(outcomes.map(([key, result]) => [key, {
        ...previous[key], latest: result.message, [result.ok ? 'passedAt' : 'failedAt']: result.at,
        ...(result.ok ? {} : { failure: result.message }),
      }])));
      request.current = null;
      setBusy(false);
    }
  };
  return <section aria-label="Connection checks">
    <h3>Connection checks</h3>
    <button type="button" className="quiet-button" onClick={run} disabled={busy}>{busy ? 'Verifying…' : 'Verify connections'}</button>
    <div role="status">
      <Facts rows={[
        ['Deployed service and database', results.service?.latest ?? 'Awaiting probe'],
        ['Last successful service probe', date(results.service?.passedAt)],
        ['Last service probe failure', results.service?.failure ? results.service.failure + ' · ' + date(results.service.failedAt) : 'None observed in this session'],
        ['Site MCP tool registry', connector?.discovery_here ? results.discovery?.latest ?? 'Awaiting probe' :
          connector?.connector_origin ? <a href={connector.connector_origin + '/#settings/connections'}>Verify on the shared connector Site</a> : 'Unavailable from this Site'],
        ...(connector?.discovery_here ? [
          ['Last successful discovery', date(results.discovery?.passedAt)],
          ['Last discovery failure', results.discovery?.failure ? results.discovery.failure + ' · ' + date(results.discovery.failedAt) : 'None observed in this session'],
        ] : []),
        ['External ChatGPT connection', 'Unverified from this Site'],
      ]}/>
    </div>
  </section>;
}

function DataChecks({ headers, revision }) {
  const [request, setRequest] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => () => request?.abort(), [request]);

  async function runChecks() {
    if (request) return;
    const controller = new AbortController();
    setRequest(controller);
    setError('');
    try {
      const response = await fetch('/api/settings/data', { headers, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw Error('The scoped data checks could not run.');
      const data = await response.json();
      if (!controller.signal.aborted) setResult(data);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setResult(null);
        setError(cause.message);
      }
    } finally {
      if (!controller.signal.aborted) setRequest(null);
    }
  }

  return <section aria-label="Data checks">
    <h3>Data checks</h3>
    <p>Check schema objects, engineering relationships, and audit receipts in this application and the current owner namespace.</p>
    <Facts rows={[
      ['Sites version rollback', 'Restores code only'],
      ['Database and file recovery', 'Requires a separately verified export and restore'],
    ]}/>
    <button type="button" className="quiet-button" onClick={runChecks} disabled={Boolean(request)}>
      {request ? 'Checking data…' : 'Run scoped data checks'}
    </button>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status">
      <Facts rows={[
        ['Checked', date(result.checked_at)],
        ['Schema objects', result.schema.status === 'current' ? result.schema.checked_objects + ' expected objects found' :
          'Missing ' + result.schema.missing.join(', ')],
        ['Observed schema migration marker', result.schema.observed_migration_marker],
        ['Scoped integrity', { passed: 'Passed', issues_found: 'Issues found', unverified: 'Unverified' }[result.integrity.status]],
        ['Projects missing current receipts', result.integrity.projects_without_receipts],
        ['Milestones missing current receipts', result.integrity.milestones_without_receipts],
        ['Tasks missing their Project', result.integrity.tasks_without_projects],
        ['Invalid milestone links', result.integrity.invalid_milestone_links],
        ['Invalid milestone gates', result.integrity.invalid_milestone_gates],
        ['Preferences missing current receipts', result.integrity.preferences_without_receipts],
        ['Integrations missing current receipts', result.integrity.integrations_without_receipts],
        ['Import checkpoint', result.import.status === 'no_checkpoint_in_served_partition' ? 'No checkpoint in the active partition' : 'Unverified'],
        ['Backup and restore', result.backup.status === 'unverified' ? 'Unverified by this Site' : 'Unavailable'],
      ]}/>
    </div>}
    {revision && <a href={'https://github.com/Kgray44/Engineering-Command-Core/blob/' + revision + '/docs/operations.md#troubleshooting-and-recovery'}>Backup and recovery runbook</a>}
  </section>;
}

function SchedulerObservations({ engine }) {
  const counts = { ready: 0, scheduled: 0, blocked: 0 };
  let nextStart = Infinity;
  for (const row of engine.status === 'available' ? engine.tasks : []) {
    const lifecycle = row.lifecycle;
    if (!['admitted', 'queued', 'scheduled'].includes(lifecycle.stored_state)) continue;
    const state = row.project_blocked ? 'blocked' : lifecycle.state;
    if (Object.hasOwn(counts, state)) counts[state]++;
    if (state === 'scheduled' && Number.isFinite(lifecycle.start_at)) nextStart = Math.min(nextStart, lifecycle.start_at);
  }
  return <section aria-label="Scheduler observations">
    <h3>Scheduler observations</h3>
    <Facts rows={[
      ['Last successful Task registry read', date(engine.observedAt)],
      ['Ready for worker claim', engine.status === 'available' ? counts.ready : 'Unverified'],
      ['Scheduled for later', engine.status === 'available' ? counts.scheduled : 'Unverified'],
      ['Blocked admitted Tasks', engine.status === 'available' ? counts.blocked : 'Unverified'],
      ['Next scheduled start', engine.status !== 'available' ? 'Unverified'
        : Number.isFinite(nextStart) ? date(nextStart) : 'None recorded'],
    ]}/>
    <div className="integration-actions">
      <a href={taskHref(undefined, 'waiting')}>Open waiting Tasks</a>
      <a href={taskHref(undefined, 'issues')}>Open at-risk Tasks</a>
    </div>
  </section>;
}

function CustomProjectTemplates({ templates, busy, onSave }) {
  const [selected, setSelected] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const template = templates.find(item => item.id === selected);
  const limits = customTemplateLimits;
  const full = !template && templates.length >= limits.count;
  async function submit(event) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const value = {
      id: template?.id ?? crypto.randomUUID(),
      label: fields.get('label').trim(),
      scope: fields.get('scope').trim(),
      acceptance: fields.get('acceptance').trim(),
      milestones: fields.get('milestones').split('\n').map(name => name.trim()).filter(Boolean),
    };
    const next = template ? templates.map(item => item.id === template.id ? value : item) : [...templates, value];
    if (!validCustomProjectTemplates(next)) {
      setError('Use a distinct template name and up to eight milestone names of 120 characters each. Shorten the template text if needed.');
      return;
    }
    setError('');
    if (await onSave(next)) setSelected(value.id);
  }
  return <section aria-label="Custom Project templates">
    <h3>Custom Project templates</h3>
    <form className="form" onSubmit={submit} key={template?.id ?? 'new'}>
      <label>Choose a custom template<select value={template?.id ?? ''} disabled={busy} onChange={event => {
        setSelected(event.target.value);
        setConfirmRemove(false);
        setError('');
      }}>
        <option value="">New custom template</option>
        {templates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {full ? <p>Four custom templates are saved. Choose one to edit or remove.</p> : <>
        <label>Template name<input name="label" defaultValue={template?.label} required maxLength={limits.label}/></label>
        <label>Template scope<textarea name="scope" defaultValue={template?.scope} maxLength={limits.text} rows={2}/></label>
        <label>Template acceptance requirements<textarea name="acceptance" defaultValue={template?.acceptance} maxLength={limits.text} rows={2}/></label>
        <label>Template milestones<textarea name="milestones" defaultValue={template?.milestones.join('\n')} placeholder="One milestone per line" rows={3}/></label>
        <div className="integration-actions">
          <button className="primary-button" disabled={busy}>Save template</button>
          {template && <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove template</button>}
        </div>
      </>}
      {confirmRemove && template && <div className="notice" role="group" aria-label="Confirm template removal">
        <span>Remove {template.label} from custom templates?</span>
        <button type="button" className="primary-button" disabled={busy} onClick={async () => {
          if (await onSave(templates.filter(item => item.id !== template.id))) {
            setSelected('');
            setConfirmRemove(false);
          }
        }}>Confirm removal</button>
        <button type="button" className="quiet-button" onClick={() => setConfirmRemove(false)}>Keep template</button>
      </div>}
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}

export function EngineeringSettings({ category, headers, settings, onSettings, github, dispatch, worker, execution, engine, demo }) {
  const reduced = useReducedMotion();
  const active = categories.find(([id]) => id === category);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fields = Object.entries(preferenceFields).filter(([, field]) => field.category === category);
  const saved = settings?.preferences;
  const dirty = fields.some(([key]) => draft[key] !== undefined && draft[key] !== saved?.values[key]);
  useEffect(() => { setDraft({}); setMessage(''); setConfirmReset(false); }, [category]);
  async function update(op, customTemplates) {
    if (!saved || busy) return;
    setBusy(true);
    setMessage('');
    setConfirmReset(false);
    try {
      const values = customTemplates ? { project_templates: customTemplates } : Object.fromEntries(fields.filter(([key]) => draft[key] !== undefined && saved.values[key] !== draft[key])
        .map(([key]) => [key, draft[key]]));
      const result = await settingsRequest(headers, { op, expected_version: saved.version,
        ...(op === 'save' ? { values } : { keys: fields.map(([key]) => key) }) });
      onSettings({ ...settings, preferences: result.preferences,
        audit: [result.preferences, ...settings.audit].slice(0, 15) });
      if (!customTemplates) setDraft({});
      setMessage(customTemplates ? 'Custom templates saved.' : op === 'save' ? 'Settings saved.' : 'Category defaults restored.');
      return true;
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
    {settings && <Diagnostics {...{ category, settings, github, dispatch, worker, execution }} engineState={engine.status}/>}
    {category === 'github' && /^[0-9a-f]{40}$/.test(settings?.revision ?? '') &&
      <a href={'https://github.com/Kgray44/Engineering-Command-Core/blob/' + settings.revision + '/docs/deployment.md#staging-github-read-credentials'}>
        GitHub credential setup and troubleshooting
      </a>}
    {category === 'connections' && settings && <ConnectionChecks headers={headers} settings={settings}/>}
    {category === 'scheduling' && settings && <SchedulerObservations engine={engine}/>}
    {category === 'data' && settings && <DataChecks headers={headers} revision={settings.revision}/>}
    {settings && fields.length > 0 && <form className="form" onSubmit={event => { event.preventDefault(); if (dirty) update('save'); }}>
      {fields.map(([key, field]) => <label key={key}>{field.label}
        <select value={draft[key] ?? saved.values[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}>
          {Object.entries(field.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>)}
      <div className="integration-actions">
        <button className="primary-button" disabled={busy || !dirty}>Save changes</button>
        <button type="button" className="quiet-button" disabled={busy || !dirty} onClick={() => setDraft({})}>Cancel changes</button>
        <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirmReset(true)} aria-expanded={confirmReset}>Restore defaults</button>
      </div>
      {confirmReset && <div className="notice" role="group" aria-label="Confirm category reset">
        <span>Restore the defaults for {active[1]} in this application?</span>
        <button type="button" className="primary-button" onClick={() => update('reset')}>Confirm restore</button>
        <button type="button" className="quiet-button" onClick={() => setConfirmReset(false)}>Keep settings</button>
      </div>}
    </form>}
    {category === 'projects' && settings && <CustomProjectTemplates templates={saved.values.project_templates ?? []}
      busy={busy} onSave={templates => update('save', templates)}/>}
    {category === 'security' && settings && <details><summary>Settings audit</summary>
      {settings.audit.length ? <ol>{settings.audit.map(entry => <li key={entry.version}>Revision {entry.version} · {date(entry.updated_at)}</li>)}</ol>
        : <p>No workspace preference changes recorded.</p>}
    </details>}
    <div className="integration-actions">
      <button type="button" className="quiet-button" disabled={busy} onClick={refresh}>{settings ? 'Refresh settings' : 'Load settings'}</button>
      {category === 'connections' && <>
        <a href="#activity">Open activity</a><a href="#settings/github">Troubleshoot GitHub</a><a href="#settings/workers">Troubleshoot workers</a>
      </>}
    </div>
    <p role="status">{message || (!settings ? 'Waiting for the settings service.' : '')}</p>
  </motion.section>;
}
