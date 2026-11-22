import { useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, Boxes, ChevronRight, Code, Flag, FlaskConical, GitBranch, Grip, Map, Milestone, Rocket, Search, Shield, Target, Wrench } from 'lucide-react';
import { projectAccents, projectIconGroups } from './project-presentation.mjs';

const icons = {
  activity: Activity, boxes: Boxes, code: Code, flag: Flag, flask: FlaskConical, 'git-branch': GitBranch,
  map: Map, milestone: Milestone, rocket: Rocket, search: Search, shield: Shield, target: Target, wrench: Wrench,
};

export function ProjectIcon({ id, size = 21 }) {
  const Icon = icons[id] ?? Boxes;
  return <Icon size={size} aria-hidden="true"/>;
}

export function ProjectAppearance({ project }) {
  const [icon, setIcon] = useState(project.icon ?? 'boxes');
  const [accent, setAccent] = useState(project.accent ?? 'default');
  const [query, setQuery] = useState('');
  const matchingGroups = Object.entries(projectIconGroups).map(([category, ids]) =>
    [category, ids.filter(id => (category + ' ' + id.replace('-', ' ')).toLowerCase().includes(query.trim().toLowerCase()))]
  ).filter(([, ids]) => ids.length);
  return <details>
    <summary>Project appearance</summary>
    <div className="form">
      <div className="project-icon-preview" data-accent={accent}><ProjectIcon id={icon}/></div>
      <input type="hidden" name="icon" value={icon}/>
      <label>Accent color
        <select name="accent" value={accent} onChange={event => setAccent(event.target.value)}>
          {projectAccents.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <label>Find a project icon <input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
      {!matchingGroups.length && <p role="status">No icons match this search.</p>}
      {matchingGroups.map(([category, ids]) => <div key={category} role="group" aria-label={category}>
        <p>{category}</p>
        <div className="project-icon-choices">{ids.map(id => <button key={id} type="button" className="quiet-button"
          aria-pressed={icon === id} onClick={() => setIcon(id)}><ProjectIcon id={id} size={15}/>{id.replace('-', ' ')}</button>)}</div>
      </div>)}
    </div>
  </details>;
}

function Card({ item, Status, sortable, keyboard }) {
  const reduced = useReducedMotion();
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: item.id, disabled: !sortable });
  const pickedUp = sortable && keyboard.drag?.id === item.id;
  const hovered = isOver || (sortable && keyboard.drag?.target === item.id);
  const dragging = isDragging || pickedUp;
  const progress = item.progress;
  return <li ref={setNodeRef} data-accent={item.accent ?? 'default'} className="project-card"
    data-dragging={dragging || undefined} data-drag-over={hovered || undefined} data-insertion={hovered && !dragging || undefined}
    style={{ transform: CSS.Transform.toString(transform), transition: reduced ? undefined : transition }}>
    <motion.a className="project-card-link" href={'#projects/' + item.id} whileHover={reduced ? undefined : { y: -2 }}>
      <span className="project-card-icon"><ProjectIcon id={item.icon}/></span>
      <span className="project-card-name">{item.name}</span>
      {item.description && <span className="project-card-description">{item.description}</span>}
      <span className="project-card-status"><Status value={item.status}/><small>{item.priority} priority</small></span>
      {progress && <small className="project-card-progress">{progress.tasks.completed}/{progress.tasks.total} Tasks complete · {progress.tasks.active} running · {progress.tasks.blocked} blocked · {progress.milestones.accepted}/{progress.milestones.total} milestones accepted</small>}
      {item.owner_review === 'pending' && <small>Owner review pending</small>}
      {item.latest_activity && <small className="project-card-activity">
        <span>{item.latest_activity.label}</span> · <time dateTime={item.latest_activity.at}>{new Date(item.latest_activity.at).toLocaleDateString()}</time>
      </small>}
      <span className="project-card-action">Open project <ChevronRight size={15} aria-hidden="true"/></span>
    </motion.a>
    {sortable && <button type="button" className="icon-button project-card-handle" ref={setActivatorNodeRef}
      {...attributes} {...listeners} aria-label={'Reorder ' + item.name} aria-pressed={pickedUp}
      onKeyDown={event => keyboard.onKey(event, item.id)} onBlur={() => keyboard.cancel(item.id)}>
      <Grip size={18} aria-hidden="true"/>
    </button>}
  </li>;
}

const keyboardDirection = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

function useKeyboardOrder(ids, title, onMove) {
  const [drag, setDrag] = useState(null);
  const [announcement, setAnnouncement] = useState('');

  function cancel(id) {
    if (drag?.id !== id) return;
    setDrag(null);
    setAnnouncement('Reordering canceled');
  }

  function onKey(event, id) {
    const moving = drag?.id === id;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return;
      if (!moving) {
        setDrag({ id, target: id });
        setAnnouncement('Picked up ' + title(id));
      } else {
        setDrag(null);
        if (drag.target !== id) onMove(ids, id, drag.target);
        setAnnouncement(drag.target === id ? 'Order unchanged' :
          'Moved ' + title(id) + ' to position ' + (ids.indexOf(drag.target) + 1));
      }
      return;
    }
    if (!moving) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel(id);
    } else if (keyboardDirection[event.key]) {
      event.preventDefault();
      const target = ids[ids.indexOf(drag.target) + keyboardDirection[event.key]];
      if (target) {
        setDrag({ id, target });
        setAnnouncement('Position ' + (ids.indexOf(target) + 1) + ', ' + title(target));
      }
    }
  }
  return { drag, announcement, onKey, cancel };
}

export function ProjectCardGrid({ rows, Status, sortable, onMove, layout }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );
  const ids = rows.map(item => item.id);
  const title = id => rows.find(item => item.id === id)?.name;
  const keyboard = useKeyboardOrder(ids, title, onMove);
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => {
    if (sortable && over && active.id !== over.id) onMove(ids, active.id, over.id);
  }} accessibility={{
    screenReaderInstructions: { draggable: 'Press Space or Enter to pick up the card. Use the arrow keys to choose its position. Press Space or Enter to drop it, or Escape to cancel.' },
    announcements: {
      onDragStart: ({ active }) => 'Picked up ' + title(active.id),
      onDragOver: ({ over }) => over ? 'Over ' + title(over.id) : 'Outside the project grid',
      onDragEnd: ({ active, over }) => !over || active.id === over.id ? 'Order unchanged' :
        'Moved ' + title(active.id) + ' to position ' + (ids.indexOf(over.id) + 1),
      onDragCancel: () => 'Reordering canceled',
    },
  }}>
    <span className="project-reorder-announcement" role="status" aria-live="polite">{keyboard.announcement}</span>
    <SortableContext items={ids} strategy={rectSortingStrategy}>
      <ul className="project-card-grid" data-layout={layout}>{rows.map(item => <Card key={item.id} item={item} Status={Status} sortable={sortable} keyboard={keyboard}/>)}</ul>
    </SortableContext>
  </DndContext>;
}
