# Phase 2 review and qualification

The work in [draft PR #2](https://github.com/Kgray44/Engineering-Command-Core/pull/2) builds on the pinned base in [draft PR #1](https://github.com/Kgray44/Engineering-Command-Core/pull/1). The public screenshots in the [README](README.md) come from the local browser fixture.

## Candidate staging

| Origin | Observation |
|---|---|
| [Aetherwake staging](https://ecc-aetherwake-stage.kgamazing44.chatgpt.site/#projects) | Ready on `5aef360f3a2969bed5d717b3e8de97c7c5bd7bf6`. The signed-in browser showed the existing Project in the new card grid. |
| [Voyagewright staging](https://ecc-voyagewright-stage.kgamazing44.chatgpt.site/#projects) | Ready on the same canonical source. The signed-in browser showed its own Project and the token-derived theme. Connections reported a successful database read. |
| [Production Aetherwake Observatory](https://aetherwake-engineering-observatory.kgamazing44.chatgpt.site/#tasks) | Task Control Center loaded after both staging deployments and showed build `8bd0e4553b`. |

The Voyagewright site-side mirror and Aetherwake canonical Site mirror matched the Command Core Git tree after excluding their Site manifests. The Voyagewright deployment completed first, then the canonical Aetherwake staging deployment. Both migrations applied. An isolated Voyagewright browser session saved compact density, reloaded and read it back, then restored the default.

## Verification and open acceptance

- The local canonical Worker build passed. Local runs passed 131 Sites tests, 69 Observatory tests, and 12 journal tests on the follow-up. Chrome passed the five main browser workflows and the separate regression for clearing approval when the reviewed source changes.
- Browser fixture coverage includes Project creation, icon and accent selection, milestone creation and template suggestions, a linked Task, keyboard cancellation, pointer and keyboard reorder with reload, and mobile Settings and Merge discovery. PR inspection in the fixture reached the existing protected engine with the exact selected head.
- Hosted Voyagewright PR #899 returned an unavailable GitHub read credential while the feed was rate-limited. Independent repository-scoped credentials for both staging applications remain necessary to qualify actual PR detail and required-check data.
- The follow-up adds in-Project execution controls, milestone ordering, an interactive prerequisite view, and version-fenced Task moves. The Task Workspace remains the route for full specification editing and evidence inspection. Settings exposes supported preferences and observations. Deployment policies remain managed by their original source owners.
- The scroll test exercised mounted history and verified the settled blur behavior. The previously reported horizontal bands still need a reproducible hosted case and performance evidence.
- Production Phase 1B migration, protected integration acceptance, and owner acceptance are open. This staging work retained the live Observatory, database, connector, and worker assignments.
