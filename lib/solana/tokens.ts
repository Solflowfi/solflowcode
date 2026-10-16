// Token metadata helpers. Names/symbols come from config; the UI never
// invents token metadata that is not configured.
//
// TOKEN MODEL (corrected):
//   FLOW  = staking token  (users stake FLOW; shares 1:1 with raw FLOW units)
//   SOL   = reward token   (70% of creator-fee allocation)
//   NVDAx = reward token   (30% of creator-fee allocation)

import { getEnv } from '@/config/env';

export interface RewardToken {
  symbol: 'SOL' | 'NVDAx';
  name: string;
  mint: string | null;
  decimals: number;
  enabled: boolean;
}

export interface StakingToken {
  symbol: 'FLOW';
  name: string;
  mint: string | null;
  /** Demo accounting assumes 9 raw-unit decimals for FLOW. */
  decimals: number;
  enabled: boolean;
}

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
/** Raw-unit scale for FLOW demo accounting (1 FLOW = 1e9 raw units). */
export const FLOW_DIVISOR = 1_000_000_000n;
/** Demo faucet: every demo wallet starts with 10,000 FLOW to stake. */
export const DEMO_FLOW_FAUCET_RAW = 10_000n * FLOW_DIVISOR;

export function getRewardTokens(): RewardToken[] {
  const env = getEnv();
  return [
    { symbol: 'SOL', name: 'Solana', mint: SOL_MINT, decimals: 9, enabled: true },
    // NVDAx is enabled ONLY when the operator configures a real mint.
    // When unconfigured the UI must show NVDAx NOT CONFIGURED — never an
    // invented mint, price or simulated transfers.
    { symbol: 'NVDAx', name: 'NVDAx Token', mint: env.nvdaMint, decimals: 6, enabled: env.nvdaMint !== null },
  ];
}

export function getTokenBySymbol(symbol: string): RewardToken | null {
  return getRewardTokens().find((t) => t.symbol === symbol.toUpperCase()) ?? null;
}

/**
 * The staking token. $FLOW is the ONLY staking asset; SOL and NVDAx are
 * reward assets and must never appear as a staking/deposit denomination.
 * Enabled only when NEXT_PUBLIC_FLOW_MINT is configured — the UI must show
 * "FLOW NOT CONFIGURED" rather than inventing a mint.
 */
export function getStakingToken(): StakingToken {
  const env = getEnv();
  return {
    symbol: 'FLOW',
    name: 'FLOW Token',
    mint: env.flowMint,
    decimals: 9,
    enabled: env.flowMint !== null && env.flowMint.length > 0,
  };
}

export function flowConfigured(): boolean {
  return getStakingToken().enabled;
}
