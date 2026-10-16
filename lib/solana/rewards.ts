// SOLFLOW reward engine.
//
// DEMO MODE: deterministic, clearly-labeled simulation using the same
// rewardPerShare accounting as the production Anchor program. Runs only when
// NEXT_PUBLIC_DEMO_MODE=true; the UI always labels it "DEMO MODE - NO REAL FUNDS".
//
// LIVE MODE: state is read from the deployed program via RPC. This module
// never fabricates live data; failures surface as "Live data unavailable".
//
// TOKEN MODEL (corrected):
//   $FLOW = STAKING TOKEN — users stake FLOW (shares 1:1 with raw FLOW units).
//           SOL is NEVER a staking/deposit asset; it is reward-only.
//   CREATOR-FEE ECONOMICS (two levels, mirrors the Anchor program):
//     LEVEL 1: 70% of a verified fee -> creator payout · 30% -> reward pool
//     LEVEL 2: of the pool: 70% SOL (21% of the fee) · 30% NVDAx (9% of fee)
//   The NVDAx allocation arrives as SOL. In DEMO mode it is converted with a
//   clearly labeled TEST rate (lib/solana/nvda-convert.ts). In LIVE mode a
//   real conversion route must be configured — until then the 9% is retained
//   as PENDING CONVERSION (nvdaPendingConversionRaw here; the on-chain
//   nvda_pending vault live) and is NEVER routed to SOL or invented as NVDAx.
// Each reward asset has fully separated accounting (see
// lib/rewards/accounting.ts).
//
// DEMO FLOW BALANCES: each demo wallet receives a labeled 10,000 FLOW faucet
// balance (DEMO_FLOW_FAUCET_RAW) so the demo can simulate staking FLOW and
// unstaking FLOW without any real token. Stake moves FLOW balance -> staked
// position; unstake returns it. Never used in live mode.
import { getEnv } from "@/config/env";
import { getMode, type Mode } from "@/lib/mode";
import { DEMO_FLOW_FAUCET_RAW } from "@/lib/solana/tokens";
import { getNvdaConversionAdapter } from "@/lib/solana/nvda-convert";
import {
  assetBucket,
  claimPending,
  depositRewards,
  emptyLedger,
  emptyUserRewardState,
  syncUser,
  type RewardLedger,
  type UserRewardState,
} from "@/lib/rewards/accounting";

const LAMPORT = 1_000_000_000n;
const NVDA_DIVISOR = 1_000_000n;

/** LEVEL 1: creator payout share of every verified fee (70%). */
export const CREATOR_PAYOUT_BPS_DEFAULT = 7000;
/** LEVEL 1: reward-pool share of every verified fee (30%). */
export const REWARD_POOL_BPS_DEFAULT = 3000;
/** LEVEL 2: SOL share OF THE REWARD POOL (70% of pool = 21% of a fee). */
export const SOL_REWARD_BPS_DEFAULT = 7000;
/** LEVEL 2: NVDAx share OF THE REWARD POOL (30% of pool = 9% of a fee). */
export const NVDAX_REWARD_BPS_DEFAULT = 3000;

export type EpochStatus = 'active' | 'completed';

export interface EngineAssetState {
  symbol: 'SOL' | 'NVDAx';
  ledger: RewardLedger;
  allocationBps: number;
  enabled: boolean;
}

export interface EpochRecord {
  id: number;
  start: number;
  end: number | null;
  rewardsByAsset: Record<string, bigint>;
  eligibleStake: bigint;
  status: EpochStatus;
}

export interface EngineEvent {
  id: number;
  ts: number;
  kind: 'stake' | 'unstake' | 'claim' | 'fee';
  asset: string;
  amountRaw: bigint;
  user: string | null;
  signature: string | null;
}

export interface EngineState {
  mode: Mode;
  assets: Record<string, EngineAssetState>;
  totalShares: bigint; // raw FLOW staking units (1:1 with staked FLOW)
  stakers: Map<string, UserRewardState>;
  /** DEMO ONLY: simulated FLOW balances (raw units) backing stake/unstake. */
  flowBalances: Map<string, bigint>;
  epochs: EpochRecord[];
  events: EngineEvent[];
  /** Lifetime verified creator fees (LEVEL 1 input, lamports). */
  feesReceivedLamports: bigint;
  /** Lifetime LEVEL 1 creator payouts (lamports). */
  creatorPayoutLamports: bigint;
  /** Lifetime LEVEL 1 reward-pool inflow (lamports). */
  rewardPoolLamports: bigint;
  /**
   * NVDAx allocation retained as SOL-equivalent pending conversion (lamports
   * or raw SOL units in the demo ledger). Never credited to stakers as SOL.
   */
  nvdaPendingConversionRaw: bigint;
  /** Lifetime NVDAx units produced by (demo) simulated conversion. */
  nvdaConvertedRaw: bigint;
}

