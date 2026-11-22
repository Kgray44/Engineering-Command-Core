# Installation and deployment

Run the commands in the [quick start](../README.md). To build a shared Worker, set `COMMAND_CORE_APPLICATIONS` and run `npm run build:sites` in the Observatory package. The object accepts an optional `portfolio`, optional `legacyApplication`, and an `applications` array. Each entry requires a unique lowercase `id`, display `name`, scoped GitHub `repository`, HTTPS `origin`, and uppercase environment `binding` prefix. Check the CI workflow for a working two-origin example. Omit this configuration when building the inherited compatibility profile.

Apply the SQL migrations in Drizzle journal order and insert the singleton `application_partition` with the exact application, repository, and portfolio. Supply each prefix with its own D1 binding, verified owner, worker key, and permitted GitHub credential references. The platform must supply a verified request identity through `trustedIdentity`. A caller-controlled header cannot establish identity. A database bearing an import receipt is fenced until the migration procedure resolves activation.

## Worker operation

Each native worker is configured with a repository, application ID, connector namespace, and dedicated checkout root. Use the application's worker ingress URL and dedicated credentials. The worker needs the right Site service proof and its own executor key for claim, reporting, and liveness. Check the **Codex & Workers** category for observed heartbeats and slots. The [original guide](../agent-system/observatory/README.md) documents worker startup, evidence, and retry handling.

## ChatGPT and staging Sites

Use the owner-private staging MCP connection from the canonical Aetherwake staging Site. Start with the application list and pass its identifiers when calling Task and Project tools. Voyagewright staging forwards its authorized browser and worker requests to the canonical engine and exposes its own D1 over the private service bridge. Build both profiles from the same source revision and verify both origins after deployment. The [Phase 1B runbook](../PHASE1B-SITES.md) gives the deployment inputs, service bindings, custody, and rollback procedure.

### Verify the installed staging connector

Use the owner-private **Aetherwake Engineering Command Core — Staging** plugin from a connected client. Use **Settings → Connections → Verify connections** on the canonical Site as a separate check of the served build and its tool registry.

1. Call `list_applications` and confirm that it returns the expected Aetherwake and Voyagewright repository bindings.
2. For each returned `application_id`, call `projects_v1` with `request: { op: "list" }`, then use `request: { op: "get", id: "<project UUID>" }` with a returned Project ID.
3. Call `task_engine_v1` with the same application ID and `request: { op: "list" }`. Read a listed Task with `request: { op: "get", task_id: "<Task ID>" }`. Copy the Task ID from `task.id` in the list response. Task reads use `task_id`, while Project reads use `id`.
4. When the two scopes contain distinct records, repeat each detail read with the original record ID and the other value for `application_id`. Each cross-application read should return 404. These results verify external transport and record isolation without admitting Tasks or modifying Projects.

## Staging GitHub read credentials

Create separate [fine-grained GitHub personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token). Select only the corresponding repository for each token and set an expiration appropriate for the qualification window.

| Application | Selected repository | Secret on canonical Aetherwake staging |
| --- | --- | --- |
| Aetherwake | `Kgray44/Aetherwake` | `AETHERWAKE_GITHUB_READ_TOKEN` |
| Voyagewright | `Kgray44/treasurehuntSoT` | `VOYAGEWRIGHT_GITHUB_READ_TOKEN` |

Use only the following repository permissions, all read-only.

| Permission | Used for |
| --- | --- |
| Metadata (granted automatically) | [Active branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch) |
| Administration | [Legacy branch protection and required contexts](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection) |
| Contents | [Commit and branch comparisons](https://docs.github.com/en/rest/commits/commits#compare-two-commits) |
| Pull requests | [Open pull requests and review details](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request) |
| Checks and Commit statuses | [Check runs](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference) and [combined commit status](https://docs.github.com/en/rest/commits/statuses#get-the-combined-status-for-a-specific-reference) |
| Actions | [Workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository) and [jobs from the observed run attempt](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt) |
| Issues | [Repository issue feed](https://docs.github.com/en/rest/issues/issues#list-repository-issues) |

An authorization failure on the legacy branch protection read leaves required checks unverified. The read credentials grant no merge, rerun, or publication access.

Set the two values through **Settings → Secrets** on the canonical staging Site. Both applications use the GitHub reader there. Use the supported [Sites redeploy procedure](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites#update-secrets-and-environment-variables) and keep the Site private. Keep token values out of source, logs, and qualification receipts.

1. Sign in at each staging origin and open **Settings → GitHub**. Confirm the expected repository and that **Dedicated integration read credential** reads **Configured**. This row reports presence. Check the authentication result, main observation timestamp, and request budget separately.
2. In each **Merge Workspace**, use **Refresh GitHub source**, open a current pull request for that repository, and select **Preview required checks**. Compare the reported head and base to GitHub before interpreting results. When a failed check is backed by a workflow job, confirm its link opens the job from the observed run attempt. Verify the preview leaves the integration run list unchanged.
3. For an unconfigured credential, verify the secret name and the deployed environment revision on canonical staging. For authentication or permission failures, check expiry, selected repository, repository approval where applicable, and the documented read permissions. For rate limiting, use the reset time in **Settings → GitHub** before refreshing again. Record the last successful observation and leave checks unverified until a new read succeeds.
