---
title: Overview
description: What StackVitals is and what it does.
---

StackVitals is a lightweight, self-hosted operations dashboard for a solo developer's web
projects. It surfaces uptime, deploy health, provider status, domain health, month-to-date cloud
cost, and AI/CI usage — without copying raw application data out of the apps it watches.

## Two moving parts

1. **Collectors** — Node scripts that call external provider APIs (AWS, Supabase, OpenAI, GitHub,
   Cloudflare, Resend) and write append-only snapshots to your Supabase database. They run on a
   schedule from GitHub Actions, never in the browser.
2. **Dashboard** — A static React/Vite frontend that reads pre-aggregated rows from Supabase and
   renders them across tabbed views.

Both live in the same repo. There are no always-on servers.

## What it tracks

Every adapter is opt-in — it activates only when its credentials are present. Turn on exactly the
ones you use:

| Adapter | Collects |
|---|---|
| HTTP health | Public URL up/down, response time |
| Amplify | Deploy status, branch, latest build |
| AWS Cost Explorer | Account-level month-to-date / last-month cost per AWS service |
| Supabase project health | Reachability of the hub's own project or a watched app's |
| Watched-app Supabase aggregate | Count-only aggregate stats from a custom RPC |
| Resend | Sending-domain verification status |
| OpenAI usage | Token totals, request counts, cached tokens, spend by key/model |
| GitHub Actions | Workflow run counts, latest status, trigger type, duration |
| Cloudflare domains | Zone status, DNS record counts, registrar expiry |

See the full [adapter reference](/reference/adapters/) for credentials and permissions.

## Single-owner by design

This isn't multi-tenant. It's built to be one dashboard for one person's projects. Access is gated
twice: the frontend checks the signed-in email against an allowlist, and Supabase RLS
independently restricts reads to authenticated emails in `dashboard_users`.

## Data safety

Only aggregate operational signals are collected — status, counts, durations, costs. Raw user
data, request payloads, message bodies, and table dumps from watched apps never enter this tool.
Each watched app's credentials are used only to call count-only RPCs in that app's own project.

## Next steps

Ready to set up your own instance? Follow the [self-hosting guide](/getting-started/self-hosting/).
