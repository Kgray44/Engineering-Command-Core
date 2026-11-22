export const preferenceFields = {
  landing_page: { category: 'general', label: 'Landing page', initial: 'overview',
    choices: { overview: 'Overview', projects: 'Projects', tasks: 'Task Control Center', activity: 'Activity', merge: 'Merge Control Center' } },
  density: { category: 'general', label: 'Panel density', initial: 'comfortable',
    choices: { comfortable: 'Comfortable', compact: 'Compact' } },
  project_layout: { category: 'projects', label: 'Project layout', initial: 'grid',
    choices: { grid: 'Card grid', list: 'List' } },
  project_sort: { category: 'projects', label: 'Default Project sort', initial: 'manual',
    choices: { manual: 'Manual order', newest: 'Newest first', oldest: 'Oldest first', priority: 'Highest priority', title: 'Title' } },
  project_priority: { category: 'projects', label: 'Default Project priority', initial: 'normal',
    choices: { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' } },
  merge_state: { category: 'integration', label: 'Default pull request filter', initial: 'open',
    choices: { open: 'Open', merged: 'Merged', closed: 'Closed', all: 'All states' } },
};

export const defaultPreferences = Object.fromEntries(Object.entries(preferenceFields).map(([key, field]) => [key, field.initial]));
