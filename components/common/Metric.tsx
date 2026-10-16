'use client';

import type { ReactNode } from 'react';

interface MetricProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'green' | 'purple' | 'cyan' | 'default';
  loading?: boolean;
}

const ACCENTS: Record<string, string> = {
  green: 'var(--green)',
  purple: '#c4a5ff',
  cyan: 'var(--cyan)',
  default: 'var(--text)',
};

export function Metric({ label, value, sub, accent = 'default', loading }: MetricProps) {
  if (loading) {
    return (
      <div className="panel p-5">
        <div className="label mb-3">{label}</div>
        <div className="skeleton h-7 w-24" />
      </div>
    );
  }
  return (
    <div className="panel panel-hover p-5">
      <div className="label mb-2">{label}</div>
      <div className="display text-2xl" style={{ color: ACCENTS[accent] }}>
        {value}
      </div>
      {sub ? <div className="text-xs text-[var(--muted)] mt-1">{sub}</div> : null}
    </div>
  );
}
