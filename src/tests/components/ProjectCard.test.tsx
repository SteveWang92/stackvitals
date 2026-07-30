// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectCard } from '../../components/ProjectCard';
import { STALE_AFTER_HOURS } from '../../lib/status';
import type { ProjectStatus, UptimeDay } from '../../types';

afterEach(cleanup);

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function project(overrides: Partial<ProjectStatus> = {}): ProjectStatus {
  return {
    slug: 'todo_app',
    name: 'Todo App',
    publicUrl: 'https://todo.example.test',
    deployStatus: 'healthy',
    uptimeStatus: 'healthy',
    lastSync: hoursAgo(2),
    providers: [],
    resources: [],
    recentSnapshots: [],
    collectorErrors: [],
    history: {
      windowDays: 30,
      latency: [{ day: '2026-07-30', p50Ms: 184 }],
      uptime: [{ day: '2026-07-30', state: 'up', checks: 1, failed: 0 } satisfies UptimeDay],
    },
    ...overrides,
  };
}

describe('ProjectCard', () => {
  it('links to the public URL with the scheme stripped from the label', () => {
    render(<ProjectCard project={project()} selected={false} onSelect={vi.fn()} />);

    const link = screen.getByRole('link', { name: /todo\.example\.test/ });

    expect(link.getAttribute('href')).toBe('https://todo.example.test');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('says so when no public URL was recorded', () => {
    render(<ProjectCard project={project({ publicUrl: '' })} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('No public URL recorded.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('does not link out to itself when the project is this very dashboard', () => {
    render(<ProjectCard project={project({ publicUrl: `${window.location.origin}/` })} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('This site')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('warns once data is older than the staleness threshold', () => {
    render(<ProjectCard project={project({ lastSync: hoursAgo(STALE_AFTER_HOURS + 2) })} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText(`Data is older than ${STALE_AFTER_HOURS} hours`)).toBeTruthy();
  });

  it('distinguishes a project that has never synced from a stale one', () => {
    render(<ProjectCard project={project({ lastSync: null })} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('Waiting for first collector sync')).toBeTruthy();
  });

  it('shows no staleness banner while data is recent', () => {
    render(<ProjectCard project={project()} selected={false} onSelect={vi.fn()} />);

    expect(screen.queryByText(/Data is older than/)).toBeNull();
  });

  it('reports its selected state on the detail button', () => {
    const onSelect = vi.fn();

    render(<ProjectCard project={project()} selected onSelect={onSelect} />);

    const button = screen.getByRole('button', { name: 'View detail' });

    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('labels the history charts with the actual window length', () => {
    render(<ProjectCard project={project()} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText('Latency & uptime (30d)')).toBeTruthy();
  });
});
