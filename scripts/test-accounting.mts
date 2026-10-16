// SOLFLOW staking-model tests — $FLOW staking + TWO-LEVEL creator-fee economics.
//
// Run: node --experimental-strip-types --env-file=.env.local scripts/test-accounting.mts
//
// These tests exercise the SAME accounting primitives the demo engine and the
// Anchor program use (lib/rewards/accounting.ts + the distributeFees split in
// lib/solana/rewards.ts), mirroring the on-chain record_fee semantics exactly:
//
//   LEVEL 1 (every verified creator fee):
//     70% CREATOR_PAYOUT_BPS  -> creator payout (tracked, never staker credit)
//     30% REWARD_POOL_BPS     -> SOLFLOW reward pool
//   LEVEL 2 (of the reward pool):
//     70% SOL   -> SOL reward allocation   (21% of the fee)
//     30% NVDAX -> NVDAx allocation        ( 9% of the fee)
//   The NVDAx allocation arrives as SOL. It becomes NVDAx ONLY through the
//   conversion adapter (demo: simulated test rate; live: fail-closed pending).
//
//   - $FLOW is the staking token (shares = raw FLOW units, 1:1)
//   - per-asset buckets are independent (SOL claims never touch NVDAx)

import {
  assetBucket,
  claimPending,
  depositRewards,
  emptyLedger,
  emptyUserRewardState,
  syncUser,
  type RewardLedger,
  type UserRewardState,
} from "../lib/rewards/accounting.ts";
import { createFeeRecord, getRecord } from "../lib/solana/fee-records.ts";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assert(cond: boolean, name: string): void {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    failures.push(name);
    console.log("  FAIL  " + name);
  }
}

// ---------- mini engine mirroring lib/solana/rewards.ts distributeFees ----------

const SOL = 1_000_000_000n; // 1 SOL in lamports
const FLOW = 1_000_000_000n; // 1 FLOW = 1e9 raw units
const CREATOR_PAYOUT_BPS = 7000; // LEVEL 1: 70% of every fee
const SOL_REWARD_BPS = 7000; // LEVEL 2: 70% OF THE POOL
const NVDA_REWARD_BPS = 3000; // LEVEL 2: 30% OF THE POOL (remainder)
/** DEMO simulated conversion test rate: 1 lamport SOL -> 1 raw NVDAx. */
const DEMO_NVDA_RATE_RAW_PER_LAMPORT = 1n;

function SOL_U(n: number | bigint): bigint {
  return BigInt(n) * SOL;
}
function FLOW_U(n: number | bigint): bigint {
  return BigInt(n) * FLOW;
}

interface MiniAsset {
  symbol: "SOL" | "NVDAx";
  ledger: RewardLedger;
  enabled: boolean;
}

interface MiniEngine {
  assets: Record<"SOL" | "NVDAx", MiniAsset>;
  totalShares: bigint;
  stakers: Map<string, UserRewardState>;
  stakingSymbol: "FLOW";
  /** LEVEL 1: lifetime creator payouts (lamports). */
  creatorPayout: bigint;
  /** LEVEL 1: lifetime reward-pool inflow (lamports). */
  rewardPool: bigint;
  /** LEVEL 2: NVDAx allocation retained pending conversion (lamports-eq). */
  nvdaPending: bigint;
  /** LEVEL 2: NVDAx raw units produced by simulated conversion. */
  nvdaConverted: bigint;
  flowBalances: Map<string, bigint>;
}

function createEngine(nvdaEnabled: boolean): MiniEngine {
  return {
    assets: {
      SOL: { symbol: "SOL", ledger: emptyLedger(), enabled: true },
      NVDAx: { symbol: "NVDAx", ledger: emptyLedger(), enabled: nvdaEnabled },
    },
    totalShares: 0n,
    stakers: new Map(),
    stakingSymbol: "FLOW",
    creatorPayout: 0n,
    rewardPool: 0n,
    nvdaPending: 0n,
    nvdaConverted: 0n,
    flowBalances: new Map(),
  };
}

