# Projects, Tasks, and milestones

Open **Projects** and choose **New project**. Give it a name and objective. Open **Project appearance** to search icons, preview the combination, and choose an accent. A template supplies editable scope, acceptance requirements, and suggested milestones. Switching templates updates fields you have yet to edit. Choose **Blank project** to clear untouched suggestions while retaining your edits. Save reusable custom defaults in **Settings → Projects** and select them from the Project template menu. Open a suggestion in the milestone form and provide the acceptance evidence required to add it. Creating a Project, accepting a suggestion, and admitting a Task are separate explicit actions.

In **Current Projects**, use **Manual order** with search, State, and Group cleared. Drag the handle with a pointer or use Space, the arrow keys, and Space again. Escape cancels. Touch users can press and hold the handle before moving the card. Sorting and filtering leave the manual order intact. Before the first save, manual order starts with the newest Projects by creation date. Once the server records an order, newly created Projects appear after saved cards until rearranged. On a conflict the Library reloads current state so you can make the change again.

Each card shows a recent recorded change from the Project or its linked work. It also shows whether the owner review is pending, accepted, or declined when a decision is recorded. Choose **Recently active** to sort by those timestamps. Choose the starting view and sort in **Settings → Projects**. Switch to **Current Projects** and **Manual order** when you want to change card positions.

Open a card to inspect the Project. Jump links lead to task, milestone, dependency, GitHub, artifact, telemetry, and history sections. Edit metadata or change the Project state from the overview. Archiving preserves identity and history.

## Activity and attention

Open **Activity** to scan all activity, focus on items that need attention, or browse recent work. The Center uses recorded Project changes, Task lifecycle states, failed attempts, explicit GitHub review requests, CI results, and worker observations. Prerequisite rows show the Task or capability holding up execution when available. Project and Task links take you to their source workspaces. GitHub cache and credential warnings link to the connection settings. Integration attention shows the recorded blocker and opens the exact run. Recently landed integrations require a recorded landed commit and link to the same integration history.

## Work and acceptance

Use **New project task** for Task intake with the Project association. **Associate an existing Task** lists unassigned Tasks from the current application and submits the selected record's version. The Task keeps its original identity. Filter by title, ID, or state and sort by creation date, priority, or title. The sort starts from the saved **Default Task sort** preference. Rows show recorded priority and latest activity. Expand **Execution controls** for scheduling, pause, resume, retry, and other actions available in the current Task state. Open the full Task Workspace for its specification editor, logs, attempt history, and reports. **Move a Task to another Project** preserves canonical Task and attempt IDs for eligible unadmitted or finished Tasks without milestone links. Both Projects retain a relationship event.

Use **Move earlier** or **Move later** to change milestone order. In **Dependencies**, choose a Task to inspect its recorded prerequisites, milestone gates, and dependent Tasks in this Project.

A milestone is an explicit acceptance gate. Open a milestone to link an existing Project Task, inspect its readiness and blockers, see which downstream Tasks require the milestone, and review its recorded history. Use **Dependencies** to set another Project's milestone as a prerequisite where the scoped engine permits it. The engine checks dependency, milestone, and Project conditions before dispatch. Review the stated evidence and save the milestone's acceptance decision separately, even when every linked Task has been accepted.

Project progress and telemetry draw from observed Tasks, attempts, and integration records. Missing token, cost, and CI values show as unavailable.

Open **Acceptance** to compare completed Task candidates, the Project's verification marker, recorded exact-revision PR checks, landed integrations, deployment records, and the owner decision. Expand the candidate list for its canonical Task, or follow the PR checks link to GitHub and verification. The counts describe evidence linked to the Project. Record the owner's decision separately with **Save owner review**. Changes appear in Project History.

**History** shows Project, milestone, association, and owner decision changes alongside the latest 120 eligible Task and integration changes. Choose **Show worker heartbeats** to include up to 40 recent pulses in the timeline. Pulses have a separate limit, so they cannot crowd changes out of the view. Receipt dates are kept from their source records. Moving a Task preserves earlier events in the previous Project and records later events under the new Project. The Task and integration links open their full source histories.

**GitHub and verification** shows the observed repository main commit and its timestamp when available. Open a linked PR in Merge Control Center to inspect its source and checks. Each tracked integration shows its recorded state and opens the saved run directly. Expand its required checks to see their recorded outcomes and associated head and base. Open Merge Control Center to refresh the live source before acting.

**Artifacts and reports** collects tracked PRs, GitHub Actions runs, web artifacts, and verification references from linked Tasks. Each Task has a shortcut to its PDF export and a direct link to its Evidence ledger. Only ordinary HTTPS references become direct web links. A private reference stays in its owning Task, and reported or synthetic verification is labeled at the Project level.
