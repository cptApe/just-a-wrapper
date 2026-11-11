# Anthropic owns the schedule for cron tasks

- **Status:** Accepted
- **Date:** June 2026

## Context

Scheduled tasks need something to fire them on time, exactly once. The usual design is a local table plus a cron job that scans for due rows.

## Decision

Each cron-scheduled task maps to one Managed Agents scheduled deployment, and Anthropic fires it. Pause, resume, cancel and run-now use the deployment's own endpoints. Event-triggered tasks keep their Composio webhook path.

See [02-foundation.md §12.5](../spec/02-foundation.md#125-scheduled-task).

## Why

A first-party scheduler removes the scan-and-fire job and the locks that prevent double fires. A deployment carries the vault IDs, resources and metadata, and each session it creates inherits them. A scheduled run therefore gets the member's integrations the same way a chat does.

## Consequences

- Run completion arrives by webhook and the payload carries no trigger context. The handler reads the session and maps `metadata.task_id` back to the task.
- Without a webhook secret, the recovery sweep finds runs and results arrive later.
- Deployments snapshot config, so reconciliation rebuilds a deployment when the agent, skills or instructions change.
- Do not add a local scanner next to deployments. Two schedulers can fire one task twice.
