'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SecurityItem, SecurityReport } from '@/types';

const BADGE_CLASS: Record<string, string> = {
  'DEPLOYED': 'badge-green',
  'NOT DEPLOYED': 'badge-amber',
  'VERIFIED': 'badge-green',
  'UNVERIFIED': 'badge-amber',
  'AUDITED': 'badge-green',
  'NOT AUDITED': 'badge-red',
  'PINNED': 'badge-green',
  'DRIFT': 'badge-amber',
  'PDA': 'badge-green',
  'NOT LAUNCHED': 'badge-amber',
  'CONFIGURED': 'badge-green',
  'AWAITING VERIFICATION': 'badge-amber',
  'UNCONFIGURED': 'badge-amber',
  'OPERATOR HELD': 'badge',
  'MULTISIG / EXTERNAL': 'badge',
  'IMMUTABLE': 'badge-green',
  'SERVER-GATED': 'badge-green',
  'GATE UNCONFIGURED': 'badge-amber',
  'ACTIVE': 'badge-green',
  'NOT AVAILABLE': 'badge-amber',
  'NONE HELD': 'badge-green',
};

function shortAddr(a: string): string {
  return a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a;
}

export default function SecurityPage() {
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/security', { cache: 'no-store' });
      const j = (await res.json()) as SecurityReport & { error?: string };
      if (!j || !j.items) throw new Error(j.error ?? 'Security report unavailable');
      setReport(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Security report unavailable');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items: SecurityItem[] = report?.items ?? [];
  const checkedTime = report ? new Date(report.checkedAt * 1000).toLocaleString() : null;

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="display text-3xl mb-2">Security</h1>
          <p className="text-sm text-[var(--muted)] mb-0">
            Every badge below is derived from real configuration and on-chain mainnet state — never hardcoded,
            never inferred from local builds. SOLFLOW displays a status only when it is true.
          </p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'CHECKING…' : 'RE-CHECK'}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-8 text-xs text-[var(--muted)]">
        <span className="badge">MODE: {(report?.mode ?? '…').toUpperCase()}</span>
        <span className="badge">NETWORK: {(report?.network ?? '…').toUpperCase()}</span>
        <span className="badge">
          DEPLOYMENT CHECK: {report ? (report.checkedOn === 'mainnet' ? 'MAINNET RPC' : 'UNAVAILABLE') : '…'}
        </span>
        {checkedTime ? <span className="badge">CHECKED: {checkedTime}</span> : null}
      </div>

      {error ? (
        <div className="panel p-5 mb-6 border-[rgba(255,180,84,0.35)]">
          <p className="text-sm text-[var(--amber)] mb-0">{error}</p>
        </div>
      ) : null}

      <div className="panel divide-y divide-[var(--border)]">
        {(loading && items.length === 0
          ? Array.from({ length: 8 }, (_, i) => i)
          : items.map((i) => i.key)
        ).map((k) => {
          const item = items.find((i) => i.key === k);
          return (
            <div key={k} className="flex flex-wrap items-start justify-between gap-3 p-5">
              <div className="max-w-xl">
                <div className="font-semibold mb-1">{item ? item.label : '…'}</div>
                <div className="text-sm text-[var(--muted)]">{item ? item.detail : 'Checking real state…'}</div>
                {item?.address ? (
                  <div className="text-xs mono mt-2 text-[var(--muted)]">
                    {shortAddr(item.address)}{' '}
                    {item.link ? (
                      <a className="text-[var(--green)] no-underline" href={item.link} target="_blank" rel="noreferrer">
                        Solscan ↗
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <span className={`badge ${item ? BADGE_CLASS[item.badge] ?? 'badge' : 'badge'}`}>
                {item ? item.badge : '…'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="panel p-5 mt-8 border-[rgba(255,180,84,0.3)]">
        <p className="text-sm text-[var(--amber)] mb-0">
          The SOLFLOW Anchor program has NOT been audited and is NOT deployed to mainnet. Do not route real funds
          through it without an independent security review. All demo data on this site is clearly labeled and
          simulated.
        </p>
      </div>
    </div>
  );
}