export function nvdaConfigured(): boolean {
  return getEnv().nvdaMint !== null && (getEnv().nvdaMint ?? '').length > 0;
}

export function createEngineState(): EngineState {
  const env = getEnv();
  const solBps = env.solAllocationBps ?? SOL_REWARD_BPS_DEFAULT; // bps OF POOL
  const nvdaBps = env.nvdaAllocationBps ?? NVDAX_REWARD_BPS_DEFAULT; // bps OF POOL
  return {
    mode: getMode(),
    assets: {
      SOL: { symbol: 'SOL', ledger: emptyLedger(), allocationBps: solBps, enabled: true },
      NVDAx: {
        symbol: 'NVDAx',
        ledger: emptyLedger(),
        allocationBps: nvdaBps,
        enabled: env.nvdaMint !== null && env.nvdaMint.length > 0,
      },
    },
    totalShares: 0n,
    stakers: new Map(),
    flowBalances: new Map(),
    epochs: [],
    events: [],
    feesReceivedLamports: 0n,
    creatorPayoutLamports: 0n,
    rewardPoolLamports: 0n,
    nvdaPendingConversionRaw: 0n,
    nvdaConvertedRaw: 0n,
  };
}

export function getOrCreateStaker(state: EngineState, wallet: string): UserRewardState {
  let s = state.stakers.get(wallet);
  if (!s) {
    s = emptyUserRewardState();
    state.stakers.set(wallet, s);
  }
  return s;
}

/**
 * DEMO ONLY: simulated FLOW balance. New demo wallets receive the labeled
 * faucet balance so stake/unstake of FLOW can be simulated end-to-end.
 */
export function demoFlowBalance(state: EngineState, wallet: string): bigint {
  let b = state.flowBalances.get(wallet);
  if (b === undefined) {
    b = DEMO_FLOW_FAUCET_RAW;
    state.flowBalances.set(wallet, b);
  }
  return b;
}

export function pushEvent(state: EngineState, e: Omit<EngineEvent, 'id' | 'ts'>): EngineEvent {
  const ev: EngineEvent = { id: state.events.length + 1, ts: Math.floor(Date.now() / 1000), ...e };
  state.events.push(ev);
  return ev;
}

/** Sync every enabled asset, then set new shares. Prevents reward loss on share changes. */
function applySharesAll(state: EngineState, user: UserRewardState, newShares: bigint): void {
  for (const asset of Object.values(state.assets)) {
    if (!asset.enabled) continue;
    syncUser(asset.ledger, user, asset.symbol);
  }
  user.shares = newShares;
  for (const asset of Object.values(state.assets)) {
    if (!asset.enabled) continue;
    assetBucket(user, asset.symbol).rewardDebtPerShare = asset.ledger.rewardPerShare;
  }
}

/**
 * Stake $FLOW: the user's simulated demo FLOW balance moves into the staking
 * position 1:1. SOL is NEVER a staking asset — it is reward-only.
 */
export function stake(state: EngineState, wallet: string, amountRaw: bigint): void {
  if (amountRaw <= 0n) throw new Error('amount must be positive');
  const balance = demoFlowBalance(state, wallet);
  if (amountRaw > balance) throw new Error('amount exceeds FLOW balance');
  const user = getOrCreateStaker(state, wallet);
  applySharesAll(state, user, user.shares + amountRaw);
  state.totalShares += amountRaw;
  state.flowBalances.set(wallet, balance - amountRaw);
  pushEvent(state, { kind: 'stake', asset: 'FLOW', amountRaw, user: wallet, signature: null });
}

/** Unstake $FLOW: pending rewards are synced first, then FLOW is returned. */
export function unstake(state: EngineState, wallet: string, amountRaw: bigint): void {
  if (amountRaw <= 0n) throw new Error('amount must be positive');
  const user = getOrCreateStaker(state, wallet);
  if (amountRaw > user.shares) throw new Error('amount exceeds staked position');
  applySharesAll(state, user, user.shares - amountRaw);
  state.totalShares -= amountRaw;
  state.flowBalances.set(wallet, demoFlowBalance(state, wallet) + amountRaw);
  pushEvent(state, { kind: 'unstake', asset: 'FLOW', amountRaw, user: wallet, signature: null });
}

