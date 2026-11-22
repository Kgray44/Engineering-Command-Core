# Settings and diagnostics

Open **Settings** to browse ten categories. General and Projects set workspace preferences. Integration sets the default pull request state, evidence filter, and sort. Repository, worker, scheduling, authorization, storage, and external delivery facts reflect the active configuration and available observations. The settings API reports credential presence only.

## Configuration registry

All editable values below are enum strings. The server validates the allowed values and requires the authenticated owner in the active application and namespace. Save and category reset take effect on the next render or page entry. Landing page changes apply on the next visit without a direct URL. No restart is required. D1 stores versioned preferences and audit snapshots.

| Setting | Default | Accepted values |
|---|---|---|
| Landing page | Overview | Overview, Projects, Task Control Center, Activity, Merge Control Center |
| Panel density | Comfortable | Comfortable, Compact |
| Sidebar | Expanded | Expanded or icon-only on desktop |
| Default Task sort | Newest first | Newest, oldest, priority, title |
| Default Task grouping | None | None, state, category |
| Project entry section | Overview | Overview, Tasks, Milestones, Dependencies, GitHub, Telemetry, Artifacts, History |
| Project layout | Card grid | Card grid, List |
| Default Project view | Current Projects | Current, active, planned or paused, awaiting review, accepted, archived |
| Default Project sort | Manual order | Manual order, recently active, newest, oldest, priority, title |
| Default Project priority | Normal | Low, Normal, High, Urgent |
| Default pull request filter | Open | Open, Merged, Closed, All states |
| Default integration evidence filter | All evidence states | Checks passed at inspection, blocked, checking, repairing, refresh required, awaiting inspection, merged, all evidence states |
| Default pull request sort | Recently updated | Recently updated, newest first, oldest first |
| Default Task priority | Normal | Low, Normal, High, Urgent |
| Default repair limit | 3 attempts | 1 to 5 attempts |
| Default Activity view | All activity | All activity, Needs attention, Recent work |

Restore defaults previews the category and requires a confirmation. Task priority and repair limit prefill new forms and can be overridden for each new item. Task grouping applies inside each Task activity view. Pull request criteria apply to the Merge source list. Changes made in either workspace are temporary. Change Settings to update the saved defaults.

Project card order persists independently from these preferences. The settings audit under **Security** lists the last 15 revisions and timestamps; the scoped read API also returns those revision values. If another tab has saved changes, refresh before applying your changes again.

| Deployment-owned configuration | Scope and source |
|---|---|
| Application identity, repo, origin, binding | Application, configured at build and verified against D1 at runtime |
| GitHub, worker, and bridge credentials | Application, deployment-managed secrets |
| Worker eligibility, scheduling, lease, and capacity policy | Existing Task Engine and native worker |
| Protected integration authorization and repair grants | Deployment bindings and exact-candidate integration records |
| Backup, import, and production custody | Deployment and operational runbooks |

Under **Data & Backup**, run the scoped data checks to inspect expected schema objects, current Project and milestone audit receipts, and linked Task integrity. The check reports counts for the current owner and namespace. A served partition has passed the import-checkpoint fence. Backup and restore evidence comes from the deployment-side recovery runbook.

Under **Connections**, choose **Verify connections** to read the current service revision and confirm the database partition responds for the signed-in application. On the canonical connector Site, the authenticated Settings route checks the server's MCP tool registry. The other Site links to the canonical check. The panel shows the latest success and failure in the current session. Use the connected ChatGPT plugin to verify its external transport and authorization separately. GitHub, worker, and telemetry rows retain the scope of the available source observations.

Under **Connections**, compare observed times, API request budget, worker heartbeats, backend and database readback, and GitHub status. A configured credential may remain unverified. Use the Action, Task, or Project link from **Activity** to inspect the source when a record needs attention.
