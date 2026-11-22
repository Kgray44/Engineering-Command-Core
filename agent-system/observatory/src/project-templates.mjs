export const projectTemplates = [
  { id: 'feature', label: 'Software feature',
    scope: 'Define the user journey, affected components, and boundaries of the feature.',
    acceptance: 'Demonstrate the user journey and record regression results for existing behavior.',
    milestones: ['Confirm scope', 'Implement and verify', 'Review delivery'] },
  { id: 'bug', label: 'Bug repair',
    scope: 'Record the reproduction, affected versions, and behavior that should recover.',
    acceptance: 'Verify the repair against the original reproduction and record regression results.',
    milestones: ['Confirm reproduction', 'Verify the repair', 'Review regression evidence'] },
  { id: 'integration', label: 'Integration',
    scope: 'Identify the systems, interfaces, and authorization boundaries involved.',
    acceptance: 'Verify the end-to-end flow, access boundaries, and recovery from a failed operation.',
    milestones: ['Confirm interfaces', 'Verify the integration', 'Review rollout'] },
  { id: 'maintenance', label: 'Maintenance',
    scope: 'List the affected components and the operating constraints for this change.',
    acceptance: 'Verify existing workflows after the change and document the recovery steps.',
    milestones: ['Inventory affected components', 'Verify the maintenance change', 'Review recovery steps'] },
  { id: 'research', label: 'Research',
    scope: 'State the research question, evidence sources, and constraints.',
    acceptance: 'Share the findings, supporting evidence, and unresolved uncertainties.',
    milestones: ['Define the question', 'Collect and review evidence', 'Record the recommendation'] },
];

export const customTemplateLimits = { count: 4, label: 80, text: 1000, milestones: 8, milestone: 120, bytes: 3600 };

export function validCustomProjectTemplates(templates) {
  const limits = customTemplateLimits;
  const text = (value, max) => typeof value === 'string' && value.length <= max && value === value.trim();
  return Array.isArray(templates) && templates.length <= limits.count && templates.every(template =>
    template && Object.keys(template).length === 5 &&
    typeof template.id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(template.id) &&
    text(template.label, limits.label) && template.label.length > 0 &&
    text(template.scope, limits.text) && text(template.acceptance, limits.text) &&
    Array.isArray(template.milestones) && template.milestones.length <= limits.milestones &&
    template.milestones.every(name => text(name, limits.milestone) && name.length > 0)) &&
    new Set(templates.map(template => template.id)).size === templates.length &&
    new Set(templates.map(template => template.label.toLowerCase())).size === templates.length &&
    new TextEncoder().encode(JSON.stringify(templates)).length <= limits.bytes;
}
