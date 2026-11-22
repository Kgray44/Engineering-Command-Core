import { motion, useReducedMotion } from 'motion/react';
import { activityHref, activityId } from './github-activity.mjs';
import { taskHref } from './task-workspace.mjs';

export function EngineeringAttention({ tasks, attempts, github, dispatch, runs, Panel, Status, demo }) {
  const reduced = useReducedMotion();
  if (demo) return <p className="notice">Open Live mode to view engineering activity.</p>;
  const taskLink = (task, state) => ({ id: task.id, label: task.title, state, href: taskHref(task.id) });
  const taskIndex = new Map(tasks.map(task => [task.id, task]));
  const sections = [
    ['Owner review', tasks.filter(task => task.owner_acceptance === 'pending' || task.state === 'verifying')
      .map(task => taskLink(task, task.state))],
    ['Blocked and failed Tasks', tasks.filter(task => ['blocked', 'failed'].includes(task.state)).map(task => taskLink(task, task.state))],
    ['Running work', tasks.filter(task => ['running', 'pausing', 'cancelling'].includes(task.state)).map(task => taskLink(task, task.state))],
    ['Recent execution receipts', attempts.slice(0, 12).filter(attempt => taskIndex.has(attempt.task_id))
      .map(attempt => ({ ...taskLink(taskIndex.get(attempt.task_id), attempt.state), id: attempt.id }))],
    ['Open pull requests', (github?.pulls?.items ?? []).filter(item => item.state === 'open').slice(0, 12)
      .map(item => ({ id: activityId('pulls', item), label: item.title, state: item.state, href: '#merge?pr=' + activityId('pulls', item) })).filter(item => item.id)],
    ['Failed CI runs', (github?.ci?.items ?? []).filter(item => item.conclusion === 'failure').slice(0, 12)
      .map(item => ({ id: activityId('runs', item), label: item.title ?? item.workflow, state: item.conclusion, href: activityHref('runs', activityId('runs', item)) })).filter(item => item.id)],
    ['Integration attention', runs.filter(run => ['blocked', 'checking', 'repairing', 'merge_ready'].includes(run.state))
      .map(run => ({ id: run.id, label: run.pr_number ? 'Pull request #' + run.pr_number : 'Task candidate ' + run.head_sha.slice(0, 10),
        state: run.state, href: '#merge?run=' + run.id + (run.pr_number ? '&pr=' + run.pr_number : '') }))],
    ['Connections', [{ id: 'worker', label: dispatch.label, href: '#settings/workers' },
      ...(github?.main?.status !== 'available' ? [{ id: 'github', label: github?.main?.reason ?? 'GitHub main is unverified', href: '#settings/github' }] : [])]],
  ];
  return <div className="attention-grid">{sections.map(([title, items]) => <Panel title={title} key={title}>
    {items.length ? <ul className="attention-items">{items.map(item => <motion.li layout={reduced ? false : 'position'} key={item.id}>
      <a href={item.href}>{item.label}</a>{item.state && <Status value={item.state}/>}
    </motion.li>)}</ul> : <p className="low">No matching records in the current feed.</p>}
  </Panel>)}</div>;
}