function getStaker(state: MiniEngine, wallet: string): UserRewardState {
  let s = state.stakers.get(wallet);
  if (!s) {
    s = emptyUserRewardState();
    state.stakers.set(wallet, s);
  }
  return s;
}

/** DEMO faucet: 10,000 FLOW per new wallet (labeled demo, never live). */
function flowBalance(state: MiniEngine, wallet: string): bigint {
  let b = state.flowBalances.get(wallet);
  if (b === undefined) {
    b = 10_000n * FLOW;
    state.flowBalances.set(wallet, b);
  }
  return b;
}


function syncAll(state: MiniEngine, user: UserRewardState): void {
  for (const asset of Object.values(state.assets)) {
    if (asset.enabled) syncUser(asset.ledger, user, asset.symbol);
  }
}

/** Stake $FLOW (never SOL): balance -> staked position 1:1. */
function stake(state: MiniEngine, wallet: string, amountRaw: bigint): void {
  const bal = flowBalance(state, wallet);
  if (amountRaw > bal) throw new Error("amount exceeds FLOW balance");
  const user = getStaker(state, wallet);
  syncAll(state, user);
  user.shares += amountRaw;
  for (const asset of Object.values(state.assets)) {
    if (asset.enabled) assetBucket(user, asset.symbol).rewardDebtPerShare = asset.ledger.rewardPerShare;
  }
  state.totalShares += amountRaw;
  state.flowBalances.set(wallet, bal - amountRaw);
}

/** Unstake $FLOW: pending rewards are synced first, then FLOW is returned. */
function unstake(state: MiniEngine, wallet: string, amountRaw: bigint): void {
  const user = getStaker(state, wallet);
  if (amountRaw > user.shares) throw new Error("amount exceeds staked position");
  syncAll(state, user);
  user.shares -= amountRaw;
  for (const asset of Object.values(state.assets)) {
    if (asset.enabled) assetBucket(user, asset.symbol).rewardDebtPerShare = asset.ledger.rewardPerShare;
  }
  state.totalShares -= amountRaw;
  state.flowBalances.set(wallet, flowBalance(state, wallet) + amountRaw);
}

function claim(state: MiniEngine, wallet: string, symbol: "SOL" | "NVDAx"): bigint {
  const user = getStaker(state, wallet);
  const asset = state.assets[symbol];
  if (!asset || !asset.enabled) throw new Error(symbol + " rewards are not configured");
  syncUser(asset.ledger, user, symbol);
  return claimPending(asset.ledger, user, symbol);
}

/**
 * Mirror of lib/solana/rewards.ts distributeFees (and the on-chain record_fee):
 * LEVEL 1 creator payout + reward pool, then LEVEL 2 pool split. The NVDAx
 * allocation is converted via the demo-simulated test rate when enabled, or
 * retained as PENDING CONVERSION (never routed to SOL) when not.
 */
function distributeFees(
  state: MiniEngine,
  feesLamports: bigint,
  nvdaConversion: "simulated" | "unavailable" = "simulated"
): { creator: bigint; pool: bigint; sol: bigint; nvdaEq: bigint } {
  if (feesLamports <= 0n) return { creator: 0n, pool: 0n, sol: 0n, nvdaEq: 0n };
  // LEVEL 1
  const creator = (feesLamports * BigInt(CREATOR_PAYOUT_BPS)) / 10000n;
  const pool = feesLamports - creator; // REWARD_POOL_BPS remainder
  state.creatorPayout += creator;
  state.rewardPool += pool;
  // LEVEL 2
  const sol = (pool * BigInt(SOL_REWARD_BPS)) / 10000n;
  const nvdaEq = pool - sol; // remainder = NVDAX_REWARD_BPS share
  depositRewards(state.assets.SOL.ledger, sol, state.totalShares);
  if (state.assets.NVDAx.enabled && nvdaConversion === "simulated") {
    const nvdaRaw = nvdaEq * DEMO_NVDA_RATE_RAW_PER_LAMPORT;
    depositRewards(state.assets.NVDAx.ledger, nvdaRaw, state.totalShares);
    state.nvdaConverted += nvdaRaw;
  } else {
    state.nvdaPending += nvdaEq; // fail closed — never routed to SOL
  }
  return { creator, pool, sol, nvdaEq };
}

