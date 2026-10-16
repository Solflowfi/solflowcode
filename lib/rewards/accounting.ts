// Reward accounting core — one ledger per reward asset.
//
// Model (mirrors the production Anchor program in /programs):
//   rewardPerShare  += newRewards / totalEligibleShares
//   pending[symbol] = shares * (rewardPerShare - rewardDebtPerShare[symbol]) / SCALE
//
// All math in BigInt on raw token units. Safe against division by zero
// (no-op when totalShares == 0), double distribution and overflow (BigInt).
//
// IMPORTANT (multi-reward correctness): every reward asset keeps its OWN
// bucket (reward debt / pending / lifetime) per user. A single shared pending
// bucket across assets would let a SOL claim consume NVDAx accruals — this is
// the accounting-separation guarantee for the 70/30 split.

export interface RewardLedger {
  rewardPerShare: bigint; // scaled by 1e12
  totalFunded: bigint; // raw units, lifetime
  totalDistributed: bigint; // raw units, lifetime settled to users
  totalClaimed: bigint; // raw units, lifetime claimed via claim()
  /** Funded while totalShares == 0; distributed with the NEXT deposit. */
  unsharedPool: bigint;
  lastFundedAt: number | null; // unix seconds
}

export interface AssetBucket {
  rewardDebtPerShare: bigint; // scaled 1e12, checkpoint for THIS asset
  pending: bigint; // raw reward units, THIS asset only
  lifetimeEarned: bigint; // raw units, THIS asset only
  lifetimeClaimed: bigint; // raw units, THIS asset only
  lastClaimAt: number | null;
}

export interface UserRewardState {
  shares: bigint; // raw staking units (shared across assets)
  assets: Record<string, AssetBucket>; // per-asset accounting buckets
}

export const REWARD_PER_SHARE_SCALE = 1_000_000_000_000n;

export function emptyLedger(): RewardLedger {
  return {
    rewardPerShare: 0n,
    totalFunded: 0n,
    totalDistributed: 0n,
    totalClaimed: 0n,
    unsharedPool: 0n,
    lastFundedAt: null,
  };
}

function emptyBucket(): AssetBucket {
  return {
    rewardDebtPerShare: 0n,
    pending: 0n,
    lifetimeEarned: 0n,
    lifetimeClaimed: 0n,
    lastClaimAt: null,
  };
}

export function emptyUserRewardState(shares = 0n): UserRewardState {
  return { shares, assets: {} };
}

/** Per-asset bucket accessor (creates on first use). */
export function assetBucket(user: UserRewardState, symbol: string): AssetBucket {
  let b = user.assets[symbol];
  if (!b) {
    b = emptyBucket();
    user.assets[symbol] = b;
  }
  return b;
}

/**
 * Deposit new rewards into the ledger.
 * When totalShares is zero the deposit is retained as pending pool funds and
 * is distributed on the next deposit once shares exist — never silently lost,
 * never inflating rewardPerShare against an empty pool.
 */
export function depositRewards(
  ledger: RewardLedger,
  amountRaw: bigint,
  totalShares: bigint
): void {
  if (amountRaw <= 0n) return;
  ledger.totalFunded += amountRaw;
  if (totalShares <= 0n) {
    // Retained in the unshared pool; distributed with the NEXT deposit once
    // shares exist (mirrors the on-chain distribute() helper exactly).
    ledger.unsharedPool += amountRaw;
    return;
  }
  const effective = ledger.unsharedPool + amountRaw;
  ledger.unsharedPool = 0n;
  const delta = (effective * REWARD_PER_SHARE_SCALE) / totalShares;
  ledger.rewardPerShare += delta;
  ledger.lastFundedAt = Math.floor(Date.now() / 1000);
}

/** Sync accrued rewards for ONE asset into that asset's pending bucket. */
export function syncUser(
  ledger: RewardLedger,
  user: UserRewardState,
  symbol: string
): void {
  const bucket = assetBucket(user, symbol);
  if (user.shares > 0n && ledger.rewardPerShare > bucket.rewardDebtPerShare) {
    const accrued =
      (user.shares * (ledger.rewardPerShare - bucket.rewardDebtPerShare)) /
      REWARD_PER_SHARE_SCALE;
    if (accrued > 0n) {
      bucket.pending += accrued;
      bucket.lifetimeEarned += accrued;
      ledger.totalDistributed += accrued;
    }
  }
  bucket.rewardDebtPerShare = ledger.rewardPerShare;
}

/** Claim pending rewards for ONE asset. Returns raw amount (0n when none). */
export function claimPending(
  ledger: RewardLedger,
  user: UserRewardState,
  symbol: string
): bigint {
  const bucket = assetBucket(user, symbol);
  const amount = bucket.pending;
  if (amount <= 0n) return 0n;
  bucket.pending = 0n;
  bucket.lifetimeClaimed += amount;
  ledger.totalClaimed += amount;
  bucket.lastClaimAt = Math.floor(Date.now() / 1000);
  return amount;
}

/**
 * Change a user's shares; syncs the given asset first so nothing is lost.
 * Callers that change shares must sync EVERY enabled asset before the change
 * (see the engine's applySharesAll).
 */
export function applySharesChange(
  ledger: RewardLedger,
  user: UserRewardState,
  newShares: bigint,
  symbol: string
): void {
  if (newShares < 0n) throw new Error('shares cannot be negative');
  syncUser(ledger, user, symbol);
  user.shares = newShares;
  assetBucket(user, symbol).rewardDebtPerShare = ledger.rewardPerShare;
}