# Installation and deployment

Run the commands in the [quick start](../README.md). To build a shared Worker, set `COMMAND_CORE_APPLICATIONS` and run `npm run build:sites` in the Observatory package. The object accepts an optional `portfolio`, optional `legacyApplication`, and an `applications` array. Each entry requires a unique lowercase `id`, display `name`, scoped GitHub `repository`, HTTPS `origin`, and uppercase environment `binding` prefix. Check the CI workflow for a working two-origin example. Omit this configuration when building the inherited compatibility profile.

Apply the SQL migrations in Drizzle journal order and insert the singleton `application_partition` with the exact application, repository, and portfolio. Supply each prefix with its own D1 binding, verified owner, worker key, and permitted GitHub credential references. The platform must supply a verified request identity through `trustedIdentity`. A caller-controlled header cannot establish identity. A database bearing an import receipt is fenced until the migration procedure resolves activation.

## Worker operation

Each native worker is configured with a repository, application ID, connector namespace, and dedicated checkout root. Use the application's worker ingress URL and dedicated credentials. The worker needs the right Site service proof and its own executor key for claim, reporting, and liveness. Check the **Codex & Workers** category for observed heartbeats and slots. The [original guide](../agent-system/observatory/README.md) documents worker startup, evidence, and retry handling.

## ChatGPT and staging Sites

Use the owner-private staging MCP connection from the canonical Aetherwake staging Site. Start with the application list and pass its identifiers when calling Task and Project tools. Voyagewright staging forwards its authorized browser and worker requests to the canonical engine and exposes its own D1 over the private service bridge. Build both profiles from the same source revision and verify both origins after deployment. The [Phase 1B runbook](../PHASE1B-SITES.md) gives the deployment inputs, service bindings, custody, and rollback procedure.