// ========================= SCENARIO SUITE =========================

console.log("\n[1] 100 SOL creator fee -> 70 creator / 30 reward pool");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  const r = distributeFees(e, SOL_U(100));
  assert(r.creator === SOL_U(70), "LEVEL 1: 70 SOL creator payout from 100 SOL fee");
  assert(r.pool === SOL_U(30), "LEVEL 1: 30 SOL reward pool from 100 SOL fee");
  assert(e.creatorPayout === SOL_U(70), "creator payout tracked in engine totals");
  assert(e.rewardPool === SOL_U(30), "reward pool tracked in engine totals");
}

console.log("\n[2] 30 SOL reward pool -> 21 SOL / 9 SOL-worth NVDAx");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  const r = distributeFees(e, SOL_U(100));
  assert(r.sol === SOL_U(21), "LEVEL 2: 21 SOL SOL-reward allocation (70% of pool)");
  assert(r.nvdaEq === SOL_U(9), "LEVEL 2: 9 SOL-worth NVDAx allocation (30% of pool)");
  assert(SOL_REWARD_BPS + NVDA_REWARD_BPS === 10000, "LEVEL 2 bps sum to 100% of the pool");
  assert(e.assets.SOL.ledger.totalFunded === SOL_U(21), "SOL ledger funded exactly 21 SOL");
  assert(e.assets.NVDAx.ledger.totalFunded === SOL_U(9) * DEMO_NVDA_RATE_RAW_PER_LAMPORT, "NVDAx ledger funded via simulated conversion (test rate)");
}

console.log("\n[3] Effective total: 70% creator + 21% SOL + 9% NVDAx = 100%");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  const r = distributeFees(e, SOL_U(100));
  const total = r.creator + r.sol + r.nvdaEq;
  assert(total === SOL_U(100), "conservation: 70 + 21 + 9 = 100 SOL (nothing created or lost)");
  assert(r.creator * 100n === SOL_U(100) * 70n, "creator share is exactly 70%");
  assert(r.sol * 100n === SOL_U(100) * 21n, "SOL share is exactly 21% of the fee");
  assert(r.nvdaEq * 100n === SOL_U(100) * 9n, "NVDAx share is exactly 9% of the fee");
}

console.log("\n[4] Multiple creator-fee transactions accumulate correctly");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  distributeFees(e, SOL_U(50));
  distributeFees(e, SOL_U(250));
  assert(e.creatorPayout === SOL_U(280), "creator payouts: 70 + 35 + 175 = 280 SOL");
  assert(e.assets.SOL.ledger.totalFunded === SOL_U(84), "SOL rewards: 21 + 10.5 + 52.5 = 84 SOL");
  assert(e.creatorPayout + e.assets.SOL.ledger.totalFunded + e.assets.NVDAx.ledger.totalFunded === SOL_U(400), "400 SOL of fees fully accounted");
}

console.log("\n[5] Duplicate creator-fee signature rejected (replay protection)");
{
  const sig = "5" + "x".repeat(86); // 87-char signature
  createFeeRecord({
    transactionSignature: sig, slot: 1, timestamp: 1,
    source: "src", destination: "dst", amountLamports: 1_000_000n, status: "verified",
  });
  const dup = createFeeRecord({
    transactionSignature: sig, slot: 2, timestamp: 2,
    source: "src", destination: "dst", amountLamports: 1_000_000n, status: "verified",
  });
  assert(dup.status === "rejected_duplicate", "duplicate fee recorded as rejected_duplicate");
  assert(dup.amountLamports === "1000000", "duplicate does not overwrite the original amount");
  const stored = getRecord(sig);
  assert(stored !== null && stored.status === "rejected_duplicate", "record store keeps the duplicate guard");
}

