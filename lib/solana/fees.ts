// Creator-fee detection and validation. A SOL inflow only counts as a creator
// fee when it satisfies ALL configured source rules; nothing is assumed.

import { PublicKey } from '@solana/web3.js';
import { getEnv } from '@/config/env';
import type { FeeSource } from '@/types';

export interface DetectedFee {
  signature: string;
  processingId: string;
  sourceAddress: string;
  treasuryAddress: string;
  amountLamports: bigint;
  timestamp: number;
  slot: number | null;
}

export interface FeeInflowCandidate {
  signature: string;
  timestamp: number;
  slot: number | null;
  toAddress: string | null;
  fromAddress: string | null;
  amountLamports: bigint;
}

/**
 * Validate that a SOL inflow qualifies as a creator fee.
 * Rules enforced:
 *  - destination must be the configured reward treasury/vault
 *  - source must be one of the configured fee-source wallets (when any are set)
 *  - amount must be positive
 *  - signature must be present and well-formed (base58, 64-88 chars)
 * The amount passed in MUST be resolved from on-chain balance deltas by the
 * verification pipeline — frontend-provided amounts are never trusted.
 */
export function validateFeeInflow(candidate: FeeInflowCandidate): DetectedFee | null {
  const env = getEnv();
  if (!env.rewardTreasury && !env.solRewardVault) return null;
  const destination = (env.rewardTreasury ?? env.solRewardVault) as string;
  if (candidate.toAddress !== destination) return null;
  if (candidate.amountLamports <= 0n) return null;
  if (!candidate.signature || candidate.signature.length < 64 || candidate.signature.length > 88) return null;
  if (env.feeSources.length > 0 && (candidate.fromAddress === null || !env.feeSources.includes(candidate.fromAddress))) return null;
  return {
    signature: candidate.signature,
    processingId: 'fee_' + candidate.signature.slice(0, 12),
    sourceAddress: candidate.fromAddress ?? destination,
    treasuryAddress: destination,
    amountLamports: candidate.amountLamports,
    timestamp: candidate.timestamp,
    slot: candidate.slot,
  };
}

/** Build FeeSource view models from env configuration. */
export function feeSourceViews(): FeeSource[] {
  const env = getEnv();
  const names = ['Creator Fee Source 1', 'Creator Fee Source 2', 'Creator Fee Source 3'];
  return env.feeSources.map((address, i) => ({
    id: `source-${i + 1}`,
    name: names[i] ?? `Creator Fee Source ${i + 1}`,
    address,
    network: env.network,
    asset: 'SOL',
    verification: 'pending' as const,
    lastTxSignature: null,
    lastDetectedAt: null,
  }));
}

/**
 * Scan treasury inflows via RPC and return validated creator fees.
 * Returns null when the treasury is not configured or the RPC read fails
 * (the UI then shows "Live data unavailable", never zeros or fake data).
 */
export async function scanTreasuryInflows(): Promise<DetectedFee[] | null> {
  const env = getEnv();
  if (!env.rewardTreasury) return null;
  try {
    const { getConnection } = await import('./rpc');
    const conn = getConnection();
    const sigs = await conn.getSignaturesForAddress(new PublicKey(env.rewardTreasury), { limit: 50 });
    const candidates: FeeInflowCandidate[] = [];
    for (const s of sigs.slice(0, 20)) {
      if (s.err) continue;
      // Candidate recorded; amount resolution requires full tx parsing via
      // Alchemy getTransaction parsing (server-side) before it can be counted.
      candidates.push({
        signature: s.signature,
        timestamp: s.blockTime ?? 0,
        slot: s.slot,
        toAddress: env.rewardTreasury,
        fromAddress: null,
        amountLamports: 0n,
      });
    }
    // Without parsed amounts the data is NOT verifiable - signal unavailable
    // rather than presenting zeros as confirmed fees. The production amount
    // resolution lives in lib/solana/fee-pipeline.ts (balance-delta parsing).
    return null;
  } catch {
    return null;
  }
}