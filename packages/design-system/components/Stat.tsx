import React from 'react';

export interface StatProps {
  label: string;
  value: string;
  /** e.g. "+12% vs last month". Direction colours it (down = Ignition Red). */
  delta?: { text: string; direction: 'up' | 'down' };
}

/**
 * KPI / metric tile for dashboards and reports. A `down` delta colours in
 * Ignition Red.
 * @category Feedback
 */
export function Stat({ label, value, delta }: StatProps) {
  return (
    <div className="dl-stat">
      <span className="dl-stat__label">{label}</span>
      <span className="dl-stat__value">{value}</span>
      {delta && (
        <span className={`dl-stat__delta dl-stat__delta--${delta.direction}`}>
          {delta.direction === 'up' ? '▲' : '▼'} {delta.text}
        </span>
      )}
    </div>
  );
}
