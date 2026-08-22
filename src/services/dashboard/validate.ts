import type { StatusLevel } from '../../types';
import type { DashboardRows, ProjectRow } from './rows';

const validStatuses = new Set<StatusLevel>(['healthy', 'warning', 'failed', 'unknown']);

function validateRequiredText(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Dashboard data is invalid: ${fieldName} is missing.`);
  }

  return value;
}

export function validateProjectRows(projects: ProjectRow[]): void {
  for (const project of projects) {
    validateRequiredText(project.id, 'projects.id');
    validateRequiredText(project.name, 'projects.name');
    validateRequiredText(project.slug, 'projects.slug');
  }
}

export function validateStatusRows(rows: DashboardRows): void {
  const statusRows = [
    ...rows.metrics.map((row) => ({
      status: row.status,
      table: 'metric_snapshots',
    })),
    ...rows.healthChecks.map((row) => ({
      status: row.status,
      table: 'health_checks',
    })),
  ];

  for (const row of statusRows) {
    if (!validStatuses.has(row.status)) {
      throw new Error(`Dashboard data is invalid: ${row.table}.status "${String(row.status)}" is not supported.`);
    }
  }
}
