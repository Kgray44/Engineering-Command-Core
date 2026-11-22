import { useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { ProjectAppearance, ProjectCardGrid, ProjectIcon } from './project-cards.jsx';
import { orderBySavedIds, projectReviewLabels } from './project-presentation.mjs';
import { projectTemplates } from './project-templates.mjs';
import { ProjectDependencies } from './project-dependencies.jsx';
import { ProjectTaskControls } from './project-task-controls.jsx';
import { motion } from 'motion/react';
import { Activity, ArrowLeft, Boxes, Filter, GitBranch, Plus, Search, ShieldCheck } from 'lucide-react';
import { useCardMotion } from './card-motion.jsx';
import { activityId, activityState, parseActivityHref, taskActivityHref } from './github-activity.mjs';
import { StickySectionAside } from './sticky-section-aside.jsx';
import { sortTasks, taskAttemptHref, taskEvidenceHref, taskHref } from './task-workspace.mjs';
import { preferenceFields } from './workspace-preferences.mjs';
import { settingsRequest } from './engineering-settings.jsx';

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
  if (!response.ok) throw Object.assign(Error(data.error || 'Projects service unavailable'), { status: response.status });
  return data;
}

function Options({ values }) {
  return values.map(value => <option key={value} value={value}>{value}</option>);
}