console.log("\n[6] Creator payout accounting (LEVEL 1 totals, never staker credit)");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  const user = getStaker(e, "walletA");
  syncUser(e.assets.SOL.ledger, user, "SOL");
  assert(e.creatorPayout === SOL_U(70), "creator payout recorded (70 SOL)");
  assert(assetBucket(user, "SOL").pending === SOL_U(21), "stakers receive ONLY the 21% SOL share");
  assert(assetBucket(user, "SOL").pending + e.creatorPayout === SOL_U(91), "creator + staker SOL = 91 of 100 (9 = NVDAx allocation)");
}

console.log("\n[7] SOL reward accounting across stake changes");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  const user = getStaker(e, "walletA");
  syncUser(e.assets.SOL.ledger, user, "SOL");
  assert(assetBucket(user, "SOL").pending === SOL_U(42), "21 + 21 = 42 SOL accrued across two fees");
  assert(e.assets.SOL.ledger.totalFunded === SOL_U(42), "SOL ledger totalFunded = 42 SOL");
}

console.log("\n[8] NVDAx reward accounting (simulated conversion, test rate)");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  const user = getStaker(e, "walletA");
  syncUser(e.assets.NVDAx.ledger, user, "NVDAx");
  const expected = SOL_U(9) * DEMO_NVDA_RATE_RAW_PER_LAMPORT;
  assert(assetBucket(user, "NVDAx").pending === expected, "9 SOL-worth NVDAx (test rate) credited to the NVDAx bucket only");
  assert(e.nvdaConverted === expected, "converted NVDAx tracked separately from pending");
}

console.log("\n[9] SOL claim does not alter NVDAx accounting");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  const user = getStaker(e, "walletA");
  syncUser(e.assets.NVDAx.ledger, user, "NVDAx");
  const before = assetBucket(user, "NVDAx").pending;
  claim(e, "walletA", "SOL");
  syncUser(e.assets.NVDAx.ledger, user, "NVDAx");
  assert(assetBucket(user, "NVDAx").pending === before, "NVDAx pending untouched by SOL claim");
}

console.log("\n[10] NVDAx claim does not alter SOL accounting");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  const user = getStaker(e, "walletA");
  syncUser(e.assets.SOL.ledger, user, "SOL");
  const before = assetBucket(user, "SOL").pending;
  claim(e, "walletA", "NVDAx");
  assert(assetBucket(user, "SOL").pending === before, "SOL pending untouched by NVDAx claim");
}


console.log("\n[11] FLOW principal remains unchanged by claims");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  claim(e, "walletA", "SOL");
  claim(e, "walletA", "NVDAx");
  const user = getStaker(e, "walletA");
  assert(user.shares === FLOW_U(1000), "staked FLOW principal unchanged by claims");
  assert(flowBalance(e, "walletA") === 10_000n * FLOW - FLOW_U(1000), "FLOW wallet balance unchanged by claims");
}

console.log("\n[12] Unavailable NVDAx conversion does NOT redirect the 9% to SOL");
{
  const e = createEngine(false); // NVDAx NOT configured
  stake(e, "walletA", FLOW_U(1000));
  const r = distributeFees(e, SOL_U(100), "unavailable");
  assert(r.sol === SOL_U(21), "SOL rewards still exactly 21% — no redirect");
  assert(e.assets.SOL.ledger.totalFunded === SOL_U(21), "SOL ledger untouched by missing conversion");
  assert(e.nvdaPending === SOL_U(9), "9 SOL-worth retained as PENDING CONVERSION");
  assert(e.assets.NVDAx.ledger.totalFunded === 0n, "no NVDAx invented while conversion unavailable");
  let threw = false;
  try {
    claim(e, "walletA", "NVDAx");
  } catch {
    threw = true;
  }
  assert(threw, "claiming unconfigured NVDAx is rejected");
}

