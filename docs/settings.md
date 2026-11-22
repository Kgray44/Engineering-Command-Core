# Settings and diagnostics

Open **Settings** to browse ten categories. General and Projects set workspace preferences. Integration includes the default pull request filter. Repository, worker, scheduling, authorization, storage, and external delivery facts reflect the active configuration and available observations. The settings API reports credential presence only.

## Configuration registry

All editable values below are enum strings. The server validates the allowed values and requires the authenticated owner in the active application and namespace. Save and category reset take effect on the next render or page entry. Landing page changes apply on the next visit without a direct URL. No restart is required. D1 stores versioned preferences and audit snapshots.

| Setting | Default | Accepted values |
|---|---|---|
| Landing page | Overview | Overview, Projects, Task Control Center, Activity, Merge Control Center |
| Panel density | Comfortable | Comfortable, Compact |
| Sidebar | Expanded | Expanded or icon-only on desktop |
| Default Task sort | Newest first | Newest, oldest, priority, title |
| Project entry section | Overview | Overview, Tasks, Milestones, Dependencies, GitHub, Telemetry, Artifacts, History |
| Project layout | Card grid | Card grid, List |
| Default Project sort | Manual order | Manual order, newest, oldest, priority, title |
| Default Project priority | Normal | Low, Normal, High, Urgent |
| Default pull request filter | Open | Open, Merged, Closed, All states |
| Default Task priority | Normal | Low, Normal, High, Urgent |
| Default repair limit | 3 attempts | 1 to 5 attempts |
| Default Activity view | All activity | All activity, Needs attention, Recent work |

Restore defaults previews the category and requires a confirmation. Task priority and repair limit prefill new forms and can be overridden for each new item. Saved preferences leave existing Tasks and integration runs intact.

Project card order persists independently from these preferences. The settings audit under **Security** lists the last 15 revisions and timestamps; the scoped read API also returns those revision values. If another tab has saved changes, refresh before applying your changes again.

| Deployment-owned configuration | Scope and source |
|---|---|
| Application identity, repo, origin, binding | Application, configured at build and verified against D1 at runtime |
| GitHub, worker, and bridge credentials | Application, deployment-managed secrets |
| Worker eligibility, scheduling, lease, and capacity policy | Existing Task Engine and native worker |
| Protected integration authorization and repair grants | Deployment bindings and exact-candidate integration records |
| Backup, import, and production custody | Deployment and operational runbooks |

Under **Data & Backup**, run the scoped data checks to inspect expected schema objects, current Project and milestone audit receipts, and linked Task integrity. The check reports counts for the current owner and namespace. A served partition has passed the import-checkpoint fence. Backup and restore evidence comes from the deployment-side recovery runbook.

Under **Connections**, compare observed times, API request budget, worker heartbeats, backend and database readback, and GitHub status. A configured credential may remain unverified. Use the Action, Task, or Project link from **Activity** to inspect the source when a record needs attention.
