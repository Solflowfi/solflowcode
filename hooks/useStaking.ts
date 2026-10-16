'use client';

import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { getMode } from '@/lib/mode';

export type StakingTxState = 'idle' | 'building' | 'signing' | 'confirming' | 'confirmed' | 'failed';

export interface StakingOpResult {
  ok: boolean;
  signature?: string | null;
  error?: string;
}

/**
 * Staking / claiming mutations.
 *
 * Stake and unstake amounts are denominated in $FLOW (the staking token).
 * SOL and NVDAx are reward assets only — they appear solely as `asset`
 * symbols on claim operations.
 *
 * DEMO MODE: applies operations to the demo engine via /api/rewards (labeled).
 * LIVE MODE: requires a deployed program (NEXT_PUBLIC_PROGRAM_ID). Until one
 * is configured, operations return a clear error instead of simulating.
 */
export function useStaking() {
  const { publicKey, connected } = useWallet();
  const [txState, setTxState] = useState<StakingTxState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  const runOp = useCallback(
    async (op: 'stake' | 'unstake' | 'claim' | 'claimAll', amountFlow: number | null, asset?: string): Promise<StakingOpResult> => {
      setLastError(null);
      if (!connected || !publicKey) {
        const msg = 'Wallet not connected.';
        setLastError(msg);
        return { ok: false, error: msg };
      }
      const programConfigured = Boolean(process.env.NEXT_PUBLIC_PROGRAM_ID) || getMode() === 'staging';
      if (getMode() !== 'demo' && !programConfigured) {
        const msg = 'Live staking requires a deployed SOLFLOW program. Program is not configured.';
        setLastError(msg);
        return { ok: false, error: msg };
      }
      setTxState('building');
      try {
        const res = await fetch('/api/rewards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Stake/unstake amounts are denominated in $FLOW (staking token).
          body: JSON.stringify({ op, wallet: publicKey.toBase58(), amount: amountFlow, asset }),
        });
        const json = (await res.json()) as { ok: boolean; signature?: string | null; error?: string; demo?: boolean };
        if (!res.ok || !json.ok) {
          setTxState('failed');
          const msg = json.error ?? 'Transaction failed';
          setLastError(msg);
          return { ok: false, error: msg };
        }
        setTxState('confirmed');
        return { ok: true, signature: json.signature ?? null };
      } catch (e) {
        setTxState('failed');
        const msg = e instanceof Error ? e.message : 'Transaction failed';
        setLastError(msg);
        return { ok: false, error: msg };
      }
    },
    [connected, publicKey]
  );

  return { runOp, txState, setTxState, lastError, setLastError };
}