console.log("\n[13] Pause gates exist for stake/unstake/claims (on-chain source check)");
{
  const src = readFileSync(new URL("../programs/solflow/src/lib.rs", import.meta.url), "utf8");
  const fn = (name: string): string => {
    const i = src.indexOf("pub fn " + name);
    return i === -1 ? "" : src.slice(i, i + 3000);
  };
  const gates = ["stake", "unstake", "claim_sol", "claim_nvdax", "claim_all"].map(
    (f) => fn(f).includes("gs.paused") || fn(f).includes("global_state.paused")
  );
  assert(gates.every(Boolean), "stake/unstake/claim_sol/claim_nvdax/claim_all all check paused");
  assert(src.includes("paused = true"), "pause instruction exists (pause writes global_state.paused)");
  assert(src.includes("gs.paused = false"), "unpause instruction exists");
}

console.log("\n[14] Demo mode uses the SIMULATED conversion (clearly labeled test rate)");
{
  const src = readFileSync(new URL("../lib/solana/nvda-convert.ts", import.meta.url), "utf8");
  assert(src.includes("demo-simulated"), "demo-simulated adapter exists");
  assert(src.includes("getEnv().demoMode"), "demo adapter is gated on NEXT_PUBLIC_DEMO_MODE");
  assert(src.includes("TEST RATE"), "test rate is clearly labeled");
  assert(src.includes("simulated: true"), "adapter is marked simulated");
}

console.log("\n[15] Live mode refuses fee processing when conversion is unconfigured");
{
  const src = readFileSync(new URL("../lib/solana/nvda-convert.ts", import.meta.url), "utf8");
  assert(src.includes("const unconfiguredAdapter"), "fail-closed unconfigured adapter exists");
  assert(src.includes("return null"), "quote() returns null when unconfigured (never a guessed rate)");
  assert(src.includes("liveNvdaConversionReady"), "live readiness gate is exported");
  assert(src.includes("!a.simulated"), "live gate requires a NON-simulated adapter");
  const infra = readFileSync(new URL("../lib/validation/infrastructure.ts", import.meta.url), "utf8");
  assert(infra.includes("'nvda_conversion'"), "infrastructure gate includes nvda_conversion (liveReady blocked)");
  assert(infra.includes("'creator_payout'"), "infrastructure gate includes creator_payout (liveReady blocked)");
}

console.log("\n[16] Rounding / lamport precision (odd amounts, no dust lost)");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  const odd = 100_000_001n; // 0.1 SOL + 1 lamport
  const r = distributeFees(e, odd);
  assert(r.creator + r.sol + r.nvdaEq === odd, "odd amount fully conserved (creator + SOL + NVDAx = fee)");
  const expectedCreator = (odd * 7000n) / 10000n; // 70_000_000
  const expectedPool = odd - expectedCreator; // 30_000_001
  assert(r.creator === expectedCreator && r.pool === expectedPool, "LEVEL 1 floors correctly and remainder goes to the pool");
  const expectedSol = (expectedPool * 7000n) / 10000n; // 21_000_000
  assert(r.sol === expectedSol && r.nvdaEq === expectedPool - expectedSol, "LEVEL 2 floors correctly and remainder stays in the NVDAx allocation");
}

console.log("\n[17] Very small creator fees (dust lands in the pending bucket, never lost)");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  const r1 = distributeFees(e, 1n); // 1 lamport
  assert(r1.creator === 0n && r1.sol === 0n && r1.nvdaEq === 1n, "1-lamport fee: creator 0, SOL 0, NVDAx allocation 1 (floor dust)");
  assert(r1.creator + r1.sol + r1.nvdaEq === 1n, "1-lamport fee fully conserved");
  const r9 = distributeFees(e, 9n); // 9 lamports
  assert(r9.creator === 6n && r9.pool === 3n && r9.sol === 2n && r9.nvdaEq === 1n, "9-lamport fee splits 6/2/1 with no dust lost");
  const r10 = distributeFees(e, 10n);
  assert(r10.creator === 7n && r10.sol === 2n && r10.nvdaEq === 1n, "10-lamport fee splits exactly 7/2/1");
}


