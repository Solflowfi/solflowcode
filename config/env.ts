// Central environment / mode resolution. Never imports browser-only modules.
//
// TOKEN MODEL (corrected):
//   $FLOW = STAKING TOKEN  (NEXT_PUBLIC_FLOW_MINT) — users stake FLOW.
//   SOL    = REWARD TOKEN  (70% allocation)       — never a staking asset.
//   NVDAx  = REWARD TOKEN  (30% allocation)       — never a staking asset.

export type SolflowNetwork = "mainnet-beta" | "devnet" | "testnet";

export interface SolflowEnv {
  network: SolflowNetwork;
  rpcUrl: string;
  demoMode: boolean;
  programId: string | null;
  rewardTreasury: string | null;
  feeSources: string[];
  /** $FLOW staking token mint (NEXT_PUBLIC_FLOW_MINT). Users stake FLOW. */
  flowMint: string | null;
  /** NVDAx reward token mint (reward asset only — never the staking token). */
  nvdaMint: string | null;
  /** SOL reward vault (receives the SOL reward allocation). */
  solRewardVault: string | null;
  /** NVDAx reward vault (receives the NVDAx reward allocation). */
  nvdaRewardVault: string | null;
  /** LEVEL 1: creator payout destination (NEXT_PUBLIC_CREATOR_PAYOUT). */
  creatorPayout: string | null;
  /** Operator treasury pinned in GlobalState (NEXT_PUBLIC_TREASURY). */
  treasury: string | null;
  /**
   * LEVEL 2 allocation WITHIN the reward pool (bps of pool, NOT of the fee):
   *   SOL 70% (21% of a fee) / NVDAx 30% (9% of a fee).
   */
  solAllocationBps: number | null;
  nvdaAllocationBps: number | null;
  protocolFeeBps: number | null;
  /** Mainnet STAGING program ($TST) id (NEXT_PUBLIC_STAGING_PROGRAM_ID). */
  stagingProgramId: string | null;
  /** Staking test-mode flag (NEXT_PUBLIC_STAKING_TEST_MODE): true = the
   *  staging program + $TST staking token may be used for rehearsal. */
  stakingTestMode: boolean;
  /** SOL->NVDAx conversion adapter id (NEXT_PUBLIC_NVDA_SWAP_ADAPTER). */
  nvdaSwapAdapter: string | null;
}

function parseBps(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10000 ? Math.floor(n) : null;
}

/**
 * Static per-key access map. Next.js inlines `process.env.NEXT_PUBLIC_*`
 * member expressions into the client bundle at build time — dynamic lookups
 * (`process.env[key]`) are NOT replaced in the browser, which previously made
 * env reads inconsistent between server and client (e.g. the "NVDA token
 * unavailable" banner appearing despite a configured mint). Server code keeps
 * full process.env access, including non-public fallbacks.
 */
const NEXT_PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
  NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  NEXT_PUBLIC_PROGRAM_ID: process.env.NEXT_PUBLIC_PROGRAM_ID,
  NEXT_PUBLIC_REWARD_TREASURY: process.env.NEXT_PUBLIC_REWARD_TREASURY,
  NEXT_PUBLIC_REWARD_VAULT: process.env.NEXT_PUBLIC_REWARD_VAULT,
  NEXT_PUBLIC_CREATOR_FEE_SOURCES: process.env.NEXT_PUBLIC_CREATOR_FEE_SOURCES,
  NEXT_PUBLIC_CREATOR_FEE_SOURCE: process.env.NEXT_PUBLIC_CREATOR_FEE_SOURCE,
  NEXT_PUBLIC_FLOW_MINT: process.env.NEXT_PUBLIC_FLOW_MINT,
  NEXT_PUBLIC_NVDA_MINT: process.env.NEXT_PUBLIC_NVDA_MINT,
  NEXT_PUBLIC_SOL_REWARD_VAULT: process.env.NEXT_PUBLIC_SOL_REWARD_VAULT,
  NEXT_PUBLIC_NVDA_REWARD_VAULT: process.env.NEXT_PUBLIC_NVDA_REWARD_VAULT,
  NEXT_PUBLIC_SOL_REWARD_ALLOCATION_BPS: process.env.NEXT_PUBLIC_SOL_REWARD_ALLOCATION_BPS,
  NEXT_PUBLIC_NVDA_REWARD_ALLOCATION_BPS: process.env.NEXT_PUBLIC_NVDA_REWARD_ALLOCATION_BPS,
  NEXT_PUBLIC_CREATOR_PAYOUT: process.env.NEXT_PUBLIC_CREATOR_PAYOUT,
  NEXT_PUBLIC_STAGING_PROGRAM_ID: process.env.NEXT_PUBLIC_STAGING_PROGRAM_ID,
  NEXT_PUBLIC_STAKING_TEST_MODE: process.env.NEXT_PUBLIC_STAKING_TEST_MODE,
  NEXT_PUBLIC_NVDA_SWAP_ADAPTER: process.env.NEXT_PUBLIC_NVDA_SWAP_ADAPTER,
};

