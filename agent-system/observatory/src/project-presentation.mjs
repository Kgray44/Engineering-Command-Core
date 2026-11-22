// Persist stable identifiers. Applications provide their own color values.
export const projectIconGroups = {
  Engineering: ['boxes', 'code', 'git-branch', 'rocket', 'wrench'],
  Planning: ['flag', 'map', 'milestone', 'target'],
  Investigation: ['activity', 'flask', 'search', 'shield'],
};

export const projectAccents = ['default', 'blue', 'violet', 'green', 'amber', 'rose'];

export const projectReviewLabels = {
  '': 'No decision recorded',
  pending: 'Awaiting owner review',
  accepted: 'Accepted by owner',
  declined: 'Declined by owner',
};

export function orderBySavedIds(projects, savedIds) {
  const byId = new Map(projects.map(project => [project.id, project]));
  const ordered = [];
  for (const id of savedIds) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
}
