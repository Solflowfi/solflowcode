// SOL -> NVDAx conversion adapter interface. PRODUCTION ARCHITECTURE.
//
// WHY THIS EXISTS: Pump.fun creator fees arrive as SOL. The NVDAx reward
// allocation (30% of the reward pool = 9% of every fee) therefore cannot be
// "labeled NVDAx" — real NVDAx tokens must be acquired. The SOLFLOW program
// deliberately does NOT implement a swap: until a real, supported route is
// configured, conversion must FAIL CLOSED.
//
// Contract:
//   - `configured()` is the single source of truth for readiness. The
//     infrastructure validator and every live fee path MUST consult it.
//   - `quote()` returns null (never a guessed number) when unconfigured.
//   - The ONLY adapter that exists today is `demo-simulated`, which is
//     hard-gated to NEXT_PUBLIC_DEMO_MODE=true and applies a clearly labeled
//     TEST rate. It is never used in live mode.
//   - Wiring a real route (e.g. a DEX aggregator) means adding a NEW adapter
//     with `simulated: false` + its exact configuration keys, and setting
//     NEXT_PUBLIC_NVDA_SWAP_ADAPTER=<id>. Nothing else in the pipeline
//     changes: live NVDAx reward funding is always `fund_spl_rewards` with
//     real NVDAx tokens.
//
// LIVE economics reminder (never silently redirected):
//   fee 100 SOL -> 70 creator · 21 SOL rewards · 9 SOL-worth NVDAx PENDING.
//   The 9% stays in the on-chain nvda_pending vault (tracked by
//   GlobalState::nvda_pending_lamports) until a real conversion runs.
import { getEnv } from '../../config/env.ts';

export interface NvdaConversionQuote {
  /** SOL lamports submitted for conversion. */
  solLamportsIn: bigint;
  /** NVDAx raw units (8 decimals) the route would produce. */
  nvdaRawOut: bigint;
  /** Human-readable rate description (shown in the UI). */
  rateLabel: string;
  /** true = simulated (demo only); false = real route. */
  simulated: boolean;
}

export interface NvdaConversionAdapter {
  id: string;
  simulated: boolean;
  /** Fail-closed gate: false means conversion is NOT available. */
  configured(): boolean;
  /** Why conversion is (un)available — surfaced in /admin + infrastructure. */
  configDetail(): string;
  /** null = conversion unavailable (fail closed; never guess a rate). */
  quote(solLamports: bigint): NvdaConversionQuote | null;
}

/** Test rate for the DEMO-ONLY simulated adapter: 1 SOL => 1 NVDAx. */
export const DEMO_NVDA_PER_SOL = 1;
const NVDA_RAW_PER_SOL = BigInt(Math.floor(DEMO_NVDA_PER_SOL * 1e8)); // 8 decimals

/**
 * DEMO-ONLY simulated conversion adapter (test rate, clearly labeled).
 * Hard-rejected in live mode.
 */
const demoSimulatedAdapter: NvdaConversionAdapter = {
  id: 'demo-simulated',
  simulated: true,
  configured(): boolean {
    return getEnv().demoMode;
  },
  configDetail(): string {
    return getEnv().demoMode
      ? 'DEMO SIMULATION — test rate 1 SOL = 1 NVDAx. NOT a real conversion; live mode requires a real adapter.'
      : 'demo-simulated adapter is rejected in live mode.';
  },
  quote(solLamports: bigint): NvdaConversionQuote | null {
    if (!getEnv().demoMode || solLamports <= 0n) return null;
    return {
      solLamportsIn: solLamports,
      nvdaRawOut: solLamports * NVDA_RAW_PER_SOL / 1_000_000_000n,
      rateLabel: 'DEMO TEST RATE 1 SOL = 1 NVDAx (simulated)',
      simulated: true,
    };
  },
};

/**
 * Fail-closed adapter used whenever no supported real route is configured.
 * configured() is always false; quote() is always null.
 */
const unconfiguredAdapter: NvdaConversionAdapter = {
  id: 'unconfigured',
  simulated: false,
  configured(): boolean {
    return false;
  },
  configDetail(): string {
    return 'SOL->NVDAx conversion NOT configured — set NEXT_PUBLIC_NVDA_SWAP_ADAPTER=<supported adapter id>. Until then the 9% NVDAx allocation is retained (on-chain nvda_pending vault / demo pending counter) and NEVER credited as SOL or fake NVDAx.';
  },
  quote(): NvdaConversionQuote | null {
    return null;
  },
};

/**
 * LIVE Jupiter Swap API v2 adapter (server-side flow).
 *
 * configured() is true only in LIVE mode with the server-only
 * JUPITER_API_KEY present. In the browser bundle process.env.JUPITER_API_KEY
 * is never inlined (it is not NEXT_PUBLIC_), so clients simply see
 * "operator server" state — no key material ever reaches the browser.
 *
 * quote() deliberately returns null: the live conversion is an ASYNC
 * server-side flow (GET /order -> operator signs -> POST /execute ->
 * on-chain verification -> fund_spl_rewards), not a synchronous quote. The
 * operator UI drives it through /api/nvdax-funding/*.
 */
const jupiterSwapV2Adapter: NvdaConversionAdapter = {
  id: 'jupiter-swap-v2',
  simulated: false,
  configured(): boolean {
    if (getEnv().demoMode) return false;
    const k = typeof process !== 'undefined' ? process.env.JUPITER_API_KEY : undefined;
    return typeof k === 'string' && k.length > 0;
  },
  configDetail(): string {
    const env = getEnv();
    if (env.demoMode) return 'jupiter-swap-v2 selected but NEXT_PUBLIC_DEMO_MODE=true — live conversion is disabled in demo mode.';
    if (env.nvdaSwapAdapter !== 'jupiter-swap-v2') return 'NEXT_PUBLIC_NVDA_SWAP_ADAPTER must be "jupiter-swap-v2".';
    const k = typeof process !== 'undefined' ? process.env.JUPITER_API_KEY : undefined;
    if (typeof k !== 'string' || k.length === 0) return 'JUPITER_API_KEY is not configured (server-side only secret).';
    return 'Jupiter Swap API v2 adapter configured (server-side). Live flow: order -> operator signature -> execute -> on-chain verification -> fund_spl_rewards.';
  },
  quote(): NvdaConversionQuote | null {
    // Live conversion is an async server flow (see /api/nvdax-funding/*);
    // a sync quote would be a guess, so this stays null.
    return null;
  },
};

/** Resolve the active adapter for the current mode. */
export function getNvdaConversionAdapter(): NvdaConversionAdapter {
  const env = getEnv();
  if (env.demoMode) {
    // Demo mode ALWAYS uses the clearly labeled simulation (test rate 1:1),
    // regardless of the configured adapter id — demo economics keep working
    // and demo balances stay separated from any live conversion path.
    return demoSimulatedAdapter;
  }
  if (env.nvdaSwapAdapter === 'jupiter-swap-v2') {
    return jupiterSwapV2Adapter;
  }
  // No supported real route configured — every live configuration fails closed.
  return unconfiguredAdapter;
}

/**
 * LIVE readiness gate (item 8 of the live fee-processing checklist):
 * conversion must be explicitly configured AND simulated:false to run.
 */
export function liveNvdaConversionReady(): boolean {
  const a = getNvdaConversionAdapter();
  return a.configured() && !a.simulated;
}
