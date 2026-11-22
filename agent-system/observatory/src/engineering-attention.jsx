import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { activityHref, activityId, pullReviewRequestStatus } from './github-activity.mjs';
import { taskAttemptHref, taskHref } from './task-workspace.mjs';

const recent = rows => [...rows].sort((left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0)).slice(0, 12);
const time = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : null;
const label = value => String(value).replaceAll('_', ' ');
const dispositions = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

function useProjectActivity(headers, enabled) {
  const [view, setView] = useState({ events: [], pendingReviews: [], loading: true });
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let request;
    async function load() {
      if (document.hidden || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch('/api/activity', { headers, signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw Error('Project activity is unavailable.');
        const data = await response.json();
        if (!controller.signal.aborted) setView({ events: data.project_events, pendingReviews: data.pending_project_reviews ?? [], loading: false });
      } catch {
        if (!controller.signal.aborted) setView(previous => ({ ...previous, loading: false, stale: true }));
      } finally {
        request = null;
      }
    }
    void load();
    const timer = window.setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    return () => {
      request?.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled, generation, headers]);
  return { ...view, refresh: () => setGeneration(value => value + 1) };
}

export function EngineeringAttention({ tasks, attempts, github, dispatch, worker, runs, runError, summaries, settings, headers, Panel, Status, demo }) {
  const reduced = useReducedMotion();
  const activity = useProjectActivity(headers, !demo && Boolean(settings?.application));
  const [localFilter, setFilter] = useState(null);
  const preferences = settings?.preferences.values;
  const filter = localFilter ?? preferences?.attention_view ?? 'all';
  const showsAlert = key => filter !== 'attention' || preferences?.[key] !== 'hide';
  if (demo) return <p className="notice">Open Live mode to view engineering activity.</p>;

  const taskIndex = new Map(tasks.map(task => [task.id, task]));
  for (const summary of summaries.values()) taskIndex.set(summary.task.id, summary.task);
  const entries = [...taskIndex.values()].map(task => {
    const summary = summaries.get(task.id);
    const blockers = summary?.lifecycle.blockers ?? [];
    return {
      id: task.id, label: task.title, href: taskHref(task.id),
      project: summary?.project_id, blockers, projectGate: summary?.project_blocked,
      state: summary?.lifecycle.state ?? task.state,
      accepted: (summary?.task.owner_acceptance ?? task.owner_acceptance) === 'accepted',
      at: summary?.lifecycle.accepted_at ?? task.updated_at ?? null,
    };
  });
  const issue = entry => [entry.projectGate ? 'Project or milestone gate' : null,
    ...entry.blockers.map(blocker => taskIndex.get(blocker.id)?.title ?? label(blocker.id))]
    .filter(Boolean).slice(0, 3).join(' · ');

  const pullRow = item => ({ id: activityId('pulls', item), label: item.title ?? 'Pull request #' + activityId('pulls', item),
    href: '#merge?pr=' + activityId('pulls', item), at: item.updated_at, state: item.draft ? 'draft' : 'open',
    detail: github?.pulls?.status === 'stale' ? 'Cached GitHub observation' : null });
  const openPulls = (github?.pulls?.items ?? []).filter(item => item.state === 'open' && activityId('pulls', item));
  const githubConnection = settings?.connections?.github;
  const githubReadConfigured = githubConnection?.integration_read_credential_configured ?? githubConnection?.credential_configured;
  const connections = [
    { id: 'worker', label: dispatch.label, href: '#settings/workers', at: dispatch.at },
    ...(worker?.last_error ? [{ id: 'worker-receipt', label: 'Last worker issue · ' + label(worker.last_error.state),
      at: worker.last_error.at, href: '#settings/workers' }] : []),
    ...(github?.main?.status !== 'available' ? [{ id: 'github', label: github?.main?.reason ?? 'GitHub main is unverified',
      href: '#settings/github' }] : []),
    ...(githubReadConfigured === false ? [{ id: 'github-read', label: 'Dedicated GitHub read credential is missing',
      href: '#settings/github' }] : []),
    ...(runError ? [{ id: 'integration-error', label: 'Integration history is unavailable', href: '#merge' }] : []),
  ];
  const integrationRow = run => ({
    id: run.id,
    label: run.pr_number ? 'Pull request #' + run.pr_number
      : taskIndex.get(run.task?.id)?.title ?? 'Task candidate ' + run.head_sha.slice(0, 10),
    state: run.state, href: '#merge?run=' + run.id + (run.pr_number ? '&pr=' + run.pr_number : ''),
    at: run.updated_at, task: run.task?.id,
  });
  const showBlocked = showsAlert('attention_task_status');
  const showFailures = showsAlert('attention_failures');
  const taskIssues = entries.filter(({ state }) => (showBlocked && state === 'blocked') || (showFailures && state === 'failed'))
    .map(task => ({ ...task, detail: issue(task) }));
  const sections = [
    ['attention', 'Owner review', entries.filter(task => task.state === 'verifying'), 'attention_reviews'],
    ['attention', 'Projects awaiting owner review', activity.pendingReviews.map(project => ({
      id: project.id, label: project.name, href: '#projects/' + project.id + '?section=acceptance',
    })), 'attention_reviews'],
    ['attention', 'Waiting on prerequisites', entries.filter(task => !['archived', 'cancelled', 'completed'].includes(task.state) &&
      (task.blockers.length > 0 || (task.projectGate && ['admitted', 'blocked', 'queued', 'ready', 'scheduled'].includes(task.state)))).map(task => ({
      ...task, detail: issue(task),
    })), 'attention_task_status'],
    ...(showBlocked || showFailures ? [['attention',
      showBlocked && showFailures ? 'Blocked and failed Tasks' : showBlocked ? 'Blocked Tasks' : 'Failed Tasks', taskIssues]] : []),
    ['attention', 'Failed attempts', recent(attempts.filter(attempt => attempt.state === 'failed' && taskIndex.has(attempt.task_id))
      .map(attempt => ({ id: attempt.id, label: taskIndex.get(attempt.task_id).title, href: taskAttemptHref(attempt.task_id, attempt.id), state: attempt.state,
        detail: 'Attempt ' + attempt.attempt_number, at: attempt.finished_at ?? attempt.started_at }))), 'attention_failures'],
    ['attention', 'Pull requests awaiting review', recent(openPulls.filter(item => pullReviewRequestStatus(item) === 'requested')
      .map(item => ({ ...pullRow(item), state: 'review requested' }))), 'attention_reviews'],
    ['attention', 'Failed or interrupted CI', recent((github?.ci?.items ?? []).filter(item => dispositions.has(item.conclusion) && activityId('runs', item))
      .map(item => ({ id: activityId('runs', item), label: item.title ?? item.workflow, state: item.conclusion,
        href: activityHref('runs', activityId('runs', item)), at: item.updated_at }))), 'attention_failures'],
    ['attention', 'Integration attention', recent(runs.filter(run => ['blocked', 'checking', 'repairing', 'merge_ready'].includes(run.state))
      .map(run => ({ ...integrationRow(run), detail: run.state === 'blocked' ? run.evidence?.detail : null }))), 'attention_integrations'],
    ['recent', 'Recently landed integrations', recent(runs.filter(run => ['merged', 'deployed'].includes(run.state) &&
      /^[a-f0-9]{40}$/.test(run.evidence?.merged_sha ?? '')).map(run => ({
      ...integrationRow(run), detail: 'Landed commit ' + run.evidence.merged_sha.slice(0, 12),
      at: run.evidence.merged_at ?? run.updated_at,
    })))],
    ['attention', 'Connections', connections],
    ['recent', 'Running work', entries.filter(task => ['running', 'pausing', 'cancelling'].includes(task.state))],
    ['recent', 'Recently completed', recent(entries.filter(task => task.accepted && ['completed', 'accepted', 'archived'].includes(task.state)))],
    ['recent', 'Project changes', activity.events.map(event => ({
      id: event.id, label: event.project.name, href: '#projects/' + event.project.id, state: event.status,
      detail: label(event.kind) + (event.milestone?.name ? ' · ' + event.milestone.name : ''), at: event.occurred_at, task: event.task_id,
    }))],
    ['recent', 'Open pull requests', recent(openPulls.map(pullRow))],
  ];

  return <>
    <div className="project-actions" role="group" aria-label="Activity view">
      {[[ 'all', 'All activity' ], [ 'attention', 'Needs attention' ], [ 'recent', 'Recent work' ]].map(([id, title]) =>
        <button key={id} type="button" className="quiet-button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{title}</button>)}
      {settings?.application && <button type="button" className="text-button" onClick={activity.refresh}>Refresh Project activity</button>}
      {settings?.application && filter === 'attention' && <a href="#settings/notifications" className="text-button">Edit attention preferences</a>}
    </div>
    <div className="attention-grid">{sections.filter(([group, , , key]) => (filter === 'all' || group === filter) && showsAlert(key))
      .map(([, title, items]) => <Panel title={title} key={title}>
      {['Project changes', 'Projects awaiting owner review'].includes(title) && activity.stale &&
        <p role="status">Project activity could not refresh.{items.length ? ' Showing the last read.' : ''}</p>}
      {items.length ? <ul className="attention-items">{items.map(item => <motion.li layout={reduced ? false : 'position'} key={item.id}>
        <div><a href={item.href}>{item.label}</a>
          {item.detail && <small>{item.detail}</small>}
          {time(item.at) && <time dateTime={item.at}>{time(item.at)}</time>}
          {item.project && <small><a href={'#projects/' + item.project}>Open Project</a></small>}
          {item.task && <small><a href={taskHref(item.task)}>Open Task</a></small>}
        </div>
        {item.state && <Status value={item.state}/>}
      </motion.li>)}</ul> : <p className="low">{['Project changes', 'Projects awaiting owner review'].includes(title) && activity.loading && settings?.application
        ? 'Loading Project changes…' : 'No matching records in the current feed.'}</p>}
    </Panel>)}</div>
  </>;
}
