'use client';

import { useMemo } from 'react';

const NODES = [
  { label: 'CREATOR ACTIVITY', color: 'var(--purple)' },
  { label: 'CREATOR FEES', color: 'var(--cyan)' },
  { label: '70% CREATOR PAYOUT', color: 'var(--text)' },
  { label: '30% REWARD POOL (70/30 SOL·NVDAX)', color: 'var(--green)' },
];

export function FeeFlow() {
  const delays = useMemo(() => [0, 0.4, 0.8, 1.2], []);
  return (
    <div className="panel panel-glow p-6 sm:p-8 w-full">
      <div className="flex flex-col items-center gap-1">
        {NODES.map((n, i) => (
          <div key={n.label} className="flex flex-col items-center">
            <div
              className="px-4 py-2 rounded-xl border text-xs font-bold tracking-widest text-center"
              style={{ borderColor: n.color + '55', color: n.color, background: n.color + '0d' }}
            >
              {n.label}
            </div>
            <div className="relative h-8 w-px bg-[var(--border-strong)] overflow-visible">
              {[0, 1, 2].map((j) => (
                <span
                  key={j}
                  className="particle absolute left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full"
                  style={{
                    background: i >= 2 ? 'var(--green)' : 'var(--cyan)',
                    animationDelay: `${delays[j]}s`,
                    top: 0,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-4 mt-1">
          <div className="px-4 py-2 rounded-xl border text-xs font-bold tracking-widest" style={{ borderColor: 'rgba(20,241,149,0.4)', color: 'var(--green)', background: 'rgba(20,241,149,0.08)' }}>
            SOL
          </div>
          <div className="px-4 py-2 rounded-xl border text-xs font-bold tracking-widest" style={{ borderColor: 'rgba(153,69,255,0.45)', color: '#c4a5ff', background: 'rgba(153,69,255,0.1)' }}>
            NVDA
          </div>
        </div>
        <div className="label mt-2">STAKERS</div>
      </div>
    </div>
  );
}
