import { useEffect, useRef, useState } from 'react';
import { taskHref } from './task-workspace.mjs';

const stages = ['planned', 'active', 'paused', 'archived'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const milestoneStages = ['planned', 'verified', 'integrated', 'accepted'];
const number = value => value === null || value === undefined ? 'Unavailable' : value.toLocaleString();
const object = form => Object.fromEntries(new FormData(form));

export async function projectRequest(body, headers = {}, { id, signal } = {}) {
  const response = await fetch('/api/projects' + (id ? '/' + id : ''), {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'Projects service unavailable');
  return data;
}

function Options({ values }) {
  return values.map(value => <option key={value} value={value}>{value}</option>);
}

function ProjectForm({ project = {}, onSave, busy }) {
  return <form className="form" onSubmit={event => {
    event.preventDefault();
    const { participants, ...fields } = object(event.currentTarget);
    onSave({ ...fields, participants: participants.split(',').map(value => value.trim()).filter(Boolean) });
  }}>
    <label>Name <input name="name" defaultValue={project.name} required maxLength={150}/></label>
    <label>Objective <textarea name="objective" defaultValue={project.objective} required maxLength={16000}/></label>
    <label>Description <textarea name="description" defaultValue={project.description} maxLength={4000}/></label>
    <label>Scope <textarea name="scope" defaultValue={project.scope} maxLength={16000}/></label>
    <label>Acceptance requirements <textarea name="acceptance" defaultValue={project.acceptance} maxLength={16000}/></label>
    <div className="form-grid">
      <label>Start date <input type="date" name="start_date" defaultValue={project.start_date}/></label>
      <label>Target date <input type="date" name="target_date" defaultValue={project.target_date}/></label>
      <label>Priority <select name="priority" defaultValue={project.priority ?? 'normal'}><Options values={priorities}/></select></label>
      <label>Participants <input name="participants" defaultValue={project.participants?.join(', ')} placeholder="Comma-separated names"/></label>
      <label>Technical completion <select name="technical_state" defaultValue={project.technical_state ?? ''}><Options values={['', 'in_progress', 'verified', 'integrated', 'delivered']}/></select></label>
      <label>Owner review <select name="owner_review" defaultValue={project.owner_review ?? ''}><Options values={['', 'pending', 'accepted', 'declined']}/></select></label>
    </div>
    <button className="primary-button" disabled={busy}>{project.id ? 'Save project' : 'Create project'}</button>
  </form>;
}

function MilestoneForm({ milestone, onSave, busy }) {
  const operation = useRef(crypto.randomUUID());
  return <form className="form" onSubmit={event => {
    event.preventDefault();
    onSave({ ...object(event.currentTarget), milestone_id: milestone?.id ?? operation.current,
      ...(milestone ? { expected_version: milestone.version } : {}) });
  }}>
    <label>Milestone name <input name="name" defaultValue={milestone?.name} required maxLength={150}/></label>
    <label>Acceptance evidence required <textarea name="acceptance" defaultValue={milestone?.acceptance} required maxLength={16000}/></label>
    <label>Milestone state <select name="status" defaultValue={milestone?.status ?? 'planned'}><Options values={milestoneStages}/></select></label>
    <button className="quiet-button" disabled={busy}>{milestone ? 'Save milestone' : 'Add milestone'}</button>
  </form>;
}

export function ProjectsWorkspace({ projectId, headers, Panel, Status, onNewTask, demo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [other, setOther] = useState(null);
  const [taskList, setTaskList] = useState([]);
  const createId = useRef(crypto.randomUUID());
  const pending = useRef(false);
  const load = async signal => setData(await projectRequest(null, headers, { id: projectId, signal }));
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void load(controller.signal).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    if (projectId) {
      void projectRequest(null, headers, { signal: controller.signal }).then(setTaskList).catch(() => {});
    }
    return () => controller.abort();
  }, [projectId, demo, headers]);
  useEffect(() => {
    if (!selectedProject) return;
    const controller = new AbortController();
    void projectRequest(null, headers, { id: selectedProject, signal: controller.signal }).then(setOther).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, [headers, selectedProject]);
  const submit = async (request, onSuccess) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await projectRequest({ id: projectId, ...request }, headers);
      onSuccess?.(result);
      if (request.op !== 'create') await load();
    } catch (error) {
      setError(error.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (demo) return <p className="notice">Use Live mode to open your Projects.</p>;
  const { application, projects = [], project, tasks = [], milestones = [], telemetry, history = [], dependencies = [], task_milestones = [], artifacts = [], github = [], progress, integrations = [] } = data ?? {};
  const results = projects.filter(item => (!filter || item.status === filter) &&
    [item.name, item.description, item.objective].some(value => value?.toLowerCase().includes(query.toLowerCase())));
  return <div className="projects-workspace">
    {error && <p className="notice error" role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading Projects…</p>}
    {application && <Panel title={application.name} kicker="PORTFOLIO">
      <p>{projects.length} Projects · {projects.filter(item => item.status === 'active').length} active · {projects.filter(item => item.owner_review === 'pending').length} awaiting review</p>
      <p>{data.unassigned_tasks} Tasks awaiting Project association</p>
    </Panel>}
    {application && <Panel title="Project Explorer" right={<button className="primary-button" onClick={() => setEdit(!edit)}>{edit ? 'Close form' : 'New project'}</button>}>
      <div className="form form-grid">
        <label>Search projects <input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <label>Project status <select value={filter} onChange={event => setFilter(event.target.value)}><option value="">All</option><Options values={stages}/></select></label>
      </div>
      <ul className="project-list">{results.map(item => <li key={item.id}>
        <a className="text-button" href={'#projects/' + item.id}>{item.name}</a> <Status value={item.status}/><small>{item.priority}</small>
        {item.progress && <small>{item.progress.tasks.completed}/{item.progress.tasks.total} Tasks complete · {item.progress.tasks.active} running · {item.progress.tasks.blocked} blocked · {item.progress.milestones.accepted}/{item.progress.milestones.total} milestones accepted{item.progress.owner_review === 'pending' ? ' · Owner review pending' : ''}</small>}
      </li>)}</ul>
      {!results.length && <p>No projects match the current view.</p>}
      {edit && <ProjectForm busy={busy} onSave={fields => submit({ op: 'create', id: createId.current, fields }, result => {
        window.location.hash = '#projects/' + result.project.id;
      })}/>}
    </Panel>}
    {project && <>
      <a href="#projects" className="text-button">All projects</a>
      <Panel title={project.name} right={<Status value={project.status}/>}>
        <p>{project.objective}</p>
        {project.description && <p>{project.description}</p>}
        {project.scope && <p><strong>Scope</strong> {project.scope}</p>}
        <p><strong>Repository</strong> {project.repositories?.join(', ')}</p>
        <p><strong>Acceptance requirements</strong> {project.acceptance || 'Unspecified'}</p>
        <p><strong>Technical completion</strong> {project.technical_state || 'Unspecified'} · <strong>Owner review</strong> {project.owner_review || 'Unspecified'}</p>
        <div className="project-actions">
          <button className="quiet-button" onClick={() => setEdit(!edit)}>{edit ? 'Close form' : 'Edit project'}</button>
          {stages.filter(stage => stage !== 'planned' && stage !== project.status).map(stage =>
            <button className="quiet-button" key={stage} disabled={busy} onClick={() => submit({ op: 'update', expected_version: project.version, status: stage })}>
              {{active:'Activate', paused:'Pause', archived:'Archive'}[stage]}
            </button>)}
        </div>
        {edit && <ProjectForm key={project.version} project={project} busy={busy}
          onSave={fields => submit({ op: 'update', expected_version: project.version, fields }, () => setEdit(false))}/>}
      </Panel>
      <div className="wide-grid">
        <Panel title="Milestones" right={project.status !== 'archived' && <button className="quiet-button" onClick={() => setAddingMilestone(!addingMilestone)}>
          {addingMilestone ? 'Close form' : 'New milestone'}</button>}>
          {milestones.map(milestone => <details key={milestone.id}>
            <summary>{milestone.name} <Status value={milestone.status}/></summary>
            <p>{milestone.acceptance}</p>
            {project.status !== 'archived' && <MilestoneForm key={milestone.version} milestone={milestone} busy={busy} onSave={fields => submit({ op: 'milestone', ...fields })}/>}
          </details>)}
          {!milestones.length && <p>No milestones recorded.</p>}
          {addingMilestone && <MilestoneForm busy={busy} onSave={fields => submit({ op: 'milestone', ...fields }, () => setAddingMilestone(false))}/>}
        </Panel>
        <Panel title="Execution and telemetry">
          <p>{progress.tasks.completed} of {progress.tasks.total} Tasks complete · {progress.tasks.active} running · {progress.tasks.blocked} blocked · {progress.tasks.verifying} verifying</p>
          <dl className="project-metrics">
            <dt>Tasks</dt><dd>{tasks.length}</dd>
            <dt>Accepted Tasks</dt><dd>{tasks.filter(task => task.owner_acceptance === 'accepted').length}</dd>
            <dt>Accepted milestones</dt><dd>{milestones.filter(item => item.status === 'accepted').length}</dd>
            <dt>Attempts</dt><dd>{telemetry.attempts}</dd>
            <dt>Retries</dt><dd>{telemetry.retries}</dd>
            <dt>Failed or orphaned</dt><dd>{telemetry.failures}</dd>
            <dt>Attempts with recorded token usage</dt><dd>{telemetry.measured_attempts}</dd>
            <dt>Recorded attempt duration</dt><dd>{telemetry.execution_ms === null ? 'Unavailable' : number(Math.round(telemetry.execution_ms / 1000)) + ' s'}</dd>
            <dt>Execution cost</dt><dd>{number(telemetry.costs)}</dd>
            <dt>CI usage</dt><dd>{number(telemetry.ci_usage)}</dd>
            <dt>Input tokens</dt><dd>{number(telemetry.input_tokens)}</dd>
            <dt>Cached input tokens</dt><dd>{number(telemetry.cached_input_tokens)}</dd>
            <dt>Output tokens</dt><dd>{number(telemetry.output_tokens)}</dd>
          </dl>
        </Panel>
      </div>
      <Panel title="Tasks" right={project.status !== 'archived' && <button className="primary-button" onClick={() => onNewTask(project)}>New project task</button>}>
        <ul className="project-list">{tasks.map(task => <li key={task.id}>
          <a className="text-button" href={taskHref(task.id)}>{task.title}</a> <Status value={task.state}/>
          {task.branch && <small>{task.branch}</small>}
          {task.blockers.map(item => <small key={item.type + ':' + item.id}>
            {item.type === 'milestone' ? dependencies.find(gate => gate.milestone_id === item.id)?.name ?? item.id :
              item.type === 'project' ? project.name : tasks.find(related => related.id === item.id)?.title ?? item.id} · {item.state}
          </small>)}
          {task_milestones.filter(link => link.task_id === task.id).map(link => <small key={link.milestone_id}>{milestones.find(item => item.id === link.milestone_id)?.name}</small>)}
        </li>)}</ul>
        {!tasks.length && <p>No linked tasks.</p>}
        {project.status !== 'archived' && <details><summary>Associate an existing Task</summary>
          <form className="form" onSubmit={event => {
            event.preventDefault();
            const fields = object(event.currentTarget);
            submit({ op: 'link_task', task_id: fields.task_id, expected_version: Number(fields.version) });
          }}>
            <label>Task ID <input name="task_id" required/></label>
            <label>Current Task version <input name="version" type="number" min="1" required/></label>
            <button className="quiet-button" disabled={busy}>Link Task</button>
          </form>
        </details>}
      </Panel>
      <Panel title="Dependencies">
        <ul className="project-list">{dependencies.map(item => <li key={item.task_id + item.milestone_id}>
          <a className="text-button" href={taskHref(item.task_id)}>{tasks.find(task => task.id === item.task_id)?.title}</a>
          <a className="text-button" href={'#projects/' + item.project_id}>{item.name}</a> <Status value={item.status}/>
        </li>)}</ul>
        {!dependencies.length && <p>No milestone gates recorded.</p>}
        {project.status !== 'archived' && tasks.length > 0 && <details><summary>Link a milestone</summary>
          <form className="form" onSubmit={event => {
            event.preventDefault();
            submit({ op: selectedProject ? 'milestone_gate' : 'milestone_link', ...object(event.currentTarget) });
          }}>
            <label>Task <select name="task_id" required>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
            <label>Project <select value={selectedProject} onChange={event => { setOther(null); setSelectedProject(event.target.value); }}>
              <option value="">Current project</option>{(taskList.projects ?? []).filter(item => item.id !== project.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <label>Milestone <select name="milestone_id" required><option value="">Select milestone</option>
              {(selectedProject ? other?.milestones ?? [] : milestones).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <button className="quiet-button" disabled={busy}>{selectedProject ? 'Require acceptance before dispatch' : 'Link milestone'}</button>
          </form>
        </details>}
      </Panel>
      <Panel title="GitHub and verification">
        <p>{progress.integrations.merged} of {progress.integrations.tracked} tracked integrations merged · {progress.integrations.deployed} deployed</p>
        <ul className="project-list">{integrations.map(item => <li key={item.id}>
          {item.pr_number ? <a className="text-button" href={'https://github.com/' + item.repository + '/pull/' + item.pr_number} target="_blank" rel="noreferrer">PR #{item.pr_number}</a> : <small>{item.head_sha.slice(0, 12)}</small>}
          <Status value={item.state}/>
        </li>)}</ul>
        <ul className="project-list">{github.map((item, index) => <li key={item.task_id + item.uri + index}>
          <a className="text-button" href={item.uri} target="_blank" rel="noreferrer">{item.kind || 'GitHub evidence'}</a>
          <a className="text-button" href={taskHref(item.task_id)}>{tasks.find(task => task.id === item.task_id)?.title}</a>
        </li>)}</ul>
        {!github.length && <p>No linked repository evidence.</p>}
      </Panel>
      <Panel title="Artifacts and reports">
        <ul className="project-list">{artifacts.map((item, index) => <li key={item.task_id + index}>
          <a className="text-button" href={taskHref(item.task_id)}>{item.name ?? item.kind ?? 'Task artifact'}</a>
        </li>)}</ul>
        <p>Open a linked Task to inspect its evidence or export its report.</p>
      </Panel>
      <Panel title="History">
        <ol className="project-list">{history.map(item => <li key={[item.kind, item.milestone_id, item.event_id ?? item.version].join(':')}>
          {item.status && <Status value={item.status}/>} <span>{item.name ?? item.kind.replaceAll('_', ' ')}</span> <time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString()}</time>
        </li>)}</ol>
      </Panel>
    </>}
  </div>;
}
