---
title: Adapters
description: Full reference for every supported collector adapter — what it collects, required credentials, and minimum permissions.
---

Adapters are credential-gated, so a fresh clone with nothing but a project config still runs the
HTTP-health adapter alone. AWS credentials enable Cost Explorer by default; disable it with the
config switch below when those credentials do not include cost access.

## Adapter reference

| Adapter | Collects | Credentials | Minimum permissions |
|---|---|---|---|
| HTTP health | Public URL up/down, response time | None (just the project's public URL) | — |
| Amplify | Deploy status, branch, latest build | AWS access key/secret, region | Read-only Amplify access |
| AWS Cost Explorer | Account-level month-to-date / last-month cost per AWS service | AWS access key/secret, region | Read-only Cost Explorer access |
| AWS app backend | Cognito pool availability/user estimate and DynamoDB table status/count/size | AWS access key/secret, resource IDs, optional region | `cognito-idp:DescribeUserPool` and `dynamodb:DescribeTable` on configured resources |
| Supabase project health | Reachability of the hub's own project or a watched app's | Supabase project URL + service-role key | Project-scoped service-role key |
| Watched-app Supabase aggregate | Count-only aggregate stats from a custom RPC | App's Supabase URL, anon key, service-role key, RPC name | Service-role key (count-only RPC — never raw reads) |
| Resend | Sending-domain verification status | Resend API key | Read-only API key |
| OpenAI usage | Token totals, request counts, cached tokens, spend by key/model | OpenAI admin API key | Admin key (required by usage endpoints) |
| GitHub Actions | Workflow run counts, latest status, trigger type, branch, duration | Repo `owner/repo` mapping + read token | Actions: read |
| Cloudflare domains | Zone status, DNS record counts, apex/www/MX, registrar expiry | Cloudflare API token, optional account ID | Read-only token scoped to zones/DNS |

## Adapter details

### HTTP health

Probes your project's public URL. No credentials needed — just set `publicUrl` in the project
config. Optionally override with `resources.healthCheckUrl` when the public URL is behind
Cloudflare Bot Fight Mode.

Custom headers (`HTTP_HEALTH_CHECK_HEADER_NAME` / `HTTP_HEALTH_CHECK_HEADER_VALUE`) can be sent
to work around Super Bot Fight Mode (Pro plan) via a WAF Skip rule. Free-plan Bot Fight Mode
cannot be bypassed this way — use a non-Cloudflare URL for the health check instead.

### Amplify

Reads deploy status from AWS Amplify. Requires an IAM user or role with read-only access to
Amplify. Config fields: `resources.amplifyAppId`, `resources.amplifyBranchName`, region via
`AWS_REGION`.

### AWS Cost Explorer

Collects account-level month-to-date and last-month costs broken down by AWS service. Costs stay
account-level (`project_id` null) — the dashboard does not guess per-project splits.

It is enabled by default when AWS credentials are present. Set
`"aws": { "costExplorerEnabled": false }` when those credentials intentionally omit Cost Explorer
access.

### AWS app backend

Reads aggregate metadata for apps whose auth and data use Cognito and DynamoDB. Configure
`resources.cognitoUserPoolId`, `resources.dynamoDbTables`, and optionally
`resources.awsBackendRegion`. The adapter uses only `DescribeUserPool` and `DescribeTable`; it
never lists users or reads table items.

### Supabase project health

Checks reachability of a Supabase project. For the hub's own project, set `"hubSupabase": true`
in config. For a watched app, provide its project URL and service-role key.

### Watched-app Supabase aggregate

Calls a count-only aggregate RPC that you define in the watched app's own Supabase project.
See `docs/examples/app-aggregate-rpc.sql` in the repo for an example RPC. The collector never
reads raw tables — only the RPC's aggregate output.

### Resend

Checks sending-domain verification status.

Aggregate delivery counts are **not** collected, and are not planned. Resend has no analytics or
statistics endpoint: `GET /emails` returns raw per-message rows — recipient addresses and subjects —
with no date or tag filter, so counting deliveries would mean paging the account's entire send
history and reading exactly the data this tool promises never to touch. The only aggregate path
Resend documents is streaming webhook events into a database you run yourself, which requires an
always-on receiver. Both conflict with the project's non-goals.

### OpenAI usage

Collects token totals, request counts, cached-token counts, and spend by API key and model.
Requires an admin API key. Optional `apiKeyLabels` in config provide display names for key IDs.

### GitHub Actions

Collects workflow run counts, latest status/conclusion, trigger type, branch, and duration
totals. Uses the built-in `GITHUB_TOKEN` for the collector's own repo; private cross-repo
collection needs a PAT with Actions read access. Runtime minutes are derived from run durations,
not GitHub billing endpoints.

### Cloudflare domains

Collects zone status, DNS record counts, apex/www/MX presence, proxied record counts, registrar
name, and expiration days. Domain groups may omit `projectSlug` to stay account-level. Account ID
enables registrar expiration lookup when available.
