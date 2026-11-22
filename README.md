# Engineering Command Core

Engineering Command Core is the canonical source for the shared engineering platform. Phase 1 extracts the Aetherwake Observatory, adds an application-scoped Projects workspace, and preserves the existing Task and Merge Workspaces. The owner-private Aetherwake Observatory serves production during this review.

## Checkout and verify

Run Node.js 22 or newer from `agent-system/observatory`.

```sh
npm ci
npm test
npm run test:sites
node --test ../../tests/agent-journal-export.test.mjs
npm run build:sites
npx playwright install chromium
npm run test:workspace:e2e
```

Set `OBSERVATORY_ENGINE_E2E=1` for the full original browser execution fixture. For an installed Chromium-compatible browser, set `OBSERVATORY_BROWSER_EXECUTABLE` to its executable path.

- The [Phase 1 evidence and cutover plan](PHASE1.md) records verification, parity and remaining gates.
- The [Observatory guide](agent-system/observatory/README.md) documents inherited Task, Merge and telemetry contracts.
- The shared HTTP and MCP composition root is [command-core.mjs](agent-system/observatory/sites/command-core.mjs). The local HTTP staging test exercises the same Worker with file-backed SQLite. The published Sites deployment remains outside the migration candidate.

## Build and configure the shared Worker

Set `COMMAND_CORE_APPLICATIONS` to a JSON object with an optional `portfolio`, optional `legacyApplication` and an `applications` array. The published CI workflow contains a synthetic two-origin example. Each application declares `id`, display `name`, a pinned GitHub `repository`, browser `origin` and environment binding prefix. One canonical Worker build can serve several configured origins. An application frontend can use its origin and existing same-origin API routes. The Voyagewright UI in Phase 1 is a test surface.

On a qualified Worker host, give each prefix its own D1 binding, owner identity and worker key. For example, `AETHERWAKE_DB`, `AETHERWAKE_OBSERVATORY_TASK_ENGINE_OWNER_ID` and `AETHERWAKE_OBSERVATORY_TASK_WORKER_KEY` belong to one application. Add app-prefixed GitHub credentials only for the operations the host is authorized to perform. The sibling runtime rejects shared storage or reused credentials. Bootstrapping each new database requires applying the Drizzle journal and explicitly inserting the singleton `application_partition` record for that application, repository and portfolio. Imported snapshots include a receipt that prevents service activation.

The Sites-facing build expects the host to supply a verified visitor identity. Other hosts must adapt the verified identity into `createCommandCore({ trustedIdentity })` and reject client-supplied identity headers. Run the legacy worker profile without `COMMAND_CORE_APPLICATIONS` for original contract fixtures or a pinned Aetherwake-only compatibility build.

A scoped native worker configuration uses `repository`, `application_id` and `connector_namespace` together, with dedicated checkout roots and per-application credentials. Omit those fields for the existing legacy Aetherwake connector. The native source-repair adapter is Aetherwake-specific. Voyagewright verification integration belongs to its existing Sounding Line authority.

After an approved cutover, common fixes land in this repository. Keep Aetherwake's pinned original source as the recovery fallback until the owner authorizes retirement. Apply any essential pre-cutover production fixes in Aetherwake and port the exact reviewed source delta to Command Core.
