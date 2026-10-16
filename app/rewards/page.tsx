'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { RewardCards } from '@/components/dashboard/RewardCards';
import { Unavailable } from '@/components/common/Unavailable';
import { usePortfolio } from '@/hooks/usePortfolio';
import { getEnv } from '@/config/env';

export default function RewardsPage() {
  const { setVisible } = useWalletModal();
  const { connected, publicKey } = useWallet();
  const portfolio = usePortfolio();
  const env = getEnv();

  return (
    <div className="container-page py-10">
      <h1 className="display text-3xl mb-2">Rewards</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Multi-asset rewards funded by verified creator-fee revenue. Claims execute against the reward engine; every claim is confirmed on-chain before balances update.
      </p>

      {!connected || !publicKey ? (
        <div className="panel p-10 text-center">
          <p className="text-[var(--muted)] mb-6">Connect a wallet to view claimable SOL and NVDA.</p>
          <button className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect Wallet
          </button>
        </div>
      ) : portfolio.error ? (
        <Unavailable message={portfolio.error} />
      ) : (
        <>
          {env.nvdaMint === null ? (
            <div className="panel p-4 mb-6 border-[rgba(255,180,84,0.35)]">
              <p className="text-sm text-[var(--amber)] mb-0">
                NVDA token unavailable — NEXT_PUBLIC_NVDA_MINT is not configured. The NVDA reward card will appear once the operator configures the real mint address.
              </p>
            </div>
          ) : null}
          <RewardCards />
        </>
      )}
    </div>
  );
}
