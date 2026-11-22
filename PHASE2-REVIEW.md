# Phase 2 owner review

Phase 2 is ready for owner walkthrough on the private staging Sites. Hosted GitHub check qualification, hosted recovery, and the owner's acceptance decision remain open. The implementation is in [draft PR #2](https://github.com/Kgray44/Engineering-Command-Core/pull/2), stacked on [Phase 1 draft PR #1](https://github.com/Kgray44/Engineering-Command-Core/pull/1).

## Review the deployed candidate

Both staging origins reported ready on Command Core revision `ba684ff53fd76c213b9f08dd661098d784234a60`. Each Site mirror matched the tested source tree apart from its hosting manifest. The production Observatory Task Control Center loaded during the November 22 readback and reported build `8bd0e4553b`. [Deployed commit](https://github.com/Kgray44/Engineering-Command-Core/commit/ba684ff53fd76c213b9f08dd661098d784234a60) · [Production Task Control Center](https://aetherwake-engineering-observatory.kgamazing44.chatgpt.site/#tasks)

| Workspace | Aetherwake | Voyagewright |
|---|---|---|
| Project Library | [Projects](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#projects) | [Projects](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#projects) |
| Task Control Center | [Tasks](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#tasks) | [Tasks](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#tasks) |
| Merge source and linked work | [PR #356](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#merge?pr=356) | [PR #899](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#merge?pr=899) |
| Activity and attention | [Activity](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#activity) | [Activity](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#activity) |
| Settings categories | [Settings](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#settings) | [Settings](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#settings) |
| Connections and data | [Connections](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#settings/connections) · [Data](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#settings/data) | [Connections](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#settings/connections) · [Data](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#settings/data) |

The [README screenshots](README.md) use synthetic records from the browser fixtures. The links above open the owner-private staging workspaces.

## Acceptance evidence and limits

| Area | Verified | Remaining evidence |
|---|---|---|
| Project library and customization | Browser fixtures create a Project, pick its icon and accent, edit its name and description, and reload. Pointer, touch across rows, keyboard movement and cancellation, and persisted ordering pass. Hosted browser verified keyboard persistence and peer Project rejection. | Owner walkthrough of visual quality and interaction on their viewport. |
| Project workspace | Hosted readbacks covered dependencies, inline Task controls, artifacts, exact Task evidence navigation, acceptance, and milestone history. Latest readback showed one recorded attempt in Aetherwake and four in Voyagewright. Neither selected Project had a measured token receipt. Fixtures cover Task and milestone linking, eligible moves retaining identity, and a downloaded Task PDF. | Owner review of the end-to-end workspace and its evidence presentation. |
| Merge | Hosted source context resolved linked Task and Project records. The exact inspector read live GitHub through signed-in GitHub CLI GET transport. Aetherwake #356 passed two required checks and remained a draft. Voyagewright #901 had base drift and a failed check on the selected SHA. A stale head returned no check evidence. The existing engine verified landed revisions for Aetherwake #355 and Voyagewright #902. Browser fixtures verify the read-only preview, exact approval fencing, and protected integration history. [Failed Voyagewright job](https://github.com/Kgray44/treasurehuntSoT/actions/runs/44982000641/job/137085220306) | The hosted Sites need the two repository-scoped read bindings to qualify live PR detail, checks, and job links end to end. Protected live merge and repair acceptance remains subject to authorization. |
| Voyagewright and Aetherwake design | The 11 core Voyagewright colors match the current product token source. Authenticated browsers verified application isolation. Browser fixtures exercise both themes and mobile controls, including reduced motion and touch reorder. [Voyagewright product tokens](https://github.com/Kgray44/treasurehuntSoT/blob/main/src/styles/tokens.css) | Owner visual acceptance of both applications. |
| Settings, activity, and health | Hosted settings save, reload, and reset passed in an isolated namespace. API and browser fixtures cover validation, category confirmation, audit, default behavior, sensitive-field exclusion, and peer scope. Both hosted data checks found all 12 expected schema objects and passed scoped integrity. Activity uses recorded Task, Project, CI, and worker observations. | Hosted database and file backup or restore remains unverified. Hosted GitHub health remains limited by the read bindings. |
| Recovery | Current-schema SQLite drills restored both independent fixture partitions and proved Project order, milestone links, Task and attempt identities, and preference rollback. Restored copies rejected the peer application. | A consistent hosted export, authorized isolated restore, and record/file readback are still needed. A Sites version rollback restores code only. |
| Performance and responsiveness | The Windows Chrome scroll trace reduced median Paint events from 1,389 to 1,067. Further local traces measured Settings confirmation and a visible remote Task update. Neither measured interaction recorded unexpected layout shift or a long task after the layout correction. Fixtures also exercise navigation, touch, reduced motion, and responsive layout. [Trace method and results](docs/operations.md#scroll-rendering-measurement) | The intermittent blank bands still need a reproducible hosted case. The confirmation measurement covers the existing in-page interaction. |
| Shared engine and production safety | Hosted origin and partition readbacks and browser scope checks passed. The production Observatory stayed on its existing build. This candidate uses one engine for both applications. | Production migration and worker/connector handoff remain in Phase 1B and require separate owner approval. [Phase 1B runbook](PHASE1B-SITES.md) |

The deployed revision's CI passed 69 Observatory checks, 136 Sites checks, 12 journal checks, four Task and Merge browser workflows, and three Project and staging browser workflows. [Verification run for the deployed revision](https://github.com/Kgray44/Engineering-Command-Core/actions/runs/44988062875)

## Owner decision and external inputs

- Install `AETHERWAKE_GITHUB_READ_TOKEN` and `VOYAGEWRIGHT_GITHUB_READ_TOKEN` as independent repository-scoped secrets on the canonical [Aetherwake staging Site](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site). Then verify PR detail and exact-head checks from both signed-in origins. Keep credential values in Sites. [Binding runbook](PHASE1B-SITES.md)
- Obtain an authorized consistent hosted export and any applicable file inventory before rehearsing hosted recovery. Record the restore result and compare it with the source. [Recovery guide](docs/operations.md#troubleshooting-and-recovery)
- Record the owner decision on [draft PR #2](https://github.com/Kgray44/Engineering-Command-Core/pull/2) after reviewing the staged workflows and remaining evidence. Keep the production cutover decision in [Phase 1B](PHASE1B-SITES.md).

## Repository guides

[README and quick start](README.md) · [Architecture and isolation](docs/architecture.md) · [Deployment, workers, and ChatGPT](docs/deployment.md) · [Project and Task guide](docs/engineering-workspaces.md) · [GitHub and merge integration](docs/integration.md) · [Settings and diagnostics](docs/settings.md) · [Testing and recovery](docs/operations.md)
