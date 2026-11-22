# Phase 1B private Sites staging

The Aetherwake staging Site serves its frontend, the shared Task and Projects engine, and the sole staging ChatGPT connector. The Voyagewright staging Site forwards its authenticated frontend traffic to that engine. Each Site has a separate platform-provisioned D1. The Voyagewright Site exposes its database to the shared engine through a private service route. Both Site profiles must be built from the same exact Command Core source commit.

## Hosted verification on November 21, 2026

Both private Sites published and served signed-in requests from their pinned ChatGPT owner identities. The two application status APIs reported the same engine revision, [`7bd3ffda`](https://github.com/Kgray44/Engineering-Command-Core/commit/7bd3ffdaae7dbd791eb93dbc73337c2393f8a6b4). Deployment initially reproduced a Voyagewright bridge error. Reconstructing the forwarded request with explicit method, headers and body and using manual redirect handling restored hosted traffic. The revised profiles were published and verified against the actual Sites runtime.

Both qualification Projects were created and activated in Edge. Each has two milestones with recorded acceptance requirements. Aetherwake paused and resumed from its hosted Project controls. Both Projects and their milestones were visible after their Site was republished. Cross-application Project reads returned Project not found on both origins. Real service probes passed discovery on each application's worker endpoint. The peer Site credential received HTTP 401, the peer executor key received HTTP 403, and an explicit peer application ID received HTTP 403. A Site service credential alone received HTTP 403 on the owner Projects API. The Voyagewright D1 service returned its own partition identity. These hosted checks used scoped staging credentials.

A second signed-in browser check saved high priority, pending owner review, and revised hosted-integration milestone evidence on both Projects. The edits survived reload. The Sites database reader independently returned one active Project and two milestones in each Site binding. The edited milestone was at version 2 in each binding and all milestones remained planned.

The signed-in Codex App Server discovered the staging connector and called `list_applications`, Project list and detail, and Task list for each application. ChatGPT's installed staging plugin also read both application scopes. Codex registered three real Voyagewright Tasks in its qualification Project and linked the development Task to the managed-execution milestone. A follow-up Task was admitted with a future start and remained blocked on the development Task. The hosted Project reported three Tasks, one blocked prerequisite, one failed attempt, and one milestone link.

ChatGPT admitted exactly the Voyagewright development Task. The hosted Task audit recorded registration, admission, worker claim, heartbeats, and terminal failure. The isolated Windows worker used its scoped Voyagewright identity and the exact protected-main base revision `52000eb24962771459d7f6f10edb7d54412f8be0`. Checkout failed during Git fetch with lock contention after three fetch attempts, before the Codex model turn. The attempt yielded a checkout-failure receipt. Candidate, usage, PR, and CI receipts remain pending. The next retry must use a materially different checkout path that respects Voyagewright's workspace lifecycle admission.

The production Aetherwake Site continued to serve version 74 with the same URL and connector. The production connector returned the same 19 visible canonical Task IDs before and after staging work. Production's signed-in browser showed its existing worker online. The current and staging overview shared the same computed heading typography, text color, and sidebar styling in Edge. Staging included the Projects navigation item introduced in Phase 1A. Phase 1B did not edit the React UI or CSS.

The local Observatory, Sites/Worker, journal and Chromium suites passed after rebuilding the frontend. Browser coverage includes the Task Workspace, Merge Workspace and Project operations. Hosted Projects and storage evidence were collected separately from the fixtures.

## Phase 1B acceptance status

| Gate | Status | Evidence or remaining work |
| --- | --- | --- |
| A. Hosted deployment | PASS | Two private Sites, authenticated status, separate D1 bindings, persisted Project records across publication. |
| B. Two applications | PASS | Each Site serves its configured application through the same deployed engine revision. |
| C. Repository integration | BLOCKED | Authenticated GitHub CLI reads verified identities, default branches, open PRs, workflows and branch protection. Both hosted GitHub readers reported an anonymous rate limit. The staging engine requires two separate scoped GitHub credentials for the end-to-end run. |
| D. Project management | BLOCKED | Hosted Project creation, activation, pause/resume, priority, owner-review status, milestone edits and persistence were observed. Voyagewright has linked Tasks and a blocked dependency. Aetherwake Task qualification requires an observable hosted repository revision. |
| E. Aetherwake Codex Task | BLOCKED | A real registration request stopped with “Known repository revision required.” No Task, Attempt, candidate or PR receipt exists. |
| F. Voyagewright Codex Task | FAIL | Hosted registration, ChatGPT admission, worker claim, and failed Attempt receipt exist. Checkout failed before the model turn. Candidate and draft PR remain pending. |
| G. Isolation | NOT VERIFIED | Hosted Project reads, Site authorization, executor authentication and request-scope negatives passed. Live Task edits, claim leases, attempt telemetry and repository mutations remain to be qualified. |
| H. Execution and telemetry | NOT VERIFIED | Hosted Voyagewright claim and checkout failure were attributed to its Project and Task. Candidate execution, CI linkage and usage attribution remain pending. |
| I. Project-centered UI | NOT VERIFIED | Browser verified real Projects and milestones and displayed Voyagewright's linked Tasks and blocked dependency. Aetherwake Task and CI progress remain pending. |
| J. Migration rehearsal | BLOCKED | Sites read-only inspection enumerated the production D1 tables. A one-row request already reported a truncated payload in both `task_telemetry` and `private_projection`. The reader supports offset pages without a database-wide snapshot handle. Rehearsal requires a consistent, untruncated export that includes schema migration state. |
| K. Production preservation | PASS | Observed before and after through the deployed Site and Task connector. Production deployment and connector metadata stayed the same. |
| L. Owner-review readiness | PASS | [PR #1](https://github.com/Kgray44/Engineering-Command-Core/pull/1), this report and the cutover proposal identify verified behavior and outstanding permissions. Full Phase 1B acceptance is pending. |

The same owner-private staging MCP endpoint served authenticated calls from ChatGPT and Codex. Each operation names its application. Codex can register and inspect Tasks through this endpoint, and ChatGPT can admit an existing Task. The application-scoped Codex workers use their own Site worker endpoints to claim and report. Aetherwake registration through Codex returned HTTP 503 with “Known repository revision required.”

The next Aetherwake candidate Task is a focused calendar-date validation correction in `scripts/agent/validate-record.mjs`, covered by `tests/agent-contracts.test.mjs`. The Voyagewright candidate targets malformed frontmatter lines in the existing documentation validator. Both require the current GitHub revision to be read by the hosted engine before admission.

## Repository identity

The engine binds applications to the repositories below. GitHub identity and branch protection were verified using the GitHub CLI account during Phase 1B discovery.

| Application | GitHub repository | Repository ID | Default branch |
| --- | --- | --- | --- |
| Aetherwake | `Kgray44/Aetherwake` | `1441514620` | `main` |
| Voyagewright | `Kgray44/treasurehuntSoT` | `1303074266` | `main` |

## Publish the two staging profiles

1. Provision two fresh owner-private Sites. The manifest for each uses its own Site project ID and `"d1": "DB"`. Declare `"capabilities": ["mcp"]` on Aetherwake staging. Both use the existing Drizzle migrations. Set `COMMAND_CORE_HOST=sites-stage` and `COMMAND_CORE_SITE_ROLE` to the application ID when packaging each Site. Set `COMMAND_CORE_APPLICATIONS` as described in the README using the deployed Sites origins. Set `OBSERVATORY_SOURCE_REVISION` to the exact source commit when building from a Site mirror checkout.
2. From the supported Site settings, configure two independent 32-byte random keys as `ECC_FRONTEND_BRIDGE_KEY` and `ECC_STORAGE_BRIDGE_KEY` on both Sites. Configure `ECC_AETHERWAKE_SITE_SERVICE_TOKEN` on Voyagewright with the Aetherwake staging Site service credential. Configure `ECC_VOYAGEWRIGHT_SITE_SERVICE_TOKEN` on Aetherwake with the Voyagewright staging Site service credential. Dispatch validates the destination Site credential. The receiving Worker checks the additional directional key and denies browser identities on bridge routes.
3. Sign in separately at each Site and read `GET /_ecc/identity`. Store the resulting Site-scoped ID in that Site's secret `ECC_SITE_OWNER_ID`, then publish the updated runtime settings. An authenticated visitor can read their own identity for setup. The protected application routes require the pinned identity. The canonical engine maps the two explicitly pinned visitors to the common staging owner. Only the two configured origins can select frontend partitions. The Aetherwake MCP surface can list each application available to the shared owner.
4. Verify `GET /api/status` at both origins. It should report the same Command Core source revision and different application identities. Create one qualification Project per application, read each back after republishing the same candidate and verify the other Site cannot read or update it. Exercise Projects, Task Workspace, and Merge Workspace from the same Sites origins. With the wrong service credential or bridge key, verify the protected request is rejected.
5. In the native Sites tool, request Aetherwake staging `get_site` with `include_mcp_connection: true`. Use the returned plugin ID with the supported Install or Connect flow, or open the private staging plugin from **Plugins → Personal → Created by you**. Call `list_applications`, then scope Project and Task readbacks to both application IDs in a chat where the staging tools are available.

## Execute the repository acceptance Tasks

Configure each application with an independent repository-scoped GitHub credential. The engine reads `AETHERWAKE_GITHUB_READ_TOKEN` and `VOYAGEWRIGHT_GITHUB_READ_TOKEN` from the canonical Site's runtime secrets. Verify the configured repository identity and credential grants against GitHub before enabling writes. Read the default branch, relevant open PRs, rules and check workflows. Keep repository authentication outside the model execution process.

Store independent stage-only `AETHERWAKE_OBSERVATORY_TASK_WORKER_KEY` and `VOYAGEWRIGHT_OBSERVATORY_TASK_WORKER_KEY` secrets on the engine Site. Give each worker its own private configuration and checkout root, the corresponding Site's service credential via `COMMAND_CORE_SITE_SERVICE_TOKEN`, and the matching executor key via `AADS_TASK_WORKER_KEY`. Set `worker_mcp_url` to the application's own Site origin plus `/worker/mcp`. Use an explicit worker UUID, exact Task ID allowlist, and the qualified standalone Codex App Server. Follow the existing worker storage, branch and artifact safeguards. Report each attempted claim, failure, recovery and usage measure from the source receipts.

After the Tasks produce independently verified candidate commits, publish the exact commits as unmistakably labeled acceptance branches and draft PRs using the corresponding scoped GitHub credentials. Use the Task's `associate` operation to record a `pull_request` reference with the verified candidate SHA. Check the GitHub head and Actions result independently. The Sites staging profile disables the inherited proposal, publication, merge and CI mutation credentials. Operator publication must preserve the candidate and the pending owner review. Leave both PRs open.

## Migration and rollback

Obtain a consistent read-only production snapshot through an authorized Sites storage export. Treat the Task list and publishing metadata as bounded inventory evidence. Keep the authoritative export in private custody. Verify the migration journal, row counts, relationship integrity, stable Task and Attempt IDs, and content digests. Import into an isolated rehearsal database and repeat the migration from the same source. Keep the migration receipt and staging dispatch fence intact while reconciling attempts and leases. Run interruption, duplicate claim, stale report and rollback checks with staged data.

Retain the production Observatory deployment, connector and workers throughout the rehearsal. For staging rollback, stop the stage workers first, capture outstanding attempts, and restore both Sites to compatible versions built from the same canonical source. Confirm both app identities and D1 partitions before reopening staged claims. The separate production cutover proposal in [PHASE1.md](PHASE1.md) requires owner approval.
