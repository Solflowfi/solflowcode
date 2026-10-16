'use client';

// Operator-only MAINNET READINESS checklist (rendered inside the admin view
// after operator authorization). Every state comes from /api/readiness which
// verifies real configuration + on-chain state server-side. Live Staking is
// LOCKED until every required gate passes.
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

interface ReadinessItem {
  key: string;
  label: string;
  state: 'OK' | 'FAIL' | 'WAITING';
  detail: string;
}

interface ReadinessResponse {
  authorized: boolean;
  error?: string;
  network?: string;
  demoMode?: boolean;
  items?: ReadinessItem[];
}

const STATE_BADGE: Record<string, string> = {
  OK: 'badge-green',
  FAIL: 'badge-red',
  WAITING: 'badge-amber',
};
const STATE_ICON: Record<string, string> = { OK: '\u2713', FAIL: '\u2717', WAITING: '\u23F3' };

export function MainnetReadiness() {
  const { publicKey } = useWallet();
  const [items, setItems] = useState<ReadinessItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) return;
    try {
      const res = await fetch(`/api/readiness?wallet=${publicKey.toBase58()}`, { cache: 'no-store' });
      const j = (await res.json()) as ReadinessResponse;
      if (!j.authorized) throw new Error(j.error ?? 'Not authorized.');
      setItems(j.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Readiness check failed.');
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const liveStaking = items?.find((i) => i.key === 'live_staking');
  const liveLocked = liveStaking?.state !== 'OK';

  return (
    <div className="panel p-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="display text-xl mb-0">SOLFLOW Mainnet Readiness</h2>
          <div className="label">Pre-launch checklist — every state is verified, nothing is faked</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => void load()}>
          RE-CHECK
        </button>
      </div>

      {error ? <p className="text-sm text-[var(--red)] mb-3">{error}</p> : null}

      <div className="grid sm:grid-cols-2 gap-2">
        {(items ?? []).map((i) => (
          <div key={i.key} className="p-3 rounded-xl bg-white/[0.03] border border-[var(--border)]">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-semibold">{i.label}</span>
              <span className={`badge ${STATE_BADGE[i.state] ?? 'badge'}`}>
                {i.state === 'OK' ? '\u2713' : i.state === 'WAITING' ? 'WAITING' : '\u2717'}
              </span>
            </div>
            <p className="text-xs text-[var(--muted)] mb-0">{i.detail}</p>
          </div>
        ))}
        {items === null && !error ? <div className="skeleton h-5 w-full" /> : null}
      </div>

      {liveStaking ? (
        <div className={`mt-4 p-4 rounded-xl border ${liveLocked ? 'border-[rgba(255,180,84,0.4)] bg-[rgba(255,180,84,0.05)]' : 'border-[rgba(20,241,149,0.4)] bg-[rgba(20,241,149,0.05)]'}`}>
          <div className="font-bold mb-1">
            {liveLocked ? 'LIVE STAKING: LOCKED \u23F3' : 'LIVE STAKING: READY \u2713'}
          </div>
          <p className="text-xs text-[var(--muted)] mb-0">{liveStaking.detail}</p>
        </div>
      ) : null}
    </div>
  );
}