console.log("\n[18] Multiple stakers receive SOL rewards pro-rata");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  stake(e, "walletB", FLOW_U(3000));
  distributeFees(e, SOL_U(100)); // 21 SOL across 4000 FLOW
  const a = getStaker(e, "walletA");
  const b = getStaker(e, "walletB");
  syncUser(e.assets.SOL.ledger, a, "SOL");
  syncUser(e.assets.SOL.ledger, b, "SOL");
  const expectedA = (FLOW_U(1000) * SOL_U(21)) / FLOW_U(4000); // 5.25 SOL
  const expectedB = (FLOW_U(3000) * SOL_U(21)) / FLOW_U(4000); // 15.75 SOL
  assert(assetBucket(a, "SOL").pending === expectedA, "walletA: 5.25 SOL (1000/4000 of 21)");
  assert(assetBucket(b, "SOL").pending === expectedB, "walletB: 15.75 SOL (3000/4000 of 21)");
  assert(expectedA + expectedB === SOL_U(21), "pro-rata shares sum to the SOL allocation");
}

console.log("\n[19] Multiple stakers receive NVDAx rewards pro-rata");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  stake(e, "walletB", FLOW_U(3000));
  distributeFees(e, SOL_U(100)); // 9 SOL-worth NVDAx raw across 4000 FLOW
  const a = getStaker(e, "walletA");
  const b = getStaker(e, "walletB");
  syncUser(e.assets.NVDAx.ledger, a, "NVDAx");
  syncUser(e.assets.NVDAx.ledger, b, "NVDAx");
  const expectedA = (FLOW_U(1000) * SOL_U(9)) / FLOW_U(4000); // 2.25 SOL-worth
  const expectedB = (FLOW_U(3000) * SOL_U(9)) / FLOW_U(4000); // 6.75 SOL-worth
  assert(assetBucket(a, "NVDAx").pending === expectedA, "walletA: 2.25 SOL-worth NVDAx");
  assert(assetBucket(b, "NVDAx").pending === expectedB, "walletB: 6.75 SOL-worth NVDAx");
  assert(expectedA + expectedB === SOL_U(9), "pro-rata NVDAx shares sum to the NVDAx allocation");
}

console.log("\n[20] Creator payout can never exceed 70% of the verified fee");
{
  const amounts = [1n, 3n, 7n, 9n, 10n, 33n, 99n, 100n, 123_456_789n, 987_654_321n, SOL_U(100), SOL_U(10_000)];
  let allOk = true;
  for (const fee of amounts) {
    const e = createEngine(true);
    const r = distributeFees(e, fee);
    const maxCreator = (fee * 7000n) / 10000n; // exact ceiling: floor of 70%
    if (r.creator > maxCreator) allOk = false;
    if (r.creator + r.pool !== fee) allOk = false; // remainder, never more
    if (r.creator + r.sol + r.nvdaEq !== fee) allOk = false;
  }
  assert(allOk, "creator share <= 70% (floored) and full conservation for all amounts");
}

console.log("\n[21] Rewards funded while no stakers exist (retained, not lost)");
{
  const e = createEngine(true);
  distributeFees(e, SOL_U(100)); // no stakers yet
  assert(e.assets.SOL.ledger.unsharedPool === SOL_U(21), "SOL 21% retained in unshared pool");
  assert(e.creatorPayout === SOL_U(70), "creator payout still 70% with no stakers");
  assert(e.assets.NVDAx.ledger.totalFunded === SOL_U(9) * DEMO_NVDA_RATE_RAW_PER_LAMPORT, "NVDAx allocation converted (simulated) even with no stakers");
}

