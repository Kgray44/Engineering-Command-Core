import { lazy, Suspense } from 'react';
import { useTaskEngineDetail } from './use-task-engine-detail.jsx';
import { taskHref } from './task-workspace.mjs';

const TaskEngineControls = lazy(() => import('./task-engine-controls.jsx').then(module => ({ default: module.TaskEngineControls })));

export function ProjectTaskControls({ task, tasks, headers, workerAccess, workerDispatch, onRefresh, onClose, Status }) {
  const summary = { task: { id: task.id }, version: task.version, lifecycle: { state: task.state, blockers: task.blockers } };
  const { detail, command, error } = useTaskEngineDetail({ summary, workerDispatch, headers, onRefresh });
  return <section className="project-task-controls" aria-label="Project Task execution">
    <div className="integration-actions">
      <button className="quiet-button" type="button" onClick={onClose}>Close execution controls</button>
      <a href={taskHref(task.id)}>Open Task Workspace</a>
    </div>
    {error && <p role="alert">{error}</p>}
    {detail ? <Suspense fallback={<p role="status">Loading execution controls…</p>}>
      <TaskEngineControls detail={detail} tasks={tasks} workerAccess={workerAccess} workerDispatch={detail.worker_dispatch ?? workerDispatch}
        Status={Status} onCommand={command}/>
    </Suspense> : !error && <p role="status">Reading the current Task state…</p>}
  </section>;
}
