'use client';

import { useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useStaking } from '@/hooks/useStaking';
import { formatTokenAmount } from '@/lib/format';

/** Unstake $FLOW panel — pending rewards are synced, then FLOW is returned. */
export function UnstakePanel({ staked }: { staked: number | null }) {
  const { refresh } = usePortfolio();
  const { runOp, txState, setTxState, lastError, setLastError } = useStaking();
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const amtNum = Number(amount) || 0;
  const available = staked ?? 0;
  const exceeds = amtNum > available + 1e-9;
  const busy = txState === 'building' || txState === 'signing' || txState === 'confirming';

  async function handleUnstake() {
    setNotice(null);
    setTxState('building');
    if (amtNum <= 0) {
      setLastError('Enter an amount greater than zero.');
      setTxState('failed');
      return;
    }
    const res = await runOp('unstake', amtNum);
    if (res.ok) {
      setNotice('Unstake confirmed (demo ledger updated).');
      setAmount('');
      await refresh();
    } else if (res.error) {
      setLastError(res.error);
    }
  }

  return (
    <div className="panel p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="display text-xl mb-0">Unstake $FLOW</h3>
        <span className="badge">NO LOCKUP</span>
      </div>

      <label className="label block mb-2">Amount</label>
      <div className="flex items-center gap-3 input !py-2">
        <input
          className="flex-1 bg-transparent border-0 outline-none text-lg mono"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <span className="label">FLOW</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-[var(--muted)]">
        <span>Staked FLOW: {formatTokenAmount(available, 4)} FLOW</span>
        <span>Pending rewards stay claimable</span>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-3">
        {[25, 50, 75, 100].map((p) => (
          <button key={p} className="btn btn-secondary btn-sm" onClick={() => setAmount(((available * p) / 100).toFixed(4))}>
            {p === 100 ? 'MAX' : `${p}%`}
          </button>
        ))}
      </div>

      {exceeds ? <p className="text-xs text-[var(--red)] mt-3 mb-0">Amount exceeds staked position.</p> : null}
      {lastError ? <p className="text-xs text-[var(--red)] mt-3 mb-0">{lastError}</p> : null}
      {notice ? <p className="text-xs text-[var(--green)] mt-3 mb-0">{notice}</p> : null}

      <button className="btn btn-secondary w-full mt-4" disabled={busy || available <= 0 || (amtNum > 0 && exceeds)} onClick={() => void handleUnstake()}>
        {busy ? <span className="spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" /> : null}
        {available <= 0 ? 'NOTHING STAKED' : busy ? 'PROCESSING…' : 'UNSTAKE $FLOW'}
      </button>
    </div>
  );
}