/**
 * Distribute a verified creator fee through the TWO-LEVEL economics
 * (mirrors the on-chain record_fee exactly):
 *
 *   LEVEL 1: 70% (CREATOR_PAYOUT_BPS) -> creator payout (tracked, not
 *            credited to stakers) · 30% (REWARD_POOL_BPS) -> reward pool
 *   LEVEL 2: of the pool — 70% SOL rewards · 30% NVDAx allocation.
 *
 * The NVDAx allocation arrives as SOL. It is converted to NVDAx ONLY through
 * the conversion adapter: DEMO mode uses the clearly labeled demo-simulated
 * TEST rate; in LIVE mode the adapter fails closed, the allocation stays in
 * nvdaPendingConversionRaw and is NEVER routed to SOL or invented as NVDAx.
 */
export function distributeFees(
  state: EngineState,
  feesLamports: bigint
): Record<string, bigint> {
  if (feesLamports <= 0n) return {};
  state.feesReceivedLamports += feesLamports;

  // LEVEL 1: creator payout vs reward pool (integer math, lamports).
  const creatorShare = (feesLamports * BigInt(CREATOR_PAYOUT_BPS_DEFAULT)) / 10000n;
  const rewardPool = feesLamports - creatorShare; // remainder = REWARD_POOL_BPS
  state.creatorPayoutLamports += creatorShare;
  state.rewardPoolLamports += rewardPool;
  const out: Record<string, bigint> = {
    CREATOR_PAYOUT: creatorShare,
    REWARD_POOL: rewardPool,
  };

  // LEVEL 2: SOL allocation = SOL_REWARD_BPS OF THE POOL (21% of the fee).
  const solAsset = state.assets['SOL'];
  const solShare = solAsset
    ? (rewardPool * BigInt(solAsset.allocationBps)) / 10000n
    : (rewardPool * BigInt(SOL_REWARD_BPS_DEFAULT)) / 10000n;
  if (solAsset && solShare > 0n) {
    depositRewards(solAsset.ledger, solShare, state.totalShares);
    out['SOL'] = solShare;
  }

  // LEVEL 2: NVDAx allocation = remainder of the pool (9% of the fee).
  const nvdaAsset = state.assets['NVDAx'];
  const nvdaShareSolEquivalent = rewardPool - solShare;
  if (nvdaShareSolEquivalent > 0n) {
    const adapter = getNvdaConversionAdapter();
    const quote = adapter.configured() ? adapter.quote(nvdaShareSolEquivalent) : null;
    if (nvdaAsset && nvdaAsset.enabled && quote !== null && quote.nvdaRawOut > 0n) {
      // DEMO simulated conversion (test rate): real NVDAx-style raw units
      // credited to the NVDAx ledger. Clearly labeled via the adapter.
      depositRewards(nvdaAsset.ledger, quote.nvdaRawOut, state.totalShares);
      state.nvdaConvertedRaw += quote.nvdaRawOut;
      out['NVDAx'] = quote.nvdaRawOut;
      out['NVDAx_SIMULATED_FROM_SOL'] = nvdaShareSolEquivalent;
    } else {
      // Fail closed: retain as PENDING CONVERSION. Never routed to SOL,
      // never invented as NVDAx.
      state.nvdaPendingConversionRaw += nvdaShareSolEquivalent;
      out['NVDAx_PENDING_CONVERSION'] = nvdaShareSolEquivalent;
    }
  }

  pushEvent(state, { kind: 'fee', asset: 'SOL', amountRaw: feesLamports, user: null, signature: null });
  return out;
}

export function claimAsset(state: EngineState, wallet: string, symbol: string): bigint {
  const user = getOrCreateStaker(state, wallet);
  const asset = state.assets[symbol];
  if (!asset) throw new Error('unknown reward asset');
  if (!asset.enabled) throw new Error(symbol + ' rewards are not configured');
  syncUser(asset.ledger, user, asset.symbol);
  const claimed = claimPending(asset.ledger, user, symbol);
  if (claimed > 0n) {
    pushEvent(state, { kind: 'claim', asset: symbol, amountRaw: claimed, user: wallet, signature: null });
  }
  return claimed;
}

