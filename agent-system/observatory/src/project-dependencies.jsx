import { useState } from 'react';
import { ArrowDown, GitBranch } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { taskHref } from './task-workspace.mjs';

export function ProjectDependencies({ tasks, prerequisites, gates, Status, busy, onRemoveGate }) {
  const [focus, setFocus] = useState(null);
  const reduced = useReducedMotion();
  const current = tasks.find(task => task.id === focus) ?? tasks[0];
  if (!current) return null;
  const upstream = prerequisites.filter(item => item.task_id === current.id);
  const downstream = prerequisites.filter(item => item.type === 'task' && item.id === current.id);
  const milestoneGates = gates.filter(item => item.task_id === current.id);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  return <div className="project-dependency-graph">
    <label>Focus on a Task<select value={current.id} onChange={event => setFocus(event.target.value)}>
      {tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
    </select></label>
    <motion.div key={current.id} className="project-dependency-flow"
      initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
      <section aria-label="Upstream prerequisites">
        <h3>Prerequisites</h3>
        {upstream.length || milestoneGates.length ? <ul className="project-dependency-nodes">
          {upstream.map(item => <li key={item.type + ':' + item.id}>
            {item.type === 'task' && taskById.has(item.id)
              ? <button type="button" className="text-button" onClick={() => setFocus(item.id)}>{item.title ?? item.id}</button>
              : item.type === 'task' && item.title ? <a href={taskHref(item.id)}>{item.title}</a> : <span>{item.id}</span>}
            <Status value={item.status}/>
            {item.milestone === 'merged' && <small>Requires a verified merge</small>}
            {item.state === 'missing' && <small>Prerequisite unavailable</small>}
          </li>)}
          {milestoneGates.map(item => <li key={item.milestone_id}>
            <a href={'#projects/' + item.project_id}>{item.name}</a>
            <Status value={item.status}/><small>Requires milestone acceptance</small>
            {onRemoveGate && item.removable_gate_event_id && <details>
              <summary>Remove prerequisite</summary>
              <p>Remove {item.name} as a requirement for {current.title}? Project History will retain the change.</p>
              <button type="button" className="quiet-button" disabled={busy}
                onClick={() => onRemoveGate({
                  task_id: current.id, milestone_id: item.milestone_id, expected_version: current.version,
                  expected_gate_event_id: item.removable_gate_event_id,
                })}>Confirm removal</button>
            </details>}
          </li>)}
        </ul> : <p className="low">No recorded prerequisites.</p>}
      </section>
      <ArrowDown size={18} aria-hidden="true"/>
      <section aria-label="Selected Task"><h3>Selected Task</h3>
        <div className="project-dependency-current"><GitBranch size={17} aria-hidden="true"/>
          <a href={taskHref(current.id)}>{current.title}</a><Status value={current.state}/>
        </div>
      </section>
      <ArrowDown size={18} aria-hidden="true"/>
      <section aria-label="Dependent Tasks"><h3>Dependent Tasks in this Project</h3>
          {downstream.length ? <ul className="project-dependency-nodes">{downstream.map(item => <li key={item.task_id}>
            <button type="button" className="text-button" onClick={() => setFocus(item.task_id)}>{taskById.get(item.task_id)?.title}</button>
            <Status value={item.status}/>
          </li>)}</ul> : <p className="low">No recorded dependents in this Project.</p>}
      </section>
    </motion.div>
  </div>;
}
