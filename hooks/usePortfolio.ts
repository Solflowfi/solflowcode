'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { UserRewards } from '@/types';
import { getMode } from '@/lib/mode';

export interface PortfolioState {
  wallet: string | null;
  /** Native SOL balance of the wallet (informational — SOL is a reward token, not staked). */
  solBalance: number | null;
  /** Simulated/demo FLOW wallet balance (staking token). */
  flowBalance: number | null;
  /** Staked position, denominated in $FLOW. */
  staked: number | null;
  rewards: UserRewards | null;
  loading: boolean;
  error: string | null;
}

interface RewardsWithStake extends UserRewards {
  staked?: string;
  flowBalance?: string;
}

export function usePortfolio(): PortfolioState & { refresh: () => Promise<void> } {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [state, setState] = useState<PortfolioState>({
    wallet: null,
    solBalance: null,
    flowBalance: null,
    staked: null,
    rewards: null,
    loading: false,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!publicKey || !connected) {
      setState({ wallet: null, solBalance: null, flowBalance: null, staked: null, rewards: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    // Balance is NON-FATAL: the browser wallet-adapter RPC (public mainnet
    // endpoint) often answers browser JSON-RPC with HTTP 403 (provider abuse
    // protection). A balance failure must NEVER block the portfolio data and
    // is never replaced by demo/simulated values — it falls back to the
    // server-side keyed RPC, then to an honest null (unavailable).
    let solBalance: number | null = null;
    try {
      const bal = await connection.getBalance(publicKey);
      solBalance = bal / LAMPORTS_PER_SOL;
    } catch {
      try {
        const res = await fetch(`/api/wallet-balance?wallet=${publicKey.toBase58()}`, { cache: 'no-store' });
        const j = (await res.json()) as { ok: boolean; balanceLamports?: number };
        if (j.ok && typeof j.balanceLamports === 'number') {
          solBalance = j.balanceLamports / LAMPORTS_PER_SOL;
        }
      } catch {
        solBalance = null; // unavailable — never substituted with a fake value
      }
    }
    let rewards: RewardsWithStake | null = null;
    let rewardsError: string | null = null;
    try {
      const res = await fetch(`/api/rewards?wallet=${publicKey.toBase58()}`, { cache: 'no-store' });
      if (getMode() === 'demo') {
        if (res.ok) rewards = (await res.json()) as RewardsWithStake;
      } else {
        if (!res.ok) throw new Error('Live data unavailable');
        rewards = (await res.json()) as RewardsWithStake;
      }
    } catch (e) {
      rewardsError = e instanceof Error ? e.message : 'Live data unavailable';
    }
    setState({
      wallet: publicKey.toBase58(),
      solBalance,
      flowBalance: rewards?.flowBalance !== undefined ? Number(rewards.flowBalance) : null,
      staked: rewards?.staked !== undefined ? Number(rewards.staked) : null,
      rewards,
      loading: false,
      error: rewardsError,
    });
  }, [connection, publicKey, connected]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
