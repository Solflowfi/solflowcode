'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { usePortfolio } from '@/hooks/usePortfolio';
import { StakePanel } from '@/components/dashboard/StakePanel';
import { UnstakePanel } from '@/components/dashboard/UnstakePanel';
import { RewardCards } from '@/components/dashboard/RewardCards';
import { Metric } from '@/components/common/Metric';
import { Unavailable } from '@/components/common/Unavailable';
import { formatTokenAmount, shortAddress } from '@/lib/format';

export default function AppPage() {
  const { setVisible } = useWalletModal();
  const { connected, publicKey } = useWallet();
  const portfolio = usePortfolio();

  if (!connected || !publicKey) {
    return (
      <div className="container-page py-24 text-center">
        <h1 className="display text-4xl mb-4">
          Connect your wallet to <span className="text-gradient">enter the flow</span>
        </h1>
        <p className="text-[var(--muted)] mb-8">SOLFLOW positions, rewards and claims require a connected Solana wallet (Phantom, Solflare, Backpack).</p>
        <button className="btn btn-primary" onClick={() => setVisible(true)}>
          Connect Wallet
        </button>
      </div>
    );
  }

  const stakedStr = portfolio.rewards && 'staked' in portfolio.rewards ? (portfolio.rewards as { staked?: string }).staked ?? '0' : '0';
  const staked = Number(stakedStr);
  const solEarned = portfolio.rewards?.assets.find((a) => a.symbol === 'SOL') ?? null;
  const nvdaEarned = portfolio.rewards?.assets.find((a) => a.symbol === 'NVDAx') ?? null;
  const totalRewards = (portfolio.rewards?.assets ?? []).reduce((s, a) => s + Number(a.lifetimeEarned), 0);

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between mb-8 gap-4">
        <div>
          <h1 className="display text-3xl mb-1">Dashboard</h1>
          <p className="text-sm text-[var(--muted)] mb-0 mono">{shortAddress(publicKey.toBase58(), 6)}</p>
        </div>
        <div className="flex gap-3">
          <Metric loading={portfolio.loading} label="FLOW Balance" value={portfolio.flowBalance === null ? '—' : formatTokenAmount(portfolio.flowBalance, 4)} />
          <Metric loading={portfolio.loading} label="Staked FLOW" value={formatTokenAmount(staked, 4)} accent="green" />
        </div>
      </div>

      {portfolio.error ? <Unavailable message={portfolio.error} /> : null}

      <div className="grid lg:grid-cols-2 gap-6 mb-10">
        <StakePanel />
        <UnstakePanel staked={staked} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Metric loading={portfolio.loading} label="Staked FLOW" value={formatTokenAmount(staked, 4)} sub="your position (FLOW)" />
        <Metric loading={portfolio.loading} label="SOL Earned" value={formatTokenAmount(solEarned?.lifetimeEarned ?? '0', 4)} sub="SOL rewards" accent="green" />
        <Metric loading={portfolio.loading} label="NVDAx Earned" value={formatTokenAmount(nvdaEarned?.lifetimeEarned ?? '0', 4)} sub="NVDAx rewards" accent="purple" />
        <Metric loading={portfolio.loading} label="Total Rewards" value={formatTokenAmount(totalRewards, 4)} sub="all reward assets (UI units)" accent="purple" />
      </div>

      <RewardCards />
    </div>
  );
}
