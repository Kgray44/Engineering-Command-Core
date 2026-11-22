export const projectTemplates = [
  { id: 'feature', label: 'Software feature', milestones: ['Confirm scope', 'Implement and verify', 'Review delivery'] },
  { id: 'bug', label: 'Bug repair', milestones: ['Confirm reproduction', 'Verify the repair', 'Review regression evidence'] },
  { id: 'integration', label: 'Integration', milestones: ['Confirm interfaces', 'Verify the integration', 'Review rollout'] },
  { id: 'maintenance', label: 'Maintenance', milestones: ['Inventory affected components', 'Verify the maintenance change', 'Review recovery steps'] },
  { id: 'research', label: 'Research', milestones: ['Define the question', 'Collect and review evidence', 'Record the recommendation'] },
];

export function templateMilestones(id) {
  return projectTemplates.find(template => template.id === id)?.milestones ?? [];
}
