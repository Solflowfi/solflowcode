// Creator-fee verification pipeline (server-side). PRODUCTION ARCHITECTURE.
//
// Flow (Phase: Creator Fee Verification):
//   Creator Fee Source
//     -> Alchemy getSignaturesForAddress      (candidate signatures)
//       -> duplicate detection                (fee-record store)
//         -> getTransaction (Alchemy, jsonParsed)
//           -> transaction verification       (success / slot / blockTime)
//             -> source verification          (configured source wallet)
//               -> destination verification   (SOL arrived at the configured vault)
//                 -> amount verification      (pre/post balance DELTA from RPC —
//                                             never frontend-provided amounts)
//                   -> fee record             (signature, slot, timestamp, source,
//                                              destination, amount, processingId, status)
//                     -> reward allocation    (demo engine while DEMO MODE; on-chain
//                                              fund_rewards once the program is live)
//
// Alchemy/RPC blockchain data is the SOURCE OF TRUTH. Webhook payloads and any
// frontend input are never accounting truth — they only trigger re-verification
// through this pipeline before any accounting effect.

import { getEnv } from '@/config/env';
import {
  serverGetSignatures,
  serverGetTransaction,
  serverGetAccount,
} from '@/lib/providers/alchemy';
import { createFeeRecord, getRecord, allRecords, type FeeVerificationStatus } from '@/lib/solana/fee-records';
import { validateFeeInflow, type DetectedFee } from './fees';

export interface PipelineTxCheck {
  signature: string;
  exists: boolean;
  success: boolean;
  slot: number | null;
  blockTime: number | null;
}

export interface PipelineResult {
  available: boolean;
  reason: string | null;
  checkedSignatures: number;
  verified: DetectedFee[];
  records: ReturnType<typeof allRecords>;
  checks: PipelineTxCheck[];
}

/**
 * Compute the SOL balance delta of a single account from RPC pre/post
 * balance arrays. Returns null when the account is not part of the tx.
 */
function solDeltaFor(
  accountKeys: string[],
  preBalances: number[],
  postBalances: number[],
  address: string
): bigint | null {
  const idx = accountKeys.indexOf(address);
  if (idx === -1 || idx >= preBalances.length || idx >= postBalances.length) return null;
  return BigInt(postBalances[idx] - preBalances[idx]);
}

function reject(
  signature: string,
  slot: number | null,
  timestamp: number,
  source: string,
  destination: string,
  amountLamports: bigint,
  status: FeeVerificationStatus,
  detail: string
): void {
  createFeeRecord({
    transactionSignature: signature,
    slot,
    timestamp,
    source,
    destination,
    amountLamports: amountLamports,
    status,
    detail,
  });
}

/**
 * Run the full verification pipeline for the configured creator fee source(s).
 * Returns available:false (never zeros / fake data) when:
 *   - no fee source is configured, or
 *   - the source account does not exist on-chain, or
 *   - Alchemy RPC fails.
 */
