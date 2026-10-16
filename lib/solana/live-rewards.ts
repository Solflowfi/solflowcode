// LIVE on-chain reward engine (read path).
//
// Separated from the demo engine: this module reads deployed program accounts
// via server-side RPC and NEVER falls back to demo numbers. Until
// NEXT_PUBLIC_PROGRAM_ID is configured and deployed, every read returns null
// and the UI shows "Live data unavailable".
//
// Accounting model (integer/base-unit only, mirroring the program):
//   rewardPerShare  += newRewards * 1e12 / totalEligibleShares
//   pending          = shares * (rewardPerShare - userRewardDebt) / 1e12
// All values in raw base units (lamports / token smallest units).

import { getEnv } from '@/config/env';
import { serverGetAccount, serverRpc } from '@/lib/providers/alchemy';

export interface LiveRewardAssetState {
  symbol: string;
  mint: string;
  vault: string;
  allocationBps: number;
  rewardPerShare: string; // scaled by 1e12, raw units
  totalFunded: string; // raw base units
  totalDistributed: string;
  totalClaimed: string;
  vaultBalance: string; // raw base units
  enabled: boolean;
}

export interface LiveRewardState {
  available: false;
  reason: string;
}

export interface LiveRewardData {
  available: true;
  programId: string;
  totalShares: string; // raw staking base units
  assets: LiveRewardAssetState[];
}

/**
 * Read live reward state from the deployed program.
 * Returns { available: false, reason } when the program is not configured or
 * cannot be read - never zeros, never demo data.
 */
export async function readLiveRewardState(): Promise<LiveRewardData | LiveRewardState> {
  const env = getEnv();
  if (env.demoMode) {
    return { available: false, reason: 'Demo mode active - live engine not queried.' };
  }
  if (!env.programId) {
    return { available: false, reason: 'Program not deployed (NEXT_PUBLIC_PROGRAM_ID empty).' };
  }
  const acc = await serverGetAccount(env.programId);
  if (!acc || !acc.exists) {
    return { available: false, reason: 'Configured program ID has no on-chain account.' };
  }

  // Program-specific account layout decoding lands with the deployed IDL.
  // Until then the read path reports unavailable rather than guessing.
  try {
    await serverRpc('getAccountInfo', [env.programId, { encoding: 'base64' }]);
  } catch (e) {
    return { available: false, reason: e instanceof Error ? e.message : 'RPC read failed.' };
  }

  return {
    available: false,
    reason: 'Program account decoding not yet wired (IDL pending). Live data unavailable.',
  };
}

/**
 * Compute pending rewards for a user position against a live asset ledger.
 * Integer math only. Exported for the future live claim path.
 */
export function computePending(
  shares: bigint,
  rewardPerShare: bigint,
  userRewardDebt: bigint
): bigint {
  if (shares <= 0n || rewardPerShare <= userRewardDebt) return 0n;
  return (shares * (rewardPerShare - userRewardDebt)) / 1_000_000_000_000n;
}
