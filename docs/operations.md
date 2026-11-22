# Developer verification and operations

The Observatory package owns the React build, API tests, and browser workflows. Test the normal routes after changing a component. Fixture coverage uses local HTTP and SQLite with synthetic GitHub records. Hosted qualification checks service identity, partition wiring, provider observations, and deployed revision separately.

## Regression checks

- `npm test` covers inherited contracts, task workspace selectors, observability, and analytics.
- `npm run test:sites` covers authorization, Task Engine transitions, GitHub evidence, protected integration, storage isolation, and Phase 2 Project and settings persistence.
- `node --test ../../tests/agent-journal-export.test.mjs` covers journal exports.
- `npm run test:workspace:e2e` covers existing workspace interactions and SQLite-backed staging. Set `OBSERVATORY_ENGINE_E2E=1` for the full Task browser scenario.

See [deployment](deployment.md) for the shared Worker build. Use the staging browser test's optional `COMMAND_CORE_SCREENSHOT_DIR` only for a synthetic test run so captured artifacts contain no private records. The browser test verifies that Project history mounts before scrolling and remains reachable by keyboard, and that settled entrance animation releases its blur layer. The intermittent reported scroll bands still require observation on the actual hosted browser and hardware.

## Troubleshooting and recovery

If Projects or Settings report a scope error, check the caller's assignment, the origin configuration, and the D1 singleton identity. If a preference or card order conflicts, refresh before resubmitting. For a blocked Task, open its attempt and dependency receipts. For GitHub errors, check the latest observed credential state, rate-limit budget, source SHA, and recorded workflow attempt. A heartbeat is stronger evidence of worker availability than credential presence.

Before rehearsing a migration, take a consistent export in private custody. Record the source digest, migration journal, row counts, and stable Project, Task, and attempt identities. Rehearse replay, failure recovery, stale leases, and rollback against a separate database. An imported snapshot remains fenced. Use the [Phase 1B steps](../PHASE1B-SITES.md) for worker handoff and Site rollback. Production service, data, and worker ownership remain subject to separate authorization.
