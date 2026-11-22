# Phase 2 review and qualification

The work in [draft PR #2](https://github.com/Kgray44/Engineering-Command-Core/pull/2) builds on the pinned base in [draft PR #1](https://github.com/Kgray44/Engineering-Command-Core/pull/1). The public screenshots in the [README](README.md) come from the local browser fixture.

## Candidate staging

| Origin | Observation |
|---|---|
| [Aetherwake staging](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#projects) | Hosted Settings and data checks passed on `accd4c2710c36246eccea77fc10ca5912c6a0125`. |
| [Voyagewright staging](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#projects) | Hosted Settings and data checks passed on the same source. Signed-in checks also covered its own Project and the token-derived theme. |
| [Production Aetherwake Observatory](https://aetherwake-engineering-observatory.kgamazing44.chatgpt.site/#tasks) | Task Control Center loaded during earlier staging qualification and showed production build `8bd0e4553b`. |

Each Project library returned its own record and rejected the peer Project ID. The Voyagewright browser opened the interactive dependency view and inline Task controls, then navigated to the mounted History section. The production Observatory Task list loaded after that deployment.

The Voyagewright site-side mirror and Aetherwake canonical Site mirror matched the Command Core Git tree after excluding their Site manifests. The Voyagewright deployment completed first, then the canonical Aetherwake staging deployment. Both migrations applied. An isolated Voyagewright browser session saved compact density, reloaded and read it back, then restored the default.

## Verification and open acceptance

- [CI for the Settings and diagnostics candidate](https://github.com/Kgray44/Engineering-Command-Core/actions/runs/44984516040) passed the shared Worker build, regression tests, and Linux Chromium workflows. The hosted owner-scoped database checks found all 12 expected schema objects, with zero findings across four Project integrity counters on each staging partition. Backup and hosted restore are unverified.
- Browser fixture coverage includes Project creation, icon and accent selection, milestone creation and template suggestions, a linked Task, keyboard cancellation, pointer and keyboard reorder with reload, and mobile Settings and Merge discovery. PR inspection in the fixture reached the existing protected engine with the exact selected head.
- Hosted source context resolved Project and Task associations for Aetherwake PR #356 and Voyagewright PR #899. Independent repository-scoped credentials for both staging applications remain necessary to qualify live PR detail and required-check data.
- The follow-up adds in-Project execution controls, milestone ordering, an interactive prerequisite view, and version-fenced Task moves. The Task Workspace remains the route for full specification editing and evidence inspection. Settings exposes supported preferences and observations. Deployment policies remain managed by their original source owners.
- The scroll test exercised mounted History and verified the settled blur behavior. In a controlled Windows Chrome trace, the translated scan grid reduced median page Paint events from 1,389 to 1,067 while preserving the effect. The intermittent horizontal bands still need a reproducible hosted case. See the [measurement method and results](docs/operations.md#scroll-rendering-measurement).
- Production Phase 1B migration, protected integration acceptance, and owner acceptance are open. This staging work retained the live Observatory, database, connector, and worker assignments.