function ProjectForm({ project = {}, onSave, busy, defaultPriority, customTemplates = [] }) {
  const [draft, setDraft] = useState(() => ({
    scope: project.scope ?? '',
    acceptance: project.acceptance ?? '',
    milestone_suggestions: (project.milestone_suggestions ?? []).join('\n'),
  }));
  const edited = useRef(new Set());
  const editField = event => {
    const { name, value } = event.currentTarget;
    edited.current.add(name);
    setDraft(previous => ({ ...previous, [name]: value }));
  };
  const applyTemplate = id => {
    const template = [...projectTemplates, ...customTemplates].find(item => item.id === id);
    const defaults = {
      scope: template?.scope ?? '',
      acceptance: template?.acceptance ?? '',
      milestone_suggestions: template?.milestones.join('\n') ?? '',
    };
    setDraft(previous => ({ ...previous, ...Object.fromEntries(
      Object.entries(defaults).filter(([field]) => !edited.current.has(field)),
    ) }));
  };
  return <form className="form" onSubmit={event => {
    event.preventDefault();
    const { participants, milestone_suggestions, ...fields } = object(event.currentTarget);
    onSave({ ...fields, participants: participants.split(',').map(value => value.trim()).filter(Boolean),
      milestone_suggestions: milestone_suggestions.split('\n').map(value => value.trim()).filter(Boolean) });
  }}>
    {!project.id && <label>Project template
      <select defaultValue="" onChange={event => applyTemplate(event.target.value)}>
        <option value="">Blank project</option>
        {projectTemplates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
        {customTemplates.length > 0 && <optgroup label="Custom templates">
          {customTemplates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}
        </optgroup>}
      </select>
    </label>}
    <label>Name <input name="name" defaultValue={project.name} required maxLength={150}/></label>
    <label>Objective <textarea name="objective" defaultValue={project.objective} required maxLength={16000}/></label>
    <label>Description <textarea name="description" defaultValue={project.description} maxLength={4000}/></label>
    <label>Scope <textarea name="scope" value={draft.scope} onChange={editField} maxLength={16000}/></label>
    <label>Acceptance requirements <textarea name="acceptance" value={draft.acceptance} onChange={editField} maxLength={16000}/></label>
    <label>Suggested milestones
      <textarea name="milestone_suggestions" value={draft.milestone_suggestions} onChange={editField}
        placeholder="One milestone per line" rows={3} maxLength={1812}/>
    </label>
    <ProjectAppearance project={project}/>
    <div className="form-grid">
      <label>Start date <input type="date" name="start_date" defaultValue={project.start_date}/></label>
      <label>Target date <input type="date" name="target_date" defaultValue={project.target_date}/></label>
      <label>Priority <select name="priority" defaultValue={project.priority ?? defaultPriority ?? 'normal'}><Options values={priorities}/></select></label>
      <label>Participants <input name="participants" defaultValue={project.participants?.join(', ')} placeholder="Comma-separated names"/></label>
      <label>Technical completion <select name="technical_state" defaultValue={project.technical_state ?? ''}><Options values={['', 'in_progress', 'verified', 'integrated', 'delivered']}/></select></label>
    </div>
    <button className="primary-button" disabled={busy}>{project.id ? 'Save project' : 'Create project'}</button>
  </form>;
}

function MilestoneForm({ milestone, suggestedName, onSave, busy }) {
  const operation = useRef(crypto.randomUUID());
  return <form className="form" onSubmit={event => {
    event.preventDefault();
    onSave({ ...object(event.currentTarget), milestone_id: milestone?.id ?? operation.current,
      ...(milestone ? { expected_version: milestone.version } : {}) });
  }}>
    <label>Milestone name <input name="name" defaultValue={milestone?.name ?? suggestedName} required maxLength={150}/></label>
    <label>Acceptance evidence required <textarea name="acceptance" defaultValue={milestone?.acceptance} required maxLength={16000}/></label>
    <label>Milestone state <select name="status" defaultValue={milestone?.status ?? 'planned'}><Options values={milestoneStages}/></select></label>
    <button className="quiet-button" disabled={busy}>{milestone ? 'Save milestone' : 'Add milestone'}</button>
  </form>;
}

function MilestoneEvidence({ milestone, tasks, links, dependents, history, Status, editable, busy, onLink }) {
  const assigned = new Set(links.filter(link => link.milestone_id === milestone.id).map(link => link.task_id));
  const linked = tasks.filter(task => assigned.has(task.id));
  const available = tasks.filter(task => !assigned.has(task.id));
  const blocked = linked.filter(task => task.blockers.length || ['failed', 'blocked'].includes(task.state));
  const accepted = linked.filter(task => task.owner_acceptance === 'accepted');
  const downstream = dependents.filter(task => task.milestone_id === milestone.id);
  const events = history.filter(event => event.milestone_id === milestone.id).toReversed();
  let readiness = 'Review the milestone requirements.';
  if (milestone.status === 'accepted') readiness = 'Milestone acceptance recorded.';
  else if (blocked.length) readiness = 'Linked work has blockers or failures.';
  else if (linked.length && accepted.length < linked.length) readiness = 'Linked work remains open.';
  else if (linked.length) readiness = 'Review the milestone requirements against the accepted Tasks.';
  return <section aria-label={'Milestone evidence for ' + milestone.name}>
    <h3>Readiness and evidence</h3>
    <p>{milestone.acceptance}</p>
    <p>{readiness}</p>
    {!!linked.length && <>
      <h4>Linked Tasks</h4>
      <ul className="project-list">{linked.map(task => <li key={task.id}>
        <a href={taskHref(task.id)}>{task.title}</a><Status value={task.state}/>
        {task.owner_acceptance === 'accepted' && <small>Owner accepted</small>}
        {task.blockers.map(blocker => <small key={blocker.type + ':' + blocker.id}>
          {blocker.type.replaceAll('_', ' ')} prerequisite · {tasks.find(item => item.id === blocker.id)?.title ?? blocker.id}
          {' · '}{blocker.state.replaceAll('_', ' ')}
        </small>)}
      </li>)}</ul>
    </>}
    {editable && !!available.length && <form className="form" onSubmit={event => {
      event.preventDefault();
      onLink(object(event.currentTarget).task_id);
    }}>
      <label>Task to link <select name="task_id" defaultValue="" required>
        <option value="">Choose a Project Task</option>
        {available.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select></label>
      <div className="form-actions"><button className="quiet-button" disabled={busy}>Link Task to milestone</button></div>
    </form>}
    {!!downstream.length && <>
      <h4>Tasks requiring this milestone</h4>
      <ul className="project-list">{downstream.map(task => <li key={task.task_id}>
        <a href={taskHref(task.task_id)}>{task.title}</a>
        <a href={projectHref(task.project_id)}>Open dependent Project</a>
      </li>)}</ul>
    </>}
    {!!events.length && <>
      <h4>Milestone history</h4>
      <ol className="project-list">{events.map(event => <li key={event.kind + ':' + (event.event_id ?? event.version)}>
        <span>{event.kind === 'milestone_linked' ? 'Task linked' : 'Milestone saved'}</span>
        {event.status && <Status value={event.status}/>}
        <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time>
      </li>)}</ol>
    </>}
  </section>;
}

function ProjectAcceptance({ project, tasks, integrations, progress, history, busy, onSave, onJump, Panel, DetailLine }) {
  const completed = tasks.filter(task => task.candidate_revision);
  const lastRecorded = stage => history.findLast(event =>
    event.kind === 'project_technical_state_changed' && event.technical_state === stage);
  const lastVerification = lastRecorded('verified');
  const lastDelivery = lastRecorded('delivered');
  const decisions = Object.entries(projectReviewLabels);
  const currentReview = project.owner_review ?? '';
  if (!Object.hasOwn(projectReviewLabels, currentReview)) decisions.push([currentReview, currentReview]);
  return <Panel id="project-acceptance" title="Acceptance">
    <h3>Acceptance requirements</h3>
    <p className="objective">{project.acceptance || 'No requirements recorded.'}</p>
    <DetailLine name="Implementation completed" value={completed.length + ' of ' + tasks.length + ' Tasks with a completed candidate'}/>
    <DetailLine name="Current recorded technical stage" value={project.technical_state?.replaceAll('_', ' ') || 'Unspecified'}/>
    <DetailLine name="Technical verification" value={lastVerification
      ? <>Last recorded verification <time dateTime={lastVerification.occurred_at}>{shortDate(lastVerification.occurred_at)}</time></>
      : 'No Project verification recorded'}/>
    <DetailLine name="PR checks" value={integrations.some(run => run.required_checks?.length)
      ? <button type="button" className="text-button" onClick={() => onJump('project-verification')}>Review recorded PR checks</button>
      : 'No exact-revision check evidence recorded'}/>
    <DetailLine name="PR merged" value={progress.integrations.merged + ' of ' + progress.integrations.tracked + ' recorded integrations'}/>
    <DetailLine name="Functionality delivered" value={lastDelivery
      ? <>Last recorded delivery <time dateTime={lastDelivery.occurred_at}>{shortDate(lastDelivery.occurred_at)}</time></>
      : 'No Project delivery recorded'}/>
    <DetailLine name="Integration deployments" value={progress.integrations.deployed + ' recorded deployments'}/>
    <DetailLine name="Owner review" value={Object.hasOwn(projectReviewLabels, currentReview) ? projectReviewLabels[currentReview] : currentReview}/>
    {completed.length > 0 && <details>
      <summary>Completed Task candidates</summary>
      <ul className="project-list">{completed.map(task => <li key={task.id}>
        <a href={taskHref(task.id)}>{task.title}</a><code title={task.candidate_revision}>{task.candidate_revision.slice(0, 12)}</code>
      </li>)}</ul>
    </details>}
    <form className="form" key={project.version} onSubmit={event => {
      event.preventDefault();
      const { owner_review } = object(event.currentTarget);
      if (owner_review !== currentReview) onSave(owner_review);
    }}>
      <label>Review decision <select name="owner_review" defaultValue={currentReview}>
        {decisions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className="form-actions"><button className="quiet-button" disabled={busy}>Save owner review</button></div>
    </form>
  </Panel>;
}

const artifactLinkLabels = {
  pull_request: 'Open pull request on GitHub', ci_run: 'Open CI run on GitHub',
  artifact: 'Open artifact', verification: 'Open verification evidence',
};

function ProjectRepositoryEvidence({ evidence, tasks, repository, ciGroup, Status }) {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const reportedBranches = tasks.filter(task => task.branch);
  const runs = new Map((ciGroup?.items ?? []).map(item => [activityId('runs', item), item]));
  return <>
    {reportedBranches.length > 0 && <section aria-label="Recorded task branches">
      <h3>Recorded task branches</h3>
      <ul className="project-list">{reportedBranches.map(task => <li key={task.id}>
        <code>{task.branch}</code><a href={taskHref(task.id)}>{task.title}</a>
      </li>)}</ul>
    </section>}
    {evidence.length ? <ul className="project-list">{evidence.map((item, index) => {
      const activity = repository ? taskActivityHref(item.uri, repository) : null;
      const source = parseActivityHref(activity ?? '');
      const run = source?.kind === 'runs' ? runs.get(source.id) : null;
      const observedState = run && ['available', 'stale'].includes(ciGroup.status) &&
        /^[0-9a-f]{40}$/.test(item.revision ?? '') && run.revision === item.revision ? activityState('runs', run) : null;
      return <li key={item.task_id + item.uri + index}>
        <a className="text-button" href={item.uri} target="_blank" rel="noreferrer">{item.kind || 'GitHub evidence'}</a>
        {source?.kind === 'pulls' && <a className="text-button" href={'#merge?pr=' + source.id}>
          Inspect PR #{source.id} in Merge Control Center</a>}
        {source?.kind === 'runs' && <>
          <a className="text-button" href={activity}>Inspect CI run #{source.id}</a>
          {observedState ? <>
            {run.workflow && <span>{run.workflow}</span>}<Status value={observedState}/>
            {ciGroup.status === 'stale' && <small>Last observed result</small>}
            {ciGroup.observed_at && <time dateTime={ciGroup.observed_at}>Observed {new Date(ciGroup.observed_at).toLocaleString()}</time>}
          </> : <small>{run?.revision && item.revision && run.revision !== item.revision
            ? 'This run reports a different revision.' : 'Exact-revision result unavailable.'}</small>}
        </>}
        <a className="text-button" href={taskHref(item.task_id)}>{taskById.get(item.task_id)?.title}</a>
      </li>;
    })}</ul> : <p>No linked repository evidence.</p>}
  </>;
}

function ProjectArtifacts({ tasks, artifacts }) {
  const byTask = Map.groupBy(artifacts, item => item.task_id);
  if (!tasks.length) return <p>No linked Tasks or reports.</p>;
  return <ul className="project-list">{tasks.map(task => <li key={task.id}>
    <strong>{task.title}</strong>
    <a className="text-button" href={taskHref(task.id)} aria-label={'Open Task report for ' + task.title}>Task report</a>
    <a className="text-button" href={taskEvidenceHref(task.id)} aria-label={'Open evidence ledger for ' + task.title}>Evidence ledger</a>
    {(byTask.get(task.id) ?? []).map(item => <div className="project-actions" key={JSON.stringify(item)}>
      {item.href ? <a href={item.href} className="text-button" target="_blank" rel="noreferrer">{artifactLinkLabels[item.kind]}</a> :
        <small>Reference has no direct web link</small>}
      {item.revision && <code title={item.revision}>{item.revision.slice(0, 12)}</code>}
      {item.evidence?.source === 'owner_review' && <small>Owner review evidence</small>}
      {item.evidence?.source === 'reported' && <small>
        {item.evidence.synthetic ? 'Synthetic · ' : ''}{item.evidence.kind} · reported {item.evidence.result.replaceAll('_', ' ')}
      </small>}
    </div>)}
  </li>)}</ul>;
}

const libraryDefaults = preferences => ({
  view: preferences.project_view, query: '', state: preferences.project_state,
  sort: preferences.project_sort, group: preferences.project_group,
});
const projectViews = [
  ['all', 'Current Projects', project => project.status !== 'archived'],
  ['active', 'Active', project => project.status === 'active'],
  ['waiting', 'Planned or paused', project => ['planned', 'paused'].includes(project.status)],
  ['review', 'Awaiting review', project => project.status !== 'archived' && project.owner_review === 'pending'],
  ['accepted', 'Accepted', project => project.status !== 'archived' && project.owner_review === 'accepted'],
  ['archived', 'Archived', project => project.status === 'archived'],
];
const projectHref = id => '#projects/' + id;
const integrationHref = run => '#merge?' + (run.pr_number ? 'pr=' + run.pr_number + '&' : '') + 'run=' + run.id;
const shortDate = value => value ? new Date(value).toLocaleDateString() : 'Unavailable';
const historyLabel = item => item.name ?? (item.source === 'integration' && item.kind === 'start'
  ? 'Integration started' : item.kind.replaceAll('_', ' '));
const workerHeartbeat = item => item.source === 'task' && item.kind === 'heartbeat';

function ProjectExplorer({ application, projects, manualOrder, unassigned, filters, setFilters, layout, defaults, onSaveDefault, savingDefault, defaultMessage, Panel, Status, Metric, editing, onEdit, onReorder, busy, children }) {
  const interaction = useCardMotion(true);
  const views = projectViews.map(([id, label, matches]) => [id, label, projects.filter(matches)]);
  const viewItems = views.find(([id]) => id === filters.view)[2];
  const query = filters.query.trim().toLowerCase();
  const items = (filters.state && filters.view === 'all' ? projects : viewItems).filter(project =>
    (!filters.state || project.status === filters.state) &&
    [project.name, project.description, project.objective, project.id].some(value => value?.toLowerCase().includes(query)));
  const sorters = {
    newest: (left, right) => right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id),
    recent: (left, right) => (right.latest_activity?.at ?? right.updated_at).localeCompare(left.latest_activity?.at ?? left.updated_at) ||
      left.name.localeCompare(right.name),
    oldest: (left, right) => left.created_at.localeCompare(right.created_at),
    priority: (left, right) => priorities.indexOf(right.priority) - priorities.indexOf(left.priority),
    title: (left, right) => left.name.localeCompare(right.name),
  };
  const ordered = filters.sort === 'manual' ? orderBySavedIds(items.toSorted(sorters.newest), manualOrder.project_ids) : items.sort(sorters[filters.sort]);
  const manualView = filters.sort === 'manual' && filters.view === 'all' && filters.group === 'none' && !query && !filters.state;
  const reorder = (visibleIds, from, to) => {
    const moved = arrayMove(visibleIds, visibleIds.indexOf(from), visibleIds.indexOf(to));
    const visible = new Set(visibleIds);
    let index = 0;
    const project_ids = orderBySavedIds(projects.toSorted(sorters.newest), manualOrder.project_ids)
      .map(({ id }) => visible.has(id) ? moved[index++] : id);
    onReorder({ op: 'reorder', project_ids, expected_version: manualOrder.version });
  };
  const groups = filters.group === 'none' ? [['Projects', ordered]]
    : stages.map(stage => [stage, ordered.filter(item => item.status === stage)]).filter(([, rows]) => rows.length);
  const field = ({ currentTarget: { name, value } }) => setFilters(previous => ({ ...previous, [name]: value }));
  const canReset = Object.keys(defaults).some(key => defaults[key] !== filters[key]);
  const canSave = ['view', 'state', 'sort', 'group'].some(key => defaults[key] !== filters[key]);

  return <>
    <div className="metrics project-portfolio" aria-label={application.name + ' portfolio'}>
      <Metric name="Registered projects" value={projects.length} meta={application.name} Icon={Boxes} index={0}/>
      <Metric name="Active" value={views[1][2].length} meta="Active Projects" Icon={Activity} index={1}/>
      <Metric name="Awaiting review" value={views[3][2].length} meta="Pending owner decision" Icon={ShieldCheck} index={2}/>
      <Metric name="Unassigned Tasks" value={unassigned} meta="Tasks without a Project" Icon={GitBranch} index={3}/>
    </div>
    <Panel title="Project explorer" right={<button type="button" className="primary-button" aria-expanded={editing} onClick={onEdit}>
      <Plus size={16} aria-hidden="true"/>{editing ? 'Close form' : 'New project'}
    </button>}>
      {children}
      <nav className="task-work-filters" aria-label="Project activity views">
        {views.map(([id, label, rows]) => <motion.button type="button" key={id} className="quiet-button task-work-filter"
          aria-current={filters.view === id ? 'page' : undefined} {...interaction}
          onClick={() => setFilters(previous => ({ ...previous, view: id, state: '' }))}>{label}<span>{rows.length}</span></motion.button>)}
      </nav>
      <div className="task-filters project-filters">
        <label>Search <span className="search"><Search size={16} aria-hidden="true"/>
          <input aria-label="Search projects" name="query" type="search" value={filters.query} onChange={field} placeholder="Name, objective, or ID"/>
        </span></label>
        <label>State <select name="state" value={filters.state} onChange={field}>
          <option value="">{filters.view === 'all' ? 'Current Projects' : 'Any state in view'}</option><Options values={stages}/>
        </select></label>
        <label>Sort <select name="sort" value={filters.sort} onChange={field}>
          {Object.entries(preferenceFields.project_sort.choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Group <select name="group" value={filters.group} onChange={field}>
          <option value="none">None</option><option value="state">State</option>
        </select></label>
      </div>
      <div className="task-result-bar">
        <span role="status"><Filter size={14} aria-hidden="true"/> {items.length} of {projects.length} Projects</span>
        {canReset && <button type="button" className="text-button" onClick={() => setFilters(defaults)}>Reset filters</button>}
        {onSaveDefault && <button type="button" className="quiet-button" disabled={!canSave || savingDefault} onClick={() => onSaveDefault(filters)}>
          {savingDefault ? 'Saving default view' : 'Save as default view'}
        </button>}
        {defaultMessage && <small role="status">{defaultMessage}</small>}
      </div>
      {!items.length && <p>{projects.length ? 'No Projects match these filters.' : 'No Projects in the current feed.'}</p>}
      {filters.sort === 'manual' && !manualView && <small>To reorder cards, open Current Projects and clear search, state, and grouping.</small>}
      {groups.map(([label, rows]) => <section key={label} className="task-group" aria-label={label}>
        {filters.group !== 'none' && <h3>{label} <span>{rows.length}</span></h3>}
        <ProjectCardGrid layout={layout} rows={rows} Status={Status} sortable={manualView && rows.length > 1} onMove={busy ? () => {} : reorder}/>
      </section>)}
    </Panel>
  </>;
}

export function ProjectsWorkspace({ projectId, initialSection, headers, Panel, Status, Metric, DetailLine, onNewTask, onJump, refreshVersion, liveTaskState, preferences, preferencesReady, settings, onSettings, repository, repositoryMain, repositoryCI, workerAccess, workerDispatch, taskEditor, demo }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const defaults = libraryDefaults(preferences);
  const [filters, setFilters] = useState(defaults);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultMessage, setDefaultMessage] = useState('');
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addingMilestone, setAddingMilestone] = useState(null);
  const [taskQuery, setTaskQuery] = useState('');
  const [taskState, setTaskState] = useState('');
  const [taskSort, setTaskSort] = useState(null);
  const [unassignedTaskId, setUnassignedTaskId] = useState('');
  const [showHeartbeats, setShowHeartbeats] = useState(false);
  const [moveTaskId, setMoveTaskId] = useState('');
  const [controlTaskId, setControlTaskId] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [other, setOther] = useState(null);
  const [taskList, setTaskList] = useState([]);
  const createId = useRef(crypto.randomUUID());
  const pending = useRef(false);
  const readVersion = useRef(0);
  const initialProjectSection = useRef(null);
  useEffect(() => {
    if (!preferencesReady || !projectId || data?.project?.id !== projectId) return;
    const route = projectId + ':' + (initialSection ?? '');
    if (initialProjectSection.current === route) return;
    initialProjectSection.current = route;
    const section = initialSection ?? preferences.project_section;
    if (section !== 'overview') onJump('project-' + section);
  }, [data?.project?.id, initialSection, onJump, preferences.project_section, preferencesReady, projectId]);
  const load = async signal => {
    const version = ++readVersion.current;
    const next = await projectRequest(null, headers, { id: projectId, signal });
    if (!signal?.aborted && version === readVersion.current) {
      setData(next);
      setError('');
    }
  };
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const loading = load(controller.signal);
    const version = readVersion.current;
    void loading.catch(error => {
      if (!controller.signal.aborted && version === readVersion.current) setError(error.message);
    });
    return () => controller.abort();
  }, [projectId, demo, headers, refreshVersion, liveTaskState]);
  useEffect(() => {
    if (demo || !projectId) return;
    const controller = new AbortController();
    void projectRequest(null, headers, { signal: controller.signal }).then(setTaskList).catch(() => {});
    return () => controller.abort();
  }, [projectId, demo, headers, refreshVersion]);
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
    ++readVersion.current;
    setBusy(true);
    setError('');
    try {
      const result = await projectRequest({ id: projectId, ...request }, headers);
      onSuccess?.(result);
      if (request.op !== 'create') await load();
    } catch (error) {
      if (request.op === 'reorder' && error.status === 409 ||
          request.op === 'link_task' && [404, 409].includes(error.status)) await load().catch(() => {});
      setError(error.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  async function saveDefaultView({ view, state, sort, group }) {
    setSavingDefault(true);
    setDefaultMessage('');
    try {
      const { preferences: saved } = await settingsRequest(headers, {
        op: 'save', expected_version: settings.preferences.version,
        values: { project_view: view, project_state: state, project_sort: sort, project_group: group },
      });
      onSettings(previous => ({ ...previous, preferences: saved, audit: [saved, ...previous.audit].slice(0, 15) }));
      setDefaultMessage('Default Project view saved.');
    } catch (error) {
      setDefaultMessage(error.message);
      if (error.status === 409) {
        try {
          onSettings(await settingsRequest(headers));
          setDefaultMessage('Settings changed in another session. Review the current filters and save again.');
        } catch {
          setDefaultMessage('Settings changed in another session. Reload to read the latest defaults.');
        }
      }
    } finally {
      setSavingDefault(false);
    }
  }
  if (demo) return <p className="notice">Use Live mode to open your Projects.</p>;
  const { application, projects = [], project, tasks = [], milestones = [], telemetry, history = [], dependencies = [], task_prerequisites = [], task_milestones = [], milestone_dependents = [], artifact_sources = [], github = [], progress, active_workers, integrations = [], linkable_tasks = [] } = data ?? {};
  const mainRevision = repository && /^[a-f0-9]{40}$/i.test(repositoryMain?.revision ?? '') &&
    ['available', 'stale'].includes(repositoryMain.status) ? repositoryMain.revision : null;
  const selectedUnassignedTask = linkable_tasks.find(task => task.id === unassignedTaskId);
  const effectiveTaskSort = taskSort ?? preferences.task_sort;
  const query = taskQuery.trim().toLowerCase();
  const visibleTasks = sortTasks(tasks.filter(task => (!taskState || task.state === taskState) &&
    (task.title.toLowerCase().includes(query) || task.id.toLowerCase().includes(query))), effectiveTaskSort);
  const moveTask = tasks.find(item => item.id === moveTaskId);
  const controlTask = tasks.find(item => item.id === controlTaskId);
  const nextTask = tasks.find(item => item.state === 'ready');
  const blockedTasks = tasks.filter(item => item.blockers.length > 0);
  const latestIntegration = integrations[0];
  const blockedIntegrations = integrations.filter(item => item.state === 'blocked').length;
  const lastChange = history.findLast(item => !workerHeartbeat(item));
  const heartbeatCount = history.filter(workerHeartbeat).length;
  const shownHistory = showHeartbeats ? history : history.filter(item => !workerHeartbeat(item));
  const targetProjects = (taskList.projects ?? []).filter(item => item.id !== projectId && item.status !== 'archived');
  const moveMilestone = (index, offset) => submit({ op: 'reorder_milestones', expected_version: project.version,
    milestone_ids: arrayMove(milestones.map(item => item.id), index, index + offset) });
  return <div className="projects-workspace">
    {error && <p className="notice error" role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading Projects…</p>}
    {application && !projectId && <ProjectExplorer application={application} projects={projects} unassigned={data.unassigned_tasks}
      filters={filters} setFilters={setFilters} layout={preferences.project_layout} defaults={defaults}
      onSaveDefault={settings ? saveDefaultView : undefined} savingDefault={savingDefault} defaultMessage={defaultMessage} Panel={Panel} Status={Status} Metric={Metric} editing={edit} onEdit={() => setEdit(!edit)}
      manualOrder={data.manual_order ?? { version: 0, project_ids: [] }} onReorder={submit} busy={busy}>
      {edit && <div className="project-create"><ProjectForm busy={busy} defaultPriority={preferences.project_priority} customTemplates={preferences.project_templates} onSave={fields => submit({ op: 'create', id: createId.current, fields }, result => {
        window.location.hash = projectHref(result.project.id);
      })}/></div>}
    </ProjectExplorer>}
    {project && <>
      <div className="task-detail-toolbar">
        <a href="#projects" className="back" aria-label="All projects"><ArrowLeft size={15} aria-hidden="true"/> Back to Project Control Center</a>
        {project.status !== 'archived' && <button type="button" className="primary-button" onClick={() => onNewTask(project)}>
          <Plus size={16} aria-hidden="true"/> New project task
        </button>}
      </div>
      <nav className="task-section-nav" aria-label="Jump to Project section">
        {[
          ['overview', 'Project overview'], ['tasks', 'Tasks'], ['milestones', 'Milestones'], ['dependencies', 'Dependencies'],
          ['telemetry', 'Telemetry'], ['verification', 'Verification'], ['acceptance', 'Acceptance'], ['evidence', 'Evidence'], ['history', 'History'],
        ].map(([id, label]) => <button type="button" className="quiet-button" key={id} onClick={() => onJump('project-' + id)}>{label}</button>)}
      </nav>
      {project.owner_review === 'accepted' && <div className="task-completion" role="status">
        <ShieldCheck size={24} aria-hidden="true"/><div><strong>Project accepted</strong><small>Owner accepted the Project.</small></div>
      </div>}
      <div className="detail-layout">
        <div className="detail-left">
          <Panel id="project-overview" title={project.name} kicker={project.id} right={<Status value={project.status}/>}>
            <span className="project-icon-preview" data-accent={project.accent ?? 'default'}><ProjectIcon id={project.icon}/></span>
            <div className="objective">{project.objective}</div>
            {project.description && <p className="objective">{project.description}</p>}
            {project.scope && <DetailLine name="Scope" value={project.scope}/>}
            <div className="task-tags"><span>{project.priority} priority</span></div>
            <div className="project-actions">
              <button className="quiet-button" aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? 'Close form' : 'Edit project'}</button>
              {stages.filter(stage => stage !== 'planned' && stage !== project.status).map(stage =>
                <button className="quiet-button" key={stage} disabled={busy} onClick={() => submit({ op: 'update', expected_version: project.version, status: stage })}>
                  {{active:'Activate', paused:'Pause', archived:'Archive'}[stage]}
                </button>)}
            </div>
            {edit && <ProjectForm key={project.version} project={project} busy={busy}
              onSave={fields => submit({ op: 'update', expected_version: project.version, fields }, () => setEdit(false))}/>}
          </Panel>
          <Panel id="project-current-work" title="Current work">
            <DetailLine name="Task progress" value={progress.tasks.completed + ' of ' + progress.tasks.total + ' complete'}/>
            <DetailLine name="Milestone progress" value={progress.milestones.accepted + ' of ' + progress.milestones.total + ' accepted'}/>
            <DetailLine name="Workers with active Project leases" value={number(active_workers)}/>
            <DetailLine name="Next runnable Task" value={nextTask ? <a href={taskHref(nextTask.id)}>{nextTask.title}</a> : 'No Task ready to claim'}/>
            <DetailLine name="Latest recorded integration" value={latestIntegration ? <>
              <a className="text-button" href={integrationHref(latestIntegration)}
                aria-label={(latestIntegration.pr_number ? 'Inspect latest integration for PR #' + latestIntegration.pr_number
                  : 'Inspect latest integration') + ', ' + latestIntegration.state.replaceAll('_', ' ')}>
                {latestIntegration.pr_number ? 'PR #' + latestIntegration.pr_number : latestIntegration.head_sha.slice(0, 12)}
                {' · '}<Status value={latestIntegration.state}/>
              </a>
            </> : 'No recorded integrations'}/>
            {blockedIntegrations > 0 && <DetailLine name="Integration blockers" value={
              <button type="button" className="text-button" onClick={() => onJump('project-verification')}>
                Review {blockedIntegrations} blocked {blockedIntegrations === 1 ? 'integration' : 'integrations'}
              </button>}/>}
            <DetailLine name="Owner review" value={project.owner_review === 'pending'
              ? <button type="button" className="text-button" onClick={() => onJump('project-acceptance')}>{projectReviewLabels.pending}</button>
              : projectReviewLabels[project.owner_review ?? ''] ?? project.owner_review}/>
            <DetailLine name="Recent change" value={lastChange ? <button type="button" className="text-button" onClick={() => onJump('project-history')}>
              {historyLabel(lastChange)} · {shortDate(lastChange.occurred_at)}
            </button> : 'No recorded changes'}/>
            {blockedTasks.length > 0 && <div>
              <h3>Blocked Tasks</h3>
              <ul className="project-list">{blockedTasks.slice(0, 5).map(task => <li key={task.id}>
                <a href={taskHref(task.id)}>{task.title}</a><small>{task.blockers.length} {task.blockers.length === 1 ? 'blocker' : 'blockers'}</small>
              </li>)}</ul>
              <button type="button" className="text-button" onClick={() => onJump('project-dependencies')}>Inspect dependency evidence</button>
            </div>}
          </Panel>
        </div>
        <StickySectionAside className="detail-right">
          <Panel title="Project record">
            <DetailLine name="Repository" value={project.repositories?.join(', ') || 'Unavailable'}/>
            <DetailLine name="Created" value={shortDate(project.created_at)}/>
            <DetailLine name="Start date" value={project.start_date || 'Unspecified'}/>
            <DetailLine name="Target date" value={project.target_date || 'Unspecified'}/>
            <DetailLine name="Participants" value={project.participants?.join(', ') || 'Unspecified'}/>
            <DetailLine name="Technical completion" value={project.technical_state?.replaceAll('_', ' ') || 'Unspecified'}/>
            <DetailLine name="Linked Tasks" value={tasks.length}/>
            <DetailLine name="Milestones" value={milestones.length}/>
          </Panel>
        </StickySectionAside>
      </div>
      <Panel id="project-tasks" title="Tasks">
        {tasks.length > 0 && <div className="form-grid">
          <label>Filter Project Tasks <input type="search" value={taskQuery} onChange={event => setTaskQuery(event.target.value)}/></label>
          <label>Task state <select value={taskState} onChange={event => setTaskState(event.target.value)}>
            <option value="">All states</option><Options values={[...new Set(tasks.map(task => task.state))]}/>
          </select></label>
          <label>Sort Project Tasks <select value={effectiveTaskSort} onChange={event => setTaskSort(event.target.value)}>
            {Object.entries(preferenceFields.task_sort.choices).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
        </div>}
        {tasks.length > 0 && <p className="low" role="status">{visibleTasks.length} of {tasks.length} Tasks</p>}
        <ul className="project-list">{visibleTasks.map(task => <li key={task.id}>
          <a className="text-button" href={taskHref(task.id)}>{task.title}</a>
          <span className="project-task-state"><Status value={task.state}/></span>
          {task.priority && <small>{task.priority} priority</small>}
          <button type="button" className="quiet-button" aria-label={'Execution controls for ' + task.title}
            aria-expanded={controlTaskId === task.id} onClick={() => setControlTaskId(task.id === controlTaskId ? '' : task.id)}>Execution controls</button>
          {task.branch && <small>{task.branch}</small>}
          {task.last_activity && <small>Latest activity · {task.last_activity.kind.replaceAll('_', ' ')} · <time dateTime={task.last_activity.at}>
            {new Date(task.last_activity.at).toLocaleString()}
          </time></small>}
          {task.blockers.map(item => <small key={item.type + ':' + item.id}>
            {item.type === 'milestone' ? dependencies.find(gate => gate.milestone_id === item.id)?.name ?? item.id :
              item.type === 'project' ? project.name : tasks.find(related => related.id === item.id)?.title ?? item.id} · {item.state}
          </small>)}
          {task_milestones.filter(link => link.task_id === task.id).map(link => <small key={link.milestone_id}>{milestones.find(item => item.id === link.milestone_id)?.name}</small>)}
        </li>)}</ul>
        {!tasks.length && <p>No linked tasks.</p>}
        {tasks.length > 0 && !visibleTasks.length && <p>No Tasks match the filters.</p>}
        {controlTask && <ProjectTaskControls key={controlTask.id} task={controlTask} tasks={tasks} headers={headers} Status={Status} editor={taskEditor}
          workerAccess={workerAccess} workerDispatch={workerDispatch} onClose={() => setControlTaskId('')}
          onRefresh={() => load().catch(cause => setError(cause.message))}/>}
        {tasks.length > 0 && targetProjects.length > 0 && <details><summary>Move a Task to another Project</summary>
          <form className="form" onSubmit={event => {
            event.preventDefault();
            if (!moveTask) return;
            const { destination } = object(event.currentTarget);
            submit({ op: 'move_task', id: destination, source_project_id: project.id, task_id: moveTask.id,
              expected_version: moveTask.version }, () => setMoveTaskId(''));
          }}>
            <label>Task to move <select required value={moveTaskId} onChange={event => setMoveTaskId(event.target.value)}>
              <option value="">Select a Task</option>
              {tasks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select></label>
            <label>Destination Project <select name="destination" required defaultValue="">
              <option value="">Select a Project</option>
              {targetProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
            <p className="low">Unadmitted or finished Tasks can move when they have no milestone links.</p>
            <button className="quiet-button" disabled={busy || !moveTask}>Move Task</button>
          </form>
        </details>}
        {project.status !== 'archived' && <details><summary>Associate an existing Task</summary>
          {linkable_tasks.length ? <form className="form" onSubmit={event => {
            event.preventDefault();
            if (!selectedUnassignedTask) return;
            submit({ op: 'link_task', task_id: selectedUnassignedTask.id, expected_version: selectedUnassignedTask.version },
              () => setUnassignedTaskId(''));
          }}>
            <label>Unassigned Task <select required value={selectedUnassignedTask?.id ?? ''}
              onChange={event => setUnassignedTaskId(event.target.value)}>
              <option value="">Select a Task</option>
              {linkable_tasks.map(task => <option key={task.id} value={task.id}>{task.title} · {task.id.slice(-8)}</option>)}
            </select></label>
            <button className="quiet-button" disabled={busy || !selectedUnassignedTask}>Link Task</button>
          </form> : <p>No unassigned Tasks in this application.</p>}
        </details>}
      </Panel>
      <Panel id="project-milestones" title="Milestones" right={project.status !== 'archived' && <button className="quiet-button" aria-expanded={addingMilestone !== null} onClick={() => setAddingMilestone(addingMilestone === null ? '' : null)}>
        {addingMilestone !== null ? 'Close form' : 'New milestone'}</button>}>
        {milestones.map((milestone, index) => <details key={milestone.id}>
          <summary>{milestone.name} <Status value={milestone.status}/></summary>
          <MilestoneEvidence milestone={milestone} tasks={tasks} links={task_milestones} dependents={milestone_dependents}
            history={history} Status={Status} editable={project.status !== 'archived'} busy={busy}
            onLink={task_id => submit({ op: 'milestone_link', milestone_id: milestone.id, task_id })}/>
          {project.status !== 'archived' && milestones.length > 1 && <div className="project-actions">
            <button type="button" className="quiet-button" aria-label={'Move ' + milestone.name + ' earlier'}
              disabled={busy || index === 0} onClick={() => moveMilestone(index, -1)}>Move earlier</button>
            <button type="button" className="quiet-button" aria-label={'Move ' + milestone.name + ' later'}
              disabled={busy || index === milestones.length - 1} onClick={() => moveMilestone(index, 1)}>Move later</button>
          </div>}
          {project.status !== 'archived' && <MilestoneForm key={milestone.version} milestone={milestone} busy={busy} onSave={fields => submit({ op: 'milestone', ...fields })}/>}
        </details>)}
        {!milestones.length && <p>No milestones recorded.</p>}
        {project.status !== 'archived' && project.milestone_suggestions?.filter(name => !milestones.some(item => item.name === name)).length > 0 &&
          <div className="project-actions" role="group" aria-label="Suggested milestones">
            {project.milestone_suggestions.filter(name => !milestones.some(item => item.name === name)).map(name =>
              <button key={name} type="button" className="quiet-button" onClick={() => setAddingMilestone(name)}>Draft {name}</button>)}
          </div>}
        {addingMilestone !== null && <MilestoneForm key={addingMilestone} suggestedName={addingMilestone} busy={busy}
          onSave={fields => submit({ op: 'milestone', ...fields }, () => setAddingMilestone(null))}/>}
      </Panel>
      <Panel id="project-dependencies" title="Dependencies">
        <ProjectDependencies tasks={tasks} prerequisites={task_prerequisites} gates={dependencies} Status={Status}/>
        {!tasks.length && <p>Project Tasks will appear here with their prerequisites.</p>}
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
      <Panel id="project-verification" title="GitHub and verification">
        <DetailLine name={repositoryMain?.status === 'stale' ? 'Last observed main revision' : 'Repository main revision'}
          value={mainRevision ? <a href={'https://github.com/' + repository + '/commit/' + mainRevision}
            aria-label="Inspect main commit" target="_blank" rel="noreferrer"><code>{mainRevision.slice(0, 12)}</code></a> : 'Unavailable'}/>
        {mainRevision && repositoryMain.observed_at && <p>Observed <time dateTime={repositoryMain.observed_at}>
          {new Date(repositoryMain.observed_at).toLocaleString()}</time></p>}
        <p>{progress.integrations.merged} of {progress.integrations.tracked} tracked integrations merged · {progress.integrations.deployed} deployed</p>
        <ul className="project-list">{integrations.map(item => <li key={item.id}>
          {item.pr_number ? <a className="text-button" href={'https://github.com/' + item.repository + '/pull/' + item.pr_number} target="_blank" rel="noreferrer">PR #{item.pr_number}</a>
            : <small>{item.head_sha.slice(0, 12)}</small>}
          <Status value={item.state}/>
          <a className="text-button" href={integrationHref(item)}>Inspect integration</a>
          {item.required_checks?.length > 0 ? <details>
            <summary>Recorded required checks</summary>
            <p>Head <code title={item.head_sha}>{item.head_sha.slice(0, 12)}</code> · Base {item.check_base_sha
              ? <code title={item.check_base_sha}>{item.check_base_sha.slice(0, 12)}</code> : 'Unavailable'}</p>
            <ul>{item.required_checks.map(check => <li key={JSON.stringify([check.context, check.app, check.source])}>
              {check.context} · {check.state}
            </li>)}</ul>
          </details> : <small>No exact-head required checks recorded.</small>}
        </li>)}</ul>
        <ProjectRepositoryEvidence evidence={github} tasks={tasks} repository={repository} ciGroup={repositoryCI} Status={Status}/>
      </Panel>
      <Panel id="project-evidence" title="Artifacts and reports">
        <ProjectArtifacts tasks={tasks} artifacts={artifact_sources}/>
      </Panel>
      <ProjectAcceptance project={project} tasks={tasks} integrations={integrations} progress={progress} history={history} busy={busy}
        Panel={Panel} DetailLine={DetailLine} onJump={onJump} onSave={owner_review => submit({
          op: 'update', expected_version: project.version, fields: { owner_review },
        })}/>
      <Panel id="project-telemetry" title="Execution and telemetry">
        <p>{progress.tasks.completed} of {progress.tasks.total} Tasks complete · {progress.tasks.active} running · {progress.tasks.blocked} blocked · {progress.tasks.verifying} verifying</p>
        <dl className="project-metrics">
          <dt>Tasks</dt><dd>{tasks.length}</dd>
          <dt>Accepted Tasks</dt><dd>{tasks.filter(task => task.owner_acceptance === 'accepted').length}</dd>
          <dt>Accepted milestones</dt><dd>{milestones.filter(item => item.status === 'accepted').length}</dd>
          <dt>Attempts</dt><dd>{telemetry.attempts}</dd>
          <dt>Retries</dt><dd>{telemetry.retries}</dd>
          <dt>Failed or orphaned</dt><dd>{telemetry.failures}</dd>
          <dt>Attempts with observed token totals</dt><dd>{telemetry.measured_attempts}</dd>
          <dt>Recorded attempt duration</dt><dd>{telemetry.execution_ms === null ? 'Unavailable' : number(Math.round(telemetry.execution_ms / 1000)) + ' s'}</dd>
          <dt>Execution cost</dt><dd>{number(telemetry.costs)}</dd>
          <dt>CI usage</dt><dd>{number(telemetry.ci_usage)}</dd>
          <dt>Observed total tokens</dt><dd>{number(telemetry.total_tokens)}</dd>
          <dt>Input tokens</dt><dd>{number(telemetry.input_tokens)}</dd>
          <dt>Cached input tokens</dt><dd>{number(telemetry.cached_input_tokens)}</dd>
          <dt>Output tokens</dt><dd>{number(telemetry.output_tokens)}</dd>
        </dl>
        {telemetry.measured_attempts > 0 && <p>Totals include available observations, including partial or in-progress receipts.</p>}
        {telemetry.recent_attempts?.length > 0 && <details>
          <summary>Recent recorded attempts</summary>
          {telemetry.attempts > telemetry.recent_attempts.length && <p>Showing the latest {telemetry.recent_attempts.length} attempts.</p>}
          <ol className="project-list">{telemetry.recent_attempts.map(attempt => {
            const title = tasks.find(item => item.id === attempt.task_id)?.title ?? 'Task';
            return <li key={attempt.id}>
              <a href={taskAttemptHref(attempt.task_id, attempt.id)}>{title}, attempt {attempt.number}</a>
              <Status value={attempt.state}/>
              <time dateTime={attempt.started_at}>{new Date(attempt.started_at).toLocaleString()}</time>
              {attempt.provider && <small>{attempt.provider}</small>}
              {attempt.execution_ms !== null && <small>{number(Math.round(attempt.execution_ms / 1000))} s elapsed</small>}
              {attempt.failure_category && <small>{attempt.failure_category.replaceAll('_', ' ')}</small>}
              <small>{attempt.observed_tokens === null ? 'Token total unavailable'
                : <>{number(attempt.observed_tokens)} tokens · {attempt.token_source}
                  {attempt.token_coverage === 'in-progress' ? ' · observed so far' : attempt.token_coverage === 'partial' ? ' · partial' : ''}</>}</small>
            </li>;
          })}</ol>
        </details>}
      </Panel>
      <Panel id="project-history" title="History">
        {!!heartbeatCount && <button type="button" className="quiet-button" aria-pressed={showHeartbeats}
          onClick={() => setShowHeartbeats(value => !value)}>{showHeartbeats ? 'Hide worker heartbeats' : 'Show worker heartbeats'}</button>}
        {data.execution_history_truncated && <p className="low">Showing the latest 120 Task and integration changes. Open the source records for earlier activity.</p>}
        {showHeartbeats && data.heartbeat_history_truncated && <p className="low">Showing the latest {heartbeatCount} worker heartbeats. Open the Task for its full receipt history.</p>}
        <ol className="project-list">{shownHistory.toReversed().map(item => <li key={[
          item.source, item.integration_id, item.task_id, item.milestone_id, item.kind, item.event_id ?? item.version,
        ].join(':')}>
          <span>{historyLabel(item)}</span>
          {item.status && <Status value={item.status}/>}
          {item.integration_id && <a className="text-button" href={'#merge?run=' + item.integration_id + (item.pr_number ? '&pr=' + item.pr_number : '')}>
            {item.pr_number ? 'Open integration for PR #' + item.pr_number : 'Open integration'}
          </a>}
          {item.task_id && <a className="text-button" href={taskHref(item.task_id)}>
            {item.task_title ? 'Open Task: ' + item.task_title : 'Open Task'}
          </a>}
          <time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString()}</time>
        </li>)}</ol>
      </Panel>
    </>}
  </div>;
}
