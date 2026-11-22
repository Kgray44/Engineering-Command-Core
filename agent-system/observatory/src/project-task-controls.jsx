import { lazy, Suspense } from 'react';
import { useTaskEngineDetail } from './use-task-engine-detail.jsx';
import { taskHref } from './task-workspace.mjs';
import { ProposalControls } from './proposal-controls.jsx';

const TaskEngineControls = lazy(() => import('./task-engine-controls.jsx').then(module => ({ default: module.TaskEngineControls })));

export function ProjectTaskControls({ task, tasks, headers, workerAccess, workerDispatch, onRefresh, onClose, Status, editor }) {
  const summary = { task: { id: task.id }, version: task.version, lifecycle: { state: task.state, blockers: task.blockers } };
  const { detail, command, error } = useTaskEngineDetail({ summary, workerDispatch, headers, onRefresh });
  const publication = editor?.publication?.[task.id];
  const publishedIntake = publication === 'published' && !detail?.lifecycle.executor;
  return <section className="project-task-controls" aria-label="Project Task execution">
    <div className="integration-actions">
      <button className="quiet-button" type="button" onClick={onClose}>Close execution controls</button>
      <a href={taskHref(task.id)}>Open Task Workspace</a>
    </div>
    {error && <p role="alert">{error}</p>}
    {detail ? <>
      {editor && publication !== 'pending' && !publishedIntake && <details>
        <summary>Task editor</summary>
        <ProposalControls task={detail.task} control={detail} tasks={editor.tasks} summaries={editor.summaries}
          classes={editor.classes} headers={headers} readFields={editor.readFields} Status={Status}
          engineCommand={command} engineEditable={detail.lifecycle.can_edit_spec}/>
      </details>}
      <Suspense fallback={<p role="status">Loading execution controls…</p>}>
        <TaskEngineControls detail={detail} tasks={tasks} workerAccess={workerAccess} workerDispatch={detail.worker_dispatch ?? workerDispatch}
          publishedIntake={publishedIntake} Status={Status} onCommand={command}/>
      </Suspense>
    </> : !error && <p role="status">Reading the current Task state…</p>}
  </section>;
}
