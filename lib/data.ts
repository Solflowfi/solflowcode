// Data layer used by /api routes.
//
// DEMO MODE: state lives in a process-level EngineState and is clearly
// labeled demo. LIVE MODE: reads must come from on-chain data; when a read
// fails the API returns { available: false } and the UI shows
// "Live data unavailable" — never zeros or fabricated numbers.

import type {
  AdminStats,
  AnalyticsPoint,
  AnalyticsSeries,
  FeeEngineStats,
  ProtocolResponse,
  ProtocolStats,
  RewardEpochView,
  TxRow,
} from '@/types';
import { getMode } from '@/lib/mode';
import { feeSourceViews } from '@/lib/solana/fees';
import {
  createEngineState,
  currentEpoch,
  engineTotals,
  type EngineState,
} from '@/lib/solana/rewards';

// Process-level demo engine (reset on server restart, labeled demo in UI).
let demoState: EngineState | null = null;

export function getDemoState(): EngineState {
  if (!demoState) demoState = createEngineState();
  return demoState;
}

export function getProtocolData(): ProtocolResponse {
  const mode = getMode();
  if (mode === 'demo') {
    const state = getDemoState();
    const totals = engineTotals(state);
    const epoch = currentEpoch(state);
    const stats: ProtocolStats = {
      tvl: totals.tvlFlow,
      creatorFees: totals.creatorFees,
      creatorPayout: totals.creatorPayout,
      rewardPool: totals.rewardPool,
      solDistributed: totals.solRewards,
      nvdaDistributed: totals.nvdaRewards,
      nvdaPendingConversion: totals.nvdaPendingConversion,
      activeStakers: totals.activeStakers,
      currentEpoch: epoch ? epoch.id : null,
    };
    const feeEngine: FeeEngineStats = {
      feesReceived: totals.creatorFees,
      creatorPayout: totals.creatorPayout,
      rewardPool: totals.rewardPool,
      solAllocation: totals.solRewards,
      nvdaAllocation: totals.nvdaRewards,
      nvdaPendingConversion: totals.nvdaPendingConversion,
      distributed: totals.solRewards,
      pendingDistribution: totals.nvdaPendingConversion,
    };
    return {
      mode,
      stats,
      feeEngine,
      sources: feeSourceViews(),
      epochs: epochViews(state),
    };
  }

  // LIVE MODE: reads come from the deployed program / RPC. Not wired yet,
  // so report unavailability honestly instead of zeros.
  return {
    mode,
    stats: null,
    feeEngine: null,
    sources: feeSourceViews(),
    epochs: [],
    error: 'Live data unavailable',
  };
}

export function epochViews(state: EngineState): RewardEpochView[] {
  return state.epochs.map((e) => ({
    id: e.id,
    start: e.start,
    end: e.end,
    solRewards: (e.rewardsByAsset['SOL'] ?? 0n).toString(10),
    nvdaRewards: (e.rewardsByAsset['NVDAx'] ?? 0n).toString(10),
    eligibleStake: e.eligibleStake.toString(10),
    status: e.status,
  }));
}

export function getAnalytics(range: '24H' | '7D' | '30D' | '90D' | 'ALL'): AnalyticsSeries {
  const mode = getMode();
  if (mode === 'demo') {
    const state = getDemoState();
    // Demo analytics are derived from the demo engine's own event log only.
    const cutoff = rangeCutoff(range);
    const points: AnalyticsPoint[] = [];
    const events = state.events.filter((e) => e.ts >= cutoff);
    const byBucket = new Map<number, AnalyticsPoint>();
    for (const e of events) {
      const bucket = Math.floor(e.ts / 3600) * 3600;
      const p = byBucket.get(bucket) ?? { t: bucket };
      if (e.kind === 'fee') {
        p.fees = (p.fees ?? 0) + Number(e.amountRaw) / 1e9;
      } else if (e.kind === 'claim') {
        p.distribution = (p.distribution ?? 0) + Number(e.amountRaw) / 1e9;
      }
      byBucket.set(bucket, p);
    }
    const tvlFlow = Number(state.totalShares) / 1e9; // FLOW-denominated
    for (const p of [...byBucket.values()].sort((a, b) => a.t - b.t)) {
      p.tvl = tvlFlow;
      p.stakers = state.stakers.size;
      points.push(p);
    }
    return { points, source: 'demo' };
  }
  return { points: [], source: 'live' };
}

function rangeCutoff(range: string): number {
  const now = Math.floor(Date.now() / 1000);
  switch (range) {
    case '24H':
      return now - 86400;
    case '7D':
      return now - 7 * 86400;
    case '30D':
      return now - 30 * 86400;
    case '90D':
      return now - 90 * 86400;
    default:
      return 0;
  }
}

export function getAdminStats(): AdminStats {
  const mode = getMode();
  if (mode === 'demo') {
    const state = getDemoState();
    const totals = engineTotals(state);
    const claims = state.events.filter((e) => e.kind === 'claim');
    return {
      totalTvl: totals.tvlFlow,
      creatorFeeRevenue: totals.creatorFees,
      solRewardPool: totals.solRewards,
      nvdaRewardPool: totals.nvdaRewards,
      activeUsers: totals.activeStakers,
      pendingClaims: 0,
      completedClaims: claims.length,
      failedTransactions: state.events.filter((e) => e.signature === null && e.kind === 'claim').length,
      epochs: state.epochs.length,
    };
  }
  throw new Error('Live data unavailable');
}

export function getActivity(mode: 'demo' | 'live' | 'staging', wallet: string | null): { rows: TxRow[]; error?: string } {
  if (mode === 'demo') {
    const state = getDemoState();
    const rows: TxRow[] = state.events
      .filter((e) => (wallet ? e.user === wallet || e.kind === 'fee' : true))
      .map((e) => ({
        signature: e.signature,
        slot: null,
        kind: (e.kind === 'claim' ? 'CLAIM' : e.kind === 'fee' ? 'FEE' : e.kind === 'stake' ? 'STAKE' : 'UNSTAKE') as TxRow['kind'],
        asset: e.asset,
        amount: Number(e.amountRaw) / 1e9,
        status: 'confirmed' as const,
        timestamp: e.ts,
      }))
      .reverse();
    return { rows };
  }
  return { rows: [], error: 'Live data unavailable' };
}
