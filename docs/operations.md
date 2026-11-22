# Developer verification and operations

The Observatory package owns the React build, API tests, and browser workflows. Test the normal routes after changing a component. Fixture coverage uses local HTTP and SQLite with synthetic GitHub records. Hosted qualification checks service identity, partition wiring, provider observations, and deployed revision separately.

## Regression checks

- `npm test` covers inherited contracts, task workspace selectors, observability, and analytics.
- `npm run test:sites` covers authorization, Task Engine transitions, GitHub evidence, protected integration, storage isolation, and Phase 2 Project and settings persistence.
- `node --test ../../tests/agent-journal-export.test.mjs` covers journal exports.
- `npm run test:workspace:e2e` covers existing workspace interactions and SQLite-backed staging. Set `OBSERVATORY_ENGINE_E2E=1` for the full Task browser scenario.

See [deployment](deployment.md) for the shared Worker build. Use the staging browser test's optional `COMMAND_CORE_SCREENSHOT_DIR` only for a synthetic test run so captured artifacts contain no private records. The browser test verifies that Project history mounts before scrolling and remains reachable by keyboard, and that settled entrance animation releases its blur layer. The intermittent reported scroll bands still require observation on the actual hosted browser and hardware.

### Scroll rendering measurement

The animated scan grid now translates its repeated tile beneath a stationary mask. The tile extends one cell above and to the left of the viewport so it covers the full mask throughout the cycle. Chromium can move the rasterized tile without invalidating its background paint on every frame. The period, cell size, theme opacity, canvas particles, haze, and sidebar glass remain in place. Reduced motion stops grid movement.

On Chrome 157 for Windows, a controlled 1,440 × 900 headless comparison used the same React build, a real local Command Core worker and SQLite partition, and a Project with 30 seeded Tasks. Each variant ran three 3.2-second scroll sweeps over a 4,972-pixel range with trace collection after load and fonts settled. Baseline used the compiled stylesheet from `e194cfb`. Paint counts include all traced page Paint events.

| Measurement | Baseline | Translated tile |
|---|---:|---:|
| Median Paint events per sweep | 1,389 | 1,067 |
| Median time in traced Paint events | 364.50 ms | 327.52 ms |
| p95 animation frame callback interval | 6.20 ms | 6.20 ms |
| Unexpected layout shift during sweeps | 0 | 0 |
| Visible-region panel samples hidden by CSS | 0 / 225 | 0 / 225 |

An isolated 2.6-second grid trace produced 860 to 862 Paint events per baseline run and zero in each of three runs with the translated tile. At the midpoint of the cycle, a screenshot comparison over 1,296,000 pixels found no RGB channel difference greater than one 8-bit level. This confirms a reduction in paint work under the tested workload. Browser frame callbacks and DOM visibility checks cannot establish whether the originally reported intermittent compositor bands are resolved.

## Troubleshooting and recovery

If Projects or Settings report a scope error, check the caller's assignment, the origin configuration, and the D1 singleton identity. If a preference or card order conflicts, refresh before resubmitting. For a blocked Task, open its attempt and dependency receipts. For GitHub errors, check the latest observed credential state, rate-limit budget, source SHA, and recorded workflow attempt. A heartbeat is stronger evidence of worker availability than credential presence.

Before rehearsing a migration, take a consistent export in private custody. Record the source digest, migration journal, row counts, and stable Project, Task, and attempt identities. Rehearse replay, failure recovery, stale leases, and rollback against a separate database. An imported snapshot remains fenced. Use the [Phase 1B steps](../PHASE1B-SITES.md) for worker handoff and Site rollback. Production service, data, and worker ownership remain subject to separate authorization.

### What the recovery checks cover

Run `node --test --test-name-pattern "current application partitions" sites/staging.test.mjs` from the Observatory package. The test creates independently identified Aetherwake and Voyagewright fixture partitions, checkpoints each current schema with SQLite's backup API, advances the source settings, and restores the checkpoint into a separate file. It compares schema definitions and table contents, runs integrity and foreign-key checks, and reads back Project order, milestone links, the Task and attempt IDs, and the pre-checkpoint Settings. Serving a restored partition under the peer application must fail. The legacy import test separately checks the dispatch fence for copied in-flight leases.

Sites version rollback restores code only. The database inspection tools provide bounded views. A hosted recovery drill requires a consistent data export and any applicable file inventory from authorized custody, restoration into an isolated target, and verified record and file readback. Hosted backup, restore, and retention remain unverified. [Sites versions and saved data](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)
