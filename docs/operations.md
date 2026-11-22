# Developer verification and operations

The Observatory package owns the React build, API tests, and browser workflows. Test the normal routes after changing a component. Fixture coverage uses local HTTP and SQLite with synthetic GitHub records. Hosted qualification checks service identity, partition wiring, provider observations, and deployed revision separately.

## Regression checks

- `npm test` covers inherited contracts, task workspace selectors, observability, and analytics.
- `npm run test:sites` covers authorization, Task Engine transitions, GitHub evidence, protected integration, storage isolation, and Phase 2 Project and settings persistence.
- `node --test ../../tests/agent-journal-export.test.mjs` covers journal exports.
- `npm run test:workspace:e2e` covers existing workspace interactions and SQLite-backed staging. Set `OBSERVATORY_ENGINE_E2E=1` for the full Task browser scenario.

See [deployment](deployment.md) for the shared Worker build. Use the staging browser test's optional `COMMAND_CORE_SCREENSHOT_DIR` only for a synthetic test run so captured artifacts contain no private records. The browser test verifies that Project history mounts before scrolling and remains reachable by keyboard, and that settled entrance animation releases its blur layer.

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

### Signed-in staging scroll probe

On November 22, 2026, a foreground Microsoft Edge session opened each owner-private Project Workspace on deployed revision `352660f`. The viewports were 2,040 × 1,102 CSS pixels for Aetherwake and 2,040 × 1,100 for Voyagewright at device pixel ratio 1.25. The browser reported the animated `grid-travel` tile and 22 px sidebar blur active on both. Four mouse-source DevTools scroll gestures per Site traversed the full page range down and up at 3,200 to 4,800 CSS pixels/s. The screencast sampled compositor output every second frame at up to 960 px wide.

| Application | Full scroll range | Captured frames | Distinct scroll offsets |
|---|---:|---:|---:|
| Aetherwake | 4,175 CSS px | 170 | 92 |
| Voyagewright | 5,999 CSS px | 158 | 87 |

Visual inspection of six sampled frames per application found no blank bands. History was still reachable and focused through the Voyagewright section control. The probe sampled a settled Project workspace in one browser configuration. Brief artifacts between samples, the owner's exact display and browser conditions, and other routes remain outside this observation. Screens from private staging were used for inspection only. If the symptom recurs, record the route, browser zoom, viewport, and scroll action for a targeted capture.

### Project Library navigation

During foreground Edge 157 navigation on Windows, the first Voyagewright Project Library load on staging revision `ba359a7` displaced the footer by 432 CSS pixels 643 ms after the click. The layout shift score was 0.0143. Layout Instability attributed the shift to the footer as the portfolio completed. The Project Library now reserves viewport height for the main column while the portfolio loads. A follow-up probe traced a separate 16-pixel movement to the loading paragraph margin collapsing through the workspace. The workspace now establishes its own formatting context to keep that margin inside it. A browser regression holds the Projects API response and compares both the workspace and footer positions before and after the cards render.

### Project card dragging

On Windows Chrome 157.0.8103.80, headless Playwright drove both themes through the shared local Command Core Worker on revision `346f6cb`. Each application used an isolated SQLite partition with eight synthetic Projects. The desktop viewport was 1,440 × 1,000 CSS pixels. Touch emulation used 390 × 1,100 CSS pixels. Motion was enabled. Each trial moved the first card into the next row using 26 paced input steps, waited for the insertion indicator, and required a successful reorder receipt and the same order after reload.

| Theme and input | Trials | Worst trial p95 frame callback interval | Largest frame callback gap |
|---|---:|---:|---:|
| Aetherwake pointer | 3 | 4.3 ms | 16.6 ms |
| Aetherwake touch | 3 | 4.3 ms | 4.4 ms |
| Voyagewright pointer | 3 | 4.3 ms | 12.6 ms |
| Voyagewright touch | 3 | 4.3 ms | 8.4 ms |

All 12 moves persisted. The frame window began after drag activation and ended at visible insertion feedback. It contained no unexpected layout shifts or browser long tasks. These frame callback timings cover the tested synthetic workload. Physical touch latency, display presentation, and larger Project libraries remain outside this measurement.

### Settings confirmation and live Task updates

On Windows Chrome 157.0.8103.80 at 1,440 × 900, three local SQLite-backed runs measured the in-page Settings reset confirmation and three measured a remote worker claim with the Project Tasks panel in view. The probe captured animation-frame intervals within 250 ms of the first rendered change, plus Layout Instability and long-task observations. Each run began with settled navigation and a fresh scoped fixture.

| Interaction | First visible change | Worst run p95 frame interval | Unexpected layout shift | Long tasks |
|---|---:|---:|---:|---:|
| Settings reset confirmation | 58–59 ms from probe start through the browser click | 17.0 ms | 0 across three runs | 0 |
| Remote Task claim after layout correction | 4.70–4.75 s from probe start through the worker request | 17.0 ms | 0 across three runs | 0 |

The inline confirmation's insertion was input-related, with a layout shift score of 0.0024. The original Task update displaced the execution control and activity text when the status chip widened. The Task row now reserves status space, and Current work uses fixed column proportions. The repeated claim produced one scoped Project read per run. Its observed latency includes the existing five-second Task registry polling interval.

## Troubleshooting and recovery

If Projects or Settings report a scope error, check the caller's assignment, the origin configuration, and the D1 singleton identity. If a preference or card order conflicts, refresh before resubmitting. For a blocked Task, open its attempt and dependency receipts. For GitHub errors, check the latest observed credential state, rate-limit budget, source SHA, and recorded workflow attempt. A heartbeat is stronger evidence of worker availability than credential presence.

Before rehearsing a migration, take a consistent export in private custody. Record the source digest, migration journal, row counts, and stable Project, Task, and attempt identities. Rehearse replay, failure recovery, stale leases, and rollback against a separate database. An imported snapshot remains fenced. Use the [Phase 1B steps](../PHASE1B-SITES.md) for worker handoff and Site rollback. Production service, data, and worker ownership remain subject to separate authorization.

If a workspace section cannot load after a release, use **Reload page** to reopen the same route with the current assets. The navigation remains available, and Command Core leaves reload to the user so they can decide when to leave an open form. The staging browser regression tests this with a missing lazy-loaded Project asset.

### What the recovery checks cover

Run `node --test --test-name-pattern "current application partitions" sites/staging.test.mjs` from the Observatory package. The test creates independently identified Aetherwake and Voyagewright fixture partitions, checkpoints each current schema with SQLite's backup API, advances the source settings, and restores the checkpoint into a separate file. It compares schema definitions and table contents, runs integrity and foreign-key checks, and reads back Project order, milestone links, the Task and attempt IDs, and the pre-checkpoint Settings. Serving a restored partition under the peer application must fail. The legacy import test separately checks the dispatch fence for copied in-flight leases.

Sites version rollback restores code only. The database inspection tools provide bounded views. A hosted recovery drill requires a consistent data export and any applicable file inventory from authorized custody, restoration into an isolated target, and verified record and file readback. Hosted backup, restore, and retention remain unverified. [Sites versions and saved data](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)
