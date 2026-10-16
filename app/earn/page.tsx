'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { usePortfolio } from '@/hooks/usePortfolio';
import { StakePanel } from '@/components/dashboard/StakePanel';
import { UnstakePanel } from '@/components/dashboard/UnstakePanel';
import { formatTokenAmount, shortAddress } from '@/lib/format';

export default function EarnPage() {
  const { setVisible } = useWalletModal();
  const { connected, publicKey } = useWallet();
  const portfolio = usePortfolio();

  const stakedStr = portfolio.rewards && 'staked' in portfolio.rewards ? ((portfolio.rewards as { staked?: string }).staked ?? '0') : '0';
  const staked = Number(stakedStr);

  return (
    <div className="container-page py-10">
      <h1 className="display text-3xl mb-2">FLOW Staking</h1>
      <p className="text-sm text-[var(--muted)] mb-8">Stake $FLOW into the flow. SOL + NVDAx rewards accrue from verified creator-fee revenue (70/30 allocation).</p>

      {!connected || !publicKey ? (
        <div className="panel p-10 text-center">
          <p className="text-[var(--muted)] mb-6">Connect a wallet to stake and manage your position.</p>
          <button className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect Wallet
          </button>
        </div>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-6 mb-10">
            <StakePanel />
            <UnstakePanel staked={staked} />
          </div>
          <div className="panel p-6">
            <h3 className="display text-lg mb-4">Position</h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="label mb-1">Wallet</div>
                <div className="mono">{shortAddress(publicKey.toBase58(), 6)}</div>
              </div>
              <div>
                <div className="label mb-1">Staked FLOW</div>
                <div className="mono">{formatTokenAmount(staked, 4)} FLOW</div>
              </div>
              <div>
                <div className="label mb-1">Deposit Date</div>
                <div>{staked > 0 ? 'This session (demo ledger)' : '—'}</div>
              </div>
              <div>
                <div className="label mb-1">Claimable Rewards</div>
                <div className="mono text-[var(--green)]">
                  {formatTokenAmount((portfolio.rewards?.assets ?? []).reduce((s, a) => s + Number(a.claimable), 0), 4)}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
