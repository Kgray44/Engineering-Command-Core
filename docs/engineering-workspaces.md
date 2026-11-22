# Projects, Tasks, and milestones

Open **Projects** and choose **New project**. Give it a name and objective. Open **Project appearance** to search icons, preview the combination, and choose an accent. A template supplies editable scope, acceptance requirements, and suggested milestones. Switching templates updates fields you have yet to edit. Choose **Blank project** to clear untouched suggestions while retaining your edits. Open a suggestion in the milestone form and provide the acceptance evidence required to add it. Creating a Project, accepting a suggestion, and admitting a Task are separate explicit actions.

In **Current Projects**, use **Manual order** with search, State, and Group cleared. Drag the handle with a pointer or use Space, the arrow keys, and Space again. Escape cancels. Touch users can press and hold the handle before moving the card. Sorting and filtering are temporary views. Once the server records an order, newly created Projects appear after saved cards until rearranged. On a conflict the Library reloads current state so you can make the change again.

Open a card to inspect the Project. Jump links lead to task, milestone, dependency, GitHub, artifact, telemetry, and history sections. Edit metadata or change the Project state from the overview. Archiving preserves identity and history.

## Activity and attention

Open **Activity** to scan all activity, focus on items that need attention, or browse recent work. The Center uses recorded Project changes, Task lifecycle states, failed attempts, explicit GitHub review requests, CI results, and worker observations. Prerequisite rows show the Task or capability holding up execution when available. Project and Task links take you to their source workspaces. GitHub cache and credential warnings link to the connection settings.

## Work and acceptance

Use **New project task** for Task intake with the Project association. Filter the Project Task list by name or state. Expand **Execution controls** for scheduling, pause, resume, retry, and other actions available in the current Task state. Open the full Task Workspace for its specification editor, logs, attempt history, and reports. **Move a Task to another Project** preserves canonical Task and attempt IDs for eligible unadmitted or finished Tasks without milestone links. Both Projects retain a relationship event.

Use **Move earlier** or **Move later** to change milestone order. In **Dependencies**, choose a Task to inspect its recorded prerequisites, milestone gates, and dependent Tasks in this Project.

A milestone is an explicit acceptance gate. Link Tasks to a milestone to show related work, or set another Project's milestone as a prerequisite where the scoped engine permits it. The engine checks dependency, milestone, and Project conditions before dispatch. The completion counts summarize work. Review and accept milestones separately after checking the stated evidence.

Project progress and telemetry draw from observed Tasks, attempts, and integration records. Missing token, cost, and CI values show as unavailable.

Open **Acceptance** to compare completed Task candidates, the Project's verification marker, recorded exact-revision PR checks, landed integrations, deployment records, and the owner decision. Expand the candidate or check lists to open the canonical Task or integration record. The counts describe evidence linked to the Project. Record the owner's decision separately with **Save owner review**. Changes appear in Project History.

**History** shows Project, milestone, association, and owner decision changes alongside the latest 120 eligible Task and integration receipts. Receipt dates are kept from their source records. Moving a Task preserves earlier events in the previous Project and records later events under the new Project. The Task and integration links open their full source histories.

**Artifacts and reports** collects tracked PRs, GitHub Actions runs, web artifacts, and verification references from linked Tasks. Each Task has a shortcut to its PDF export and a direct link to its Evidence ledger. Only ordinary HTTPS references become direct web links. A private reference stays in its owning Task, and reported or synthetic verification is labeled at the Project level.