function raw(key: string): string | undefined {
  // Browser: only the statically-inlined NEXT_PUBLIC_* map exists.
  if (typeof window !== "undefined") {
    return NEXT_PUBLIC_ENV[key];
  }
  // Server/Node: full process.env (includes non-public fallbacks such as
  // SOL_REWARD_VAULT / PROTOCOL_FEE_BPS), falling back to the static map.
  if (typeof process !== "undefined" && process.env && process.env[key] !== undefined) {
    return process.env[key];
  }
  return NEXT_PUBLIC_ENV[key];
}

export function getEnv(): SolflowEnv {
  const network = (raw("NEXT_PUBLIC_SOLANA_NETWORK") || "devnet") as SolflowNetwork;
  const rpcUrl = raw("NEXT_PUBLIC_SOLANA_RPC_URL") || "";
  const demoMode = (raw("NEXT_PUBLIC_DEMO_MODE") || "true").toLowerCase() === "true";
  const programId = raw("NEXT_PUBLIC_PROGRAM_ID") || null;
  const rewardTreasury = raw("NEXT_PUBLIC_REWARD_TREASURY") || raw("NEXT_PUBLIC_REWARD_VAULT") || null;
  const feeSources = (raw("NEXT_PUBLIC_CREATOR_FEE_SOURCES") || raw("NEXT_PUBLIC_CREATOR_FEE_SOURCE") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    network,
    rpcUrl,
    demoMode,
    programId,
    rewardTreasury,
    feeSources,
    flowMint: raw("NEXT_PUBLIC_FLOW_MINT") || null,
    nvdaMint: raw("NEXT_PUBLIC_NVDA_MINT") || null,
    solRewardVault: raw("NEXT_PUBLIC_SOL_REWARD_VAULT") || raw("SOL_REWARD_VAULT") || null,
    nvdaRewardVault: raw("NEXT_PUBLIC_NVDA_REWARD_VAULT") || raw("NVDA_REWARD_VAULT") || null,
    creatorPayout: raw("NEXT_PUBLIC_CREATOR_PAYOUT") || null,
    treasury: raw("NEXT_PUBLIC_TREASURY") || null,
    // LEVEL 2 allocations are bps OF THE REWARD POOL (pool = 30% of a fee).
    solAllocationBps: parseBps(raw("NEXT_PUBLIC_SOL_REWARD_ALLOCATION_BPS")),
    nvdaAllocationBps: parseBps(raw("NEXT_PUBLIC_NVDA_REWARD_ALLOCATION_BPS")),
    protocolFeeBps: parseBps(raw("PROTOCOL_FEE_BPS")),
    // SOL->NVDAx conversion adapter: only 'demo-simulated' exists today. In
    // live mode every other value (or none) means conversion is UNAVAILABLE
    // and the pipeline must fail closed (see lib/solana/nvda-convert.ts).
    stagingProgramId: raw("NEXT_PUBLIC_STAGING_PROGRAM_ID") || null,
    stakingTestMode: (raw("NEXT_PUBLIC_STAKING_TEST_MODE") || "false").toLowerCase() === "true",
    nvdaSwapAdapter: raw("NEXT_PUBLIC_NVDA_SWAP_ADAPTER") || null,
  };
}