console.log("\n[22] Retained pool distributed when staking resumes");
{
  const e = createEngine(true);
  distributeFees(e, SOL_U(100)); // retained (no stakers)
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100)); // triggers retained distribution
  const user = getStaker(e, "walletA");
  syncUser(e.assets.SOL.ledger, user, "SOL");
  assert(assetBucket(user, "SOL").pending === SOL_U(42), "retained 21 + new 21 = 42 SOL pending");
}

console.log("\n[23] Stake increase / decrease boundaries preserve accrual");
{
  const e = createEngine(true);
  stake(e, "walletA", FLOW_U(1000));
  distributeFees(e, SOL_U(100));
  stake(e, "walletA", FLOW_U(1000)); // increase to 2000
  distributeFees(e, SOL_U(100));
  unstake(e, "walletA", FLOW_U(500)); // decrease to 1500
  distributeFees(e, SOL_U(100));
  const user = getStaker(e, "walletA");
  syncUser(e.assets.SOL.ledger, user, "SOL");
  const expected = SOL_U(21) + SOL_U(21) + (FLOW_U(1500) * SOL_U(21)) / FLOW_U(1500);
  assert(assetBucket(user, "SOL").pending === expected, "accrual preserved across increase/decrease boundaries");
  assert(user.shares === FLOW_U(1500), "FLOW principal tracks stake/unstake exactly");
}

console.log("\n[24] FLOW is the ONLY staking asset (static on-chain source checks)");
{
  const src = readFileSync(new URL("../programs/solflow/src/lib.rs", import.meta.url), "utf8");
  assert(src.includes('b"flow_vault", staking_mint.key().as_ref()'), "staking vault is the FLOW-mint-seeded PDA");
  assert(src.includes("user_flow_ata.mint == staking_mint.key()"), "user staking ATA is pinned to the FLOW mint");
  assert(src.includes("staking_mint.key() == global_state.staking_mint"), "staking mint is the registered FLOW mint");
  assert(!src.includes("pub fn stake_sol"), "no SOL staking entrypoint exists");
  assert(src.includes("pub const NVDA_MINT"), "NVDAx mint pinned in the program");
  assert(src.includes("token_interface::ID"), "Token-2022 path retained for NVDAx");
  assert(src.includes("InterfaceAccount<'info, token_interface::TokenAccount>"), "Token-2022 InterfaceAccount retained");
}

console.log("\n[25] Treasury pinning + record_fee attack-surface (on-chain source checks)");
{
  const src = readFileSync(new URL("../programs/solflow/src/lib.rs", import.meta.url), "utf8");
  assert(src.includes("pub treasury: Pubkey,"), "GlobalState pins the operator treasury");
  assert(src.includes("pub fn set_treasury"), "authority-only set_treasury exists");
  assert(src.includes("require!(new_treasury != Pubkey::default(), SolflowError::TreasuryNotConfigured)"), "set_treasury rejects the default (unset) address");
  // record_fee must NOT accept a caller-chosen treasury account
  const ctxStart = src.indexOf("pub struct RecordFee<'info>");
  const recordFeeCtx = src.slice(ctxStart, src.indexOf("}", src.indexOf("pub system_program", ctxStart)));
  assert(!recordFeeCtx.includes("treasury: SystemAccount"), "RecordFee context has no arbitrary treasury account");
  assert(src.includes("gs.treasury = treasury;"), "initialize pins the treasury in GlobalState");
  assert(src.includes("TreasuryUpdated"), "TreasuryUpdated event emitted on change");
}

