// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionPanel } from '../../components/AttentionPanel';
import type { AttentionItem } from '../../lib/attention';

afterEach(cleanup);

function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    projectSlug: 'todo_app',
    projectName: 'Todo App',
    provider: 'http',
    label: 'Public URL',
    status: 'failed',
    detail: '503 in 120 ms',
    lastSync: new Date().toISOString(),
    freshness: 'fresh',
    ...overrides,
  };
}

describe('AttentionPanel', () => {
  it('renders nothing when there is neither a problem nor a silent provider', () => {
    const { container } = render(<AttentionPanel items={[]} staleCount={0} onSelect={vi.fn()} />);

    // Plain DOM assertions throughout: jest-dom's matchers would need a setup file, and the
    // repo deliberately runs Vitest with no config.
    expect(container.innerHTML).toBe('');
  });

  it('still appears when the only issue is that providers went quiet', () => {
    render(<AttentionPanel items={[]} staleCount={2} onSelect={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Needs attention' })).toBeTruthy();
    expect(screen.getByText(/2 providers have not reported recently/)).toBeTruthy();
  });

  it('uses the singular for a single silent provider', () => {
    render(<AttentionPanel items={[]} staleCount={1} onSelect={vi.fn()} />);

    expect(screen.getByText(/1 provider has not reported recently/)).toBeTruthy();
  });

  it('names the project, provider, and detail for each item', () => {
    render(<AttentionPanel items={[item()]} staleCount={0} onSelect={vi.fn()} />);

    expect(screen.getByText('Todo App - Public URL')).toBeTruthy();
    expect(screen.getByText('503 in 120 ms')).toBeTruthy();
  });

  it('opens the owning project when a row is clicked', () => {
    const onSelect = vi.fn();

    render(<AttentionPanel items={[item({ projectSlug: 'recipe_box' })]} staleCount={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith('recipe_box');
  });

  it('shows a staleness badge only for a provider that has gone quiet', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    render(
      <AttentionPanel
        items={[item({ freshness: 'fresh' }), item({ label: 'Amplify', freshness: 'stale', lastSync: threeDaysAgo })]}
        staleCount={0}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/\dd old/)).toHaveLength(1);
  });

  it('omits the stale footnote when nothing is silent', () => {
    render(<AttentionPanel items={[item()]} staleCount={0} onSelect={vi.fn()} />);

    expect(screen.queryByText(/not reported recently/)).toBeNull();
  });
});