export async function runFeePipeline(maxPerSource = 10): Promise<PipelineResult> {
  const env = getEnv();
  const checks: PipelineTxCheck[] = [];
  const verified: DetectedFee[] = [];
  if (env.feeSources.length === 0) {
    return { available: false, reason: 'No creator fee source configured.', checkedSignatures: 0, verified: [], records: [], checks: [] };
  }
  if (!env.rewardTreasury && !env.solRewardVault) {
    return { available: false, reason: 'No reward vault/treasury configured as fee destination.', checkedSignatures: 0, verified: [], records: [], checks: [] };
  }
  const destination = (env.rewardTreasury ?? env.solRewardVault) as string;

  for (const source of env.feeSources) {
    // 1. Source account must exist on-chain.
    const srcAcc = await serverGetAccount(source);
    if (!srcAcc || !srcAcc.exists) {
      checks.push({ signature: '(source ' + source.slice(0, 8) + ')', exists: false, success: false, slot: null, blockTime: null });
      continue;
    }

    // 2. Query transaction history through Alchemy.
    const sigs = await serverGetSignatures(source, maxPerSource);
    for (const s of sigs) {
      // Duplicate detection: already processed -> record rejection, skip.
      if (getRecord(s.signature)) {
        reject(s.signature, s.slot, 0, source, destination, 0n, 'rejected_duplicate', 'Duplicate processing attempt — fee already recorded.');
        continue;
      }
      if (s.err !== null && s.err !== undefined) {
        reject(s.signature, s.slot, 0, source, destination, 0n, 'rejected_failed_tx', 'Transaction failed on-chain.');
        checks.push({ signature: s.signature, exists: true, success: false, slot: s.slot, blockTime: null });
        continue;
      }

      // 3. Fetch and verify the full transaction via getTransaction.
      const tx = await serverGetTransaction(s.signature);
      if (!tx || !tx.meta) {
        reject(s.signature, s.slot, 0, source, destination, 0n, 'rejected_unparseable', 'Transaction could not be fetched/parsed via RPC.');
        checks.push({ signature: s.signature, exists: false, success: false, slot: s.slot, blockTime: null });
        continue;
      }
      const success = tx.err === null;
      checks.push({ signature: s.signature, exists: true, success, slot: tx.slot, blockTime: tx.blockTime });
      if (!success) {
        reject(s.signature, tx.slot, tx.blockTime ?? 0, source, destination, 0n, 'rejected_failed_tx', 'Transaction status is failed on-chain.');
        continue;
      }

      // 4. AMOUNT VERIFICATION — resolved from on-chain balance deltas only.
      const delta = solDeltaFor(tx.accountKeys, tx.meta.preBalances, tx.meta.postBalances, destination);
      if (delta === null || delta <= 0n) {
        reject(
          s.signature,
          tx.slot,
          tx.blockTime ?? 0,
          source,
          destination,
          0n,
          delta === null ? 'rejected_destination' : 'rejected_amount',
          delta === null
            ? 'Configured fee destination is not a participant of this transaction.'
            : 'No positive SOL inflow to the configured destination in this transaction.'
        );
        continue;
      }

      // 5. Classify: source whitelist + destination + amount rules.
      const fee = validateFeeInflow({
        signature: s.signature,
        timestamp: tx.blockTime ?? 0,
        slot: tx.slot,
        toAddress: destination,
        fromAddress: source,
        amountLamports: delta,
      });
      if (!fee) {
        reject(s.signature, tx.slot, tx.blockTime ?? 0, source, destination, delta, 'rejected_source', 'Source/destination/amount rules rejected this inflow.');
        continue;
      }

      // 6. Verified — persist the audit record, then account for it.
      createFeeRecord({
        transactionSignature: s.signature,
        slot: tx.slot,
        timestamp: tx.blockTime ?? 0,
        source,
        destination,
        amountLamports: delta,
        status: 'verified',
        detail: 'Verified from on-chain balance delta via Alchemy RPC.',
      });
      verified.push(fee);
    }
  }

  return {
    available: true,
    reason: null,
    checkedSignatures: checks.filter((c) => c.exists).length,
    verified,
    records: allRecords(),
    checks,
  };
}

/**
 * Apply verified creator fees to the reward engine.
 * DEMO ONLY while NEXT_PUBLIC_DEMO_MODE=true: routes into the labeled demo
 * engine with demo:true on the event. In live mode this must be replaced by
 * an on-chain program instruction (fund_rewards) — never silent accounting.
 */
export async function processVerifiedFees(maxPerSource = 10): Promise<
  PipelineResult & { applied: number; demo: boolean; nvdaConfigured: boolean }
> {
  const env = getEnv();
  const result = await runFeePipeline(maxPerSource);
  let applied = 0;
  if (result.available && env.demoMode) {
    const { getDemoState } = await import('@/lib/data');
    const { distributeFees } = await import('@/lib/solana/rewards');
    const state = getDemoState();
    for (const fee of result.verified) {
      if (fee.amountLamports <= 0n) continue;
      distributeFees(state, fee.amountLamports);
      applied++;
    }
  }
  const { nvdaConfigured } = await import('@/lib/solana/rewards');
  return { ...result, applied, demo: env.demoMode, nvdaConfigured: nvdaConfigured() };
}