console.log("\n[26] Treasury wallet roles + PDA separation (task: treasury config)");
{
  const { PublicKey } = await import("@solana/web3.js");
  const src = readFileSync(new URL("../programs/solflow/src/lib.rs", import.meta.url), "utf8");
  const PROGRAM = "DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ";
  const pda = (seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], new PublicKey(PROGRAM))[0].toBase58();

  // Wallet role configuration (env)
  assert(process.env.NEXT_PUBLIC_TREASURY === "8VAgZxVDaKW9hoGYnyQDKpkgGXmMXEZWUwVmCWHVdCGv", "NEXT_PUBLIC_TREASURY = 8VAg…dCGv (Treasury/Operations wallet)");
  assert(process.env.NEXT_PUBLIC_CREATOR_FEE_SOURCE === "GPsLKasHcWib1dpSZNcitxaXfdLSDCJEE73qZ8qY4DRS", "NEXT_PUBLIC_CREATOR_FEE_SOURCE = GPsL…4DRS (creator wallet)");
  assert(process.env.NEXT_PUBLIC_CREATOR_PAYOUT === "GPsLKasHcWib1dpSZNcitxaXfdLSDCJEE73qZ8qY4DRS", "NEXT_PUBLIC_CREATOR_PAYOUT = GPsL…4DRS (creator wallet)");
  assert(process.env.PROTOCOL_FEE_BPS === "0", "PROTOCOL_FEE_BPS is explicit 0 (no invented protocol fee)");

  // Treasury is NOT any program-derived vault/authority/state address
  const TREASURY = "8VAgZxVDaKW9hoGYnyQDKpkgGXmMXEZWUwVmCWHVdCGv";
  const pdas = { global: pda("global"), solVault: pda("sol_vault"), vaultAuth: pda("vault_auth"), splVault: pda("spl_vault") };
  assert(Object.values(pdas).every((a) => a !== TREASURY), "treasury wallet is NOT a program PDA (global/vaults/authority)");

  // PDA derivations match the deployed addresses exactly
  assert(pdas.global === "GhhhUfJy7MJYNKjfTXheS7NtXVPr4bvDyGWN8DLRhu49", "Global State PDA = Ghhh…hu49 ([\"global\"])");
  assert(pdas.solVault === "44WqheySSkeodu3LS3jbB66D3YctP3mGtEz1WEZo3JV3", "SOL reward vault PDA = 44Wq…2JV3 ([\"sol_vault\"])");
  assert(pdas.vaultAuth === "BFDerb69haAS92i7aSwD9Ew1dZ4gHxHKKJMHTUUc7Y2a", "Vault authority PDA = BFDe…7Y2a ([\"vault_auth\"])");
  assert(pdas.splVault === "FjHvKANRhMrz9VK72DbA19N6HpbrPVhGKCYnvV6oMUMK", "NVDAx reward vault PDA = FjHv…oMUMK ([\"spl_vault\"])");

  // initialize takes the treasury explicitly and pins it
  assert(src.includes("pub fn initialize(ctx: Context<Initialize>, creator_payout: Pubkey, treasury: Pubkey)"), "initialize explicitly accepts creator_payout + treasury");

  // record_fee destination validation: creator payout must equal the pinned value
  assert(src.includes("ctx.accounts.creator_payout.key()") && src.includes("gs.creator_payout"), "record_fee validates the payout destination against GlobalState");

  // record_fee preserves: funder == configured fee source, replay protection
  assert(src.includes("ctx.accounts.funder.key(), cfg.source, SolflowError::FeeSourceNotAllowed"), "funder must equal the configured fee source");
  assert(src.includes("seeds = [b\"fee_receipt\", &signature[..32]]"), "fee replay protection: receipt PDA seeded by signature");

  // Treasury cannot redirect user staking deposits: no CPI transfer targets
  // the treasury, and the record_fee context block contains no treasury account.
  assert(!/transfer\([^)]*treasury/i.test(src), "no transfer instruction routes funds to the treasury");
  assert(src.includes("pub struct RecordFee<'info>") && !src.slice(src.indexOf("pub struct RecordFee<'info>"), src.indexOf("pub struct ClaimSol")).includes("treasury"), "record_fee context block contains no treasury account at all");
}


// ---------- summary ----------
console.log("\n=== SUMMARY: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) {
  console.log("FAILED: " + failures.join(" | "));
  process.exit(1);
}


