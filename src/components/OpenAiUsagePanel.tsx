import { Bot } from 'lucide-react';
import { formatCount } from '../lib/format';
import { formatCurrencyUsd } from '../lib/status';
import { trendSummary } from '../lib/trend';
import type { OpenAiUsageSummary } from '../types';
import { EmptyState } from './EmptyState';
import { TrendChart } from './TrendChart';

export function OpenAiUsagePanel({ usage }: { usage: OpenAiUsageSummary }) {
  return (
    <section className="openai-panel" aria-label="OpenAI usage">
      <div className="section-heading">
        <Bot aria-hidden="true" size={18} />
        <h2>OpenAI Usage</h2>
      </div>

      <div className="openai-summary">
        <div>
          <span>Total tokens</span>
          <strong>{formatCount(usage.totalTokens)}</strong>
        </div>
        <div>
          <span>Cached input</span>
          <strong>{formatCount(usage.cachedInputTokens)}</strong>
        </div>
        <div>
          <span>Requests</span>
          <strong>{formatCount(usage.requests)}</strong>
        </div>
        <div>
          <span>Spend</span>
          <strong>{formatCurrencyUsd(usage.spendUsd)}</strong>
        </div>
        <div>
          <span>Last month usage</span>
          <strong>{usage.lastMonthTokens === null ? 'Unknown' : formatCount(usage.lastMonthTokens)}</strong>
        </div>
        <div>
          <span>Last month cost</span>
          <strong>{formatCurrencyUsd(usage.lastMonthSpendUsd)}</strong>
        </div>
      </div>

      {/* Each point is the total the collector reported that day for its lookback window, not that
          day's own usage, so the line tracks whether consumption is climbing rather than daily
          spend. The cost chart is a true per-day figure; these two are not. */}
      <TrendChart
        title="Total tokens by collection day"
        points={usage.tokenSeries}
        label="Total tokens reported on each collection day"
        formatValue={formatCount}
        valueLabel={trendSummary(usage.tokenSeries, formatCount)}
      />

      {usage.rows.length === 0 ? (
        <div className="panel-empty">
          <EmptyState
            message="No OpenAI usage rows are available. Configure the admin key and run the status collector."
            title="No OpenAI usage"
          />
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>API key</th>
              <th>Model</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cached</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {usage.rows.map((row) => (
              <tr key={`${row.apiKeyLabel}-${row.model}`}>
                <td>{row.apiKeyLabel}</td>
                <td>{row.model}</td>
                <td>{formatCount(row.inputTokens)}</td>
                <td>{formatCount(row.outputTokens)}</td>
                <td>{formatCount(row.cachedInputTokens)}</td>
                <td>{formatCount(row.requests)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
