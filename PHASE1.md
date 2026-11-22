# Phase 1 owner review

The candidate extracts Aetherwake Observatory and its local execution tools into Engineering Command Core. A single shared Worker serves configured application runtimes. Each runtime has an independent D1-compatible database, authenticated owner, repository mapping and worker credential. The original source is retained at the pinned Aetherwake revisions below. This candidate is for review and staging.

## Source baseline

- Initial extraction from Aetherwake [`bc01421c`](https://github.com/Kgray44/Aetherwake/commit/bc01421c4e2935fac79a86099eeee82ed4bed40d). Upstream automated Observatory job [44960157634](https://github.com/Kgray44/Aetherwake/actions/runs/44960157634) succeeded.
- The separately released owner-review contract from [Aetherwake #355](https://github.com/Kgray44/Aetherwake/pull/355) was carried forward at [`8bd0e455`](https://github.com/Kgray44/Aetherwake/commit/8bd0e4553bacf4e54b610723b10e80c28badddcc). Upstream automated Observatory job [44962765564](https://github.com/Kgray44/Aetherwake/actions/runs/44962765564) succeeded. The release chat verified the updated private Site and saved owner decision.
- The deployed connector responded to the read-only Task inventory before and after the release. The baseline includes only redacted observations. The exact hosted database migration level and a complete Task/Attempt inventory require authoritative hosted receipts.
- The isolated source baseline passed 69 Observatory tests, 114 Worker tests and 12 journal tests. The React and Sites Worker build passed with an inherited Vite chunk-size advisory.

## Functional parity and verification

| Capability | Source and candidate implementation | Verification or limit |
| --- | --- | --- |
| Task lifecycle, admission, dependencies, scheduling, addenda, owner decision | `sites/task-engine.mjs`, `task-engine-v1.schema.json`, Task Control Center | Original Worker and browser regression suites. Project pause and milestone gating are checked at claim time. |
| Worker routing, leased claims, interrupted execution | `sites/task-engine.mjs`, `scripts/agent/observatory-task-worker.mjs`, `scripts/agent/claim-telemetry.mjs` | Two application partitions claim concurrently. Duplicate claims and request replay preserve one Attempt. Local HTTP staging registers, admits, claims, restarts and reports through the actual control-plane APIs. The separate Codex connector and native executor binding need hosted qualification. |
| Private telemetry, failure evidence, timelines and PDF reports | `sites/task-telemetry.mjs`, journal exporter, Observatory React modules | Original contract, regression and browser coverage. Synthetic telemetry validates repository attribution. Reports continue to open from linked Tasks. |
| GitHub, CI, protected integration and Merge Workspace | `sites/github*.mjs`, `sites/ci-controls.mjs`, `sites/integration-runs.mjs`, `src/merge-workspace.jsx` | Original qualification and authorization fixtures and browser coverage. Mocked upstream requests verify application-specific credential and repository routing. Real GitHub main-ref reads were checked for both repositories. Hosted protected test mutations remain unverified. |
| MCP and owner authorization | `sites/mcp.mjs`, `sites/command-core.mjs` | Original task tools and shared project-aware tooling. Test conditions cover missing, malformed and unauthorized scope, shared credentials, wrong partition identity and an untrusted HTTP identity header. Hosted identity injection and the separate signed-in connector remain unverified. |
| Projects, milestones and explorer | `sites/projects.mjs`, `0016_projects.sql`, `src/projects-workspace.jsx` | Browser CRUD entry points, versioned updates, Project lifecycle, task registration and links. Backend Tests exercise one engine and overlapping IDs across partitions, milestone acceptance gating, telemetry isolation and race handling. |
| Migration and recovery | `sites/stage-snapshot.mjs`, `sites/staging.test.mjs` | Synthetic v15 SQLite snapshot preserves records and stable IDs, reconciles counts and row digests, rejects reuse with a different partition, and re-imports after removing only the disposable staging copy. The runtime denies imported partitions until lease custody is reconciled. |

Task completion, technical verification, PR integration, product delivery and owner acceptance have separate fields or source links. Project token and duration summaries are partial observations where data is present. Project-wide pricing and CI consumption are unavailable in the candidate. Historical Tasks remain unassigned until an owner explicitly associates them. Cross-Project milestone gates are available within an application. Cross-application dependencies and independently permissioned Project participants require further qualification. No Voyagewright product frontend was built.

## Deployment and migration

GitHub Actions builds the shared Worker with a two-application example and runs the existing and new suites. Local staging uses a real HTTP listener, isolated SQLite storage and independent synthetic application fixtures. GitHub fixture responses exercise routing without issuing mutations. The published Aetherwake Site and installed production ChatGPT connector continue to serve the live Task queue.

A hosted two-partition deployment needs a trusted ingress that supplies verified user identity, two isolated D1 bindings, stage-only owners and worker credentials, and a separate test connector. The Sites hosting reference documents one logical D1 field and per-Site user identities. A deployment with multiple independent bindings and application origins has yet to be qualified. Never reuse the current production DB binding, worker credential, or connector for staging.

The snapshot tool accepts a consistent, standalone v15 SQLite database generated by a qualified export path. It records a source digest and a legacy table content digest, applies the append-only Projects migration, checks counts and referential integrity, and publishes a frozen copy outside Git. The tool cannot validate a production export it has not received. It copies existing lease metadata for audit and keeps the entire imported partition fenced. Authoritative hosted export, conversion into the intended platform and restore rehearsal remain gated.

## Cutover proposal for later owner approval

1. Capture the production deployment revision, worker roster, backing store and connector bindings. Privately verify an authoritative export and record per-namespace counts, stable IDs, content hashes and migration level.
2. Rehearse in a stage-only partition. Validate the same Task, Attempt, integration, event and telemetry identities. Verify GitHub routing through designated test repositories and the separate stage connector. Leave the frozen copy isolated.
3. In an approved consistency window, stop new claims on the old dispatcher, allow active leases to settle, and reconcile each unresolved Attempt with its authoritative worker receipt. Prevent competing claims through both systems. Quiesce the old write path to take a final checkpoint and confirm its fence and stability before copying. The final checkpoint includes changes made after the rehearsal.
4. Rehearse restoring the previous deployment and connector against their source store. For the eventual switch, release the new dispatch fence only after independent checks of identity, data parity, GitHub scope, and queue ownership. Keep the source read-only at the agreed fence until the rollback window closes.
5. If any state, identity, lease, or repository gate fails, stop destination claims. Restore the old ingress, connector and worker assignments only after determining which system owns every in-flight Attempt. If the destination accepted writes, reconcile them before returning the source to authority. No two independent writers may operate during reconciliation.

Staging rollback was exercised by removing the isolated copy and re-importing the same checkpoint. A real hosted cutover, transport rollback, production write fence and active-lease reconciliation still require a rehearsed owner-approved runbook.

## Acceptance gates

| Gate | Status | Evidence and remaining risk |
| --- | --- | --- |
| A. Existing system preservation | NOT VERIFIED | Read-only connector and release change observed. Production custody was preserved during this work. Exact hosted Task/Attempt totals and complete live feature parity await owner review. |
| B. Canonical extraction | PASS | Destination contains attributed source, shared Worker, React frontend, worker/telemetry adapters and regression fixtures. Existing production remains pinned to the source repository until a cutover is separately approved. |
| C. Multi-project operation | NOT VERIFIED | The local shared-worker suite proves isolated app storage, credentials, Tasks, Projects, telemetry and concurrent claims. Hosted ingress, application-specific connectors and real scoped mutations remain unverified. |
| D. First-class Projects | NOT VERIFIED | Persistent Projects, milestones, associations, lifecycle actions, observed telemetry and Project-linked browser registration were exercised. Full project-level cost, CI, portfolio progress and acceptance reporting still need qualification. |
| E. Comprehensive verification | BLOCKED | Synthetic migration/recovery and local transport are demonstrated. Authoritative production snapshot access, hosted D1/authentication qualification, real credential-scoped GitHub operations and live staging Codex remain outstanding. |
| F. Safe owner review | NOT VERIFIED | A draft PR and staged evidence are the review surface. Hosted staging and the reversible production procedure are pending qualified rehearsal. |

Phase 2 executors, advanced scheduling and efficiency features, the Voyagewright frontend, the connector cutover and retirement of legacy infrastructure are outside this candidate.
