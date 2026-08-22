// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusPill } from '../../components/StatusPill';
import { StaleBadge } from '../../components/StaleBadge';

afterEach(cleanup);

describe('StatusPill', () => {
  it('labels each status and carries its status class', () => {
    for (const [status, label] of [
      ['healthy', 'Healthy'],
      ['warning', 'Needs attention'],
      ['failed', 'Failed'],
      ['unknown', 'Unknown'],
    ] as const) {
      const { container } = render(<StatusPill status={status} />);

      expect(screen.getByText(label)).toBeTruthy();
      expect(container.querySelector(`.status-${status}`)).toBeTruthy();
      cleanup();
    }
  });
});

describe('StaleBadge', () => {
  it('renders nothing while data is fresh', () => {
    const { container } = render(<StaleBadge freshness="fresh" lastSync={new Date().toISOString()} />);

    expect(container.innerHTML).toBe('');
  });

  it('reports hours below two days and days beyond that', () => {
    const { container: hours } = render(
      <StaleBadge freshness="stale" lastSync={new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString()} />,
    );
    expect(hours.textContent).toContain('40h old');

    const { container: days } = render(
      <StaleBadge freshness="stale" lastSync={new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()} />,
    );
    expect(days.textContent).toContain('5d old');
  });

  it('says Never when a provider has never reported', () => {
    const { container } = render(<StaleBadge freshness="never" lastSync={null} />);

    expect(container.textContent).toContain('Never');
  });

  it('says Never rather than NaN for an unparseable timestamp', () => {
    const { container } = render(<StaleBadge freshness="stale" lastSync="not-a-date" />);

    expect(container.textContent).toContain('Never');
  });
});
