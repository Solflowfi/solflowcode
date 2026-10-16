'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useStaking } from '@/hooks/useStaking';
import { formatTokenAmount, relativeTime } from '@/lib/format';
import { getRewardTokens } from '@/lib/solana/tokens';
import { TokenIcon } from '@/components/common/TokenIcon';

export function RewardCards() {
  const { setVisible } = useWalletModal();
  const { connected, publicKey } = useWallet();
  const { rewards, refresh } = usePortfolio();
  const { runOp, txState, setTxState, lastError, setLastError } = useStaking();
  const [notice, setNotice] = useState<string | null>(null);
  const tokens = getRewardTokens().filter((t) => t.enabled);

  const busy = txState === 'building' || txState === 'signing' || txState === 'confirming';

  async function claim(asset?: string) {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    setNotice(null);
    setTxState('building');
    const res = await runOp(asset ? 'claim' : 'claimAll', null, asset);
    if (res.ok) {
      setNotice('Claim confirmed (demo ledger updated).');
      await refresh();
    } else if (res.error) {
      setLastError(res.error);
    }
  }

  const hasAny = (rewards?.assets ?? []).some((a) => Number(a.claimable) > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="display text-2xl mb-0">Your Rewards</h2>
        <button className="btn btn-primary btn-sm" disabled={busy || !hasAny || !connected} onClick={() => void claim()}>
          {busy ? 'PROCESSING…' : 'CLAIM ALL'}
        </button>
      </div>
      {lastError ? <p className="text-xs text-[var(--red)] mb-3">{lastError}</p> : null}
      {notice ? <p className="text-xs text-[var(--green)] mb-3">{notice}</p> : null}
      <div className="grid md:grid-cols-2 gap-4">
        {tokens.map((t) => {
          const a = rewards?.assets.find((x) => x.symbol === t.symbol);
          const claimable = a?.claimable ?? '0';
          return (
            <div key={t.symbol} className={`panel panel-hover p-6 ${t.symbol === 'SOL' ? 'panel-glow' : ''}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <TokenIcon symbol={t.symbol} size={36} />
                  <div>
                    <div className="font-bold">{t.symbol} REWARD</div>
                    <div className="label">{t.name}</div>
                  </div>
                </div>
                <span className="badge">{(((a?.allocationBps ?? 0) / 100)).toFixed(0)}% OF POOL</span>
              </div>
              <div className="display text-3xl mb-1" style={{ color: t.symbol === 'SOL' ? 'var(--green)' : '#c4a5ff' }}>
                {formatTokenAmount(claimable, 4)}
              </div>
              <div className="label mb-4">CLAIMABLE {t.symbol}</div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <div className="label mb-1">Lifetime Earned</div>
                  <div className="mono">{formatTokenAmount(a?.lifetimeEarned ?? '0', 4)}</div>
                </div>
                <div>
                  <div className="label mb-1">Lifetime Claimed</div>
                  <div className="mono">{formatTokenAmount(a?.lifetimeClaimed ?? '0', 4)}</div>
                </div>
              </div>
              <div className="text-xs text-[var(--muted)] mb-4">Last claim: {relativeTime(a?.lastClaimAt ?? null)}</div>
              {t.symbol === 'NVDAx' && Number(claimable) <= 0 ? (
                <div className="text-xs text-[var(--muted)] mb-4">NVDAx rewards currently unfunded — the reward vault has no NVDAx yet.</div>
              ) : null}
              <button
                className={`btn w-full ${t.symbol === 'SOL' ? 'btn-primary' : 'btn-secondary'}`}
                disabled={busy || Number(claimable) <= 0}
                onClick={() => void claim(t.symbol)}
              >
                {busy ? 'PROCESSING…' : `CLAIM ${t.symbol}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
