'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { TxRow } from '@/types';
import { Unavailable } from '@/components/common/Unavailable';
import { formatTime, shortSig, solscanTx } from '@/lib/format';

const KIND_BADGE: Record<string, string> = {
  STAKE: 'badge-green',
  UNSTAKE: 'badge',
  CLAIM: 'badge-purple',
  REWARD: 'badge-purple',
  FEE: 'badge-amber',
};

export default function ActivityPage() {
  const { publicKey } = useWallet();
  const [rows, setRows] = useState<TxRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = publicKey ? `?wallet=${publicKey.toBase58()}` : '';
      const res = await fetch(`/api/transactions${q}`, { cache: 'no-store' });
      const json = (await res.json()) as { rows: TxRow[]; error?: string | null };
      setRows(json.rows ?? []);
      setError(json.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Live data unavailable');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="container-page py-10">
      <h1 className="display text-3xl mb-2">Activity</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Protocol and personal transaction history. Every entry links to its on-chain transaction — SOLFLOW never fabricates transaction rows.
      </p>

      {error ? <Unavailable message={error} /> : null}

      <div className="panel overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Asset</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Transaction</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>
                  <div className="skeleton h-5 w-full" />
                </td>
              </tr>
            ) : null}
            {!loading && (rows ?? []).length === 0 && !error ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)]">
                  No transactions yet. Stake into the flow to begin.
                </td>
              </tr>
            ) : null}
            {!loading &&
              (rows ?? []).map((r, i) => (
                <tr key={`${r.signature ?? 'local'}-${i}`}>
                  <td>{formatTime(r.timestamp)}</td>
                  <td>
                    <span className={`badge ${KIND_BADGE[r.kind] ?? 'badge'}`}>{r.kind}</span>
                  </td>
                  <td>{r.asset}</td>
                  <td className={`mono ${r.amount !== null && r.amount < 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>
                    {r.amount === null ? '—' : `${r.amount >= 0 ? '+' : ''}${r.amount.toFixed(4)}`}
                  </td>
                  <td>
                    <span className={`badge ${r.status === 'confirmed' ? 'badge-green' : r.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>
                      {r.status.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    {r.signature ? (
                      <a className="text-[var(--green)] no-underline" href={solscanTx(r.signature)} target="_blank" rel="noreferrer">
                        {shortSig(r.signature)} ↗
                      </a>
                    ) : (
                      <span className="text-[var(--muted)]">demo ledger</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