export function claimAll(state: EngineState, wallet: string): Record<string, bigint> {
  const out: Record<string, bigint> = {};
  for (const symbol of Object.keys(state.assets)) {
    const asset = state.assets[symbol];
    if (!asset.enabled) continue;
    const amt = claimAsset(state, wallet, symbol);
    if (amt > 0n) out[symbol] = amt;
  }
  return out;
}

export function currentEpoch(state: EngineState): EpochRecord | null {
  return state.epochs.find((e) => e.status === 'active') ?? null;
}

export function assetDivisor(symbol: string): bigint {
  return symbol === 'SOL' ? LAMPORT : NVDA_DIVISOR;
}

export interface AssetView {
  symbol: string;
  claimable: string; // UI units as string
  lifetimeEarned: string;
  lifetimeClaimed: string;
  allocationBps: number;
  enabled: boolean;
  lastClaimAt: number | null;
}

export function userRewardViews(state: EngineState, wallet: string): AssetView[] {
  const user = state.stakers.get(wallet);
  const out: AssetView[] = [];
  for (const asset of Object.values(state.assets)) {
    if (user) syncUser(asset.ledger, user, asset.symbol);
    const bucket = user ? assetBucket(user, asset.symbol) : null;
    const divisor = assetDivisor(asset.symbol);
    const pending = bucket ? bucket.pending : 0n;
    const earned = bucket ? bucket.lifetimeEarned : 0n;
    const claimed = bucket ? bucket.lifetimeClaimed : 0n;
    out.push({
      symbol: asset.symbol,
      claimable: (pending / divisor).toString(10),
      lifetimeEarned: (earned / divisor).toString(10),
      lifetimeClaimed: (claimed / divisor).toString(10),
      allocationBps: asset.allocationBps,
      enabled: asset.enabled,
      lastClaimAt: bucket ? bucket.lastClaimAt : null,
    });
  }
  return out;
}

export function engineTotals(state: EngineState): {
  /** Total value locked, denominated in staked $FLOW (UI units). */
  tvlFlow: string;
  /** LEVEL 1: lifetime verified creator fees (SOL). */
  creatorFees: string;
  /** LEVEL 1: lifetime creator payouts (70% of fees, SOL). */
  creatorPayout: string;
  /** LEVEL 1: lifetime reward-pool inflow (30% of fees, SOL). */
  rewardPool: string;
  /** LEVEL 2: SOL reward allocation funded into the SOL ledger (SOL). */
  solRewards: string;
  /** LEVEL 2: NVDAx units credited via (demo) simulated conversion. */
  nvdaRewards: string;
  /** LEVEL 2: NVDAx allocation retained as SOL-equivalent, awaiting conversion. */
  nvdaPendingConversion: string;
  activeStakers: number;
  nvdaConfigured: boolean;
  /** Conversion adapter readiness (live mode requires a real adapter). */
  nvdaConversionConfigured: boolean;
  nvdaConversionDetail: string;
  /** Effective percentages (basis points) shown in analytics/admin. */
  creatorPayoutBps: number;
  solRewardBpsOfPool: number;
  nvdaxRewardBpsOfPool: number;
} {
  const sol = state.assets['SOL']?.ledger;
  const nvda = state.assets['NVDAx']?.ledger;
  const adapter = getNvdaConversionAdapter();
  return {
    tvlFlow: (state.totalShares / LAMPORT).toString(10),
    creatorFees: (state.feesReceivedLamports / LAMPORT).toString(10),
    creatorPayout: (state.creatorPayoutLamports / LAMPORT).toString(10),
    rewardPool: (state.rewardPoolLamports / LAMPORT).toString(10),
    solRewards: ((sol?.totalFunded ?? 0n) / LAMPORT).toString(10),
    nvdaRewards: ((nvda?.totalFunded ?? 0n) / NVDA_DIVISOR).toString(10),
    nvdaPendingConversion: (state.nvdaPendingConversionRaw / LAMPORT).toString(10),
    activeStakers: state.stakers.size,
    nvdaConfigured: nvdaConfigured(),
    nvdaConversionConfigured: adapter.configured(),
    nvdaConversionDetail: adapter.configDetail(),
    creatorPayoutBps: CREATOR_PAYOUT_BPS_DEFAULT,
    solRewardBpsOfPool: SOL_REWARD_BPS_DEFAULT,
    nvdaxRewardBpsOfPool: NVDAX_REWARD_BPS_DEFAULT,
  };
}
