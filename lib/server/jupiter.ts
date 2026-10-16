// Jupiter Swap API v2 adapter — SERVER ONLY. Never import from client code.
//
// Production SOL -> NVDAx conversion flow:
//   GET  https://api.jup.ag/swap/v2/order   (unsigned swap tx for the taker)
//   POST https://api.jup.ag/swap/v2/execute (managed landing of the signed tx)
// Every request carries the server-side `x-api-key` (JUPITER_API_KEY).
//
// SECURITY: the operator signs in their own wallet (Phantom). This module
// NEVER touches private keys or seed phrases; no BS58_PRIVATE_KEY exists in
// this application. The API key is read from process.env server-side only and
// is never returned, logged, or sent to the browser.
//
// FAIL-CLOSED: every layer validates exact mints, positive output, present
// transaction/requestId, configured safety caps, and independently re-verifies
// the landed transaction on-chain before any reward funding is permitted.

import { getEnv } from '../../config/env.ts';
import { mainnetRpcUrl } from '../providers/alchemy.ts';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
/** The pinned, verified NVDAx mint (must match the program constant + env). */
export const NVDAX_MINT_PINNED = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';
/** The authoritative NVDAx reward vault PDA (never the legacy 8VAgâ€¦ address). */
export const NVDAX_VAULT_PINNED = 'FjHvKANRhMrz9VK72DbA19N6HpbrPVhGKCYnvV6oMUMK';
export const SOLFLOW_PROGRAM_ID = 'DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ';

export interface SwapSafetyConfig {
  maxPriceImpactBps: number | null;
  /** Minimum acceptable NVDAx raw units out (null = no configured floor). */
  minOutRaw: bigint | null;
  /** Maximum SOL lamports per single swap execution. */
  maxSolPerExecution: number;
}

function intEnv(name: string): number | null {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function swapSafetyConfig(): SwapSafetyConfig {
  return {
    // Conservative default: refuse routes with > 3% price impact unless the
    // operator explicitly configures NVDA_SWAP_MAX_PRICE_IMPACT_BPS.
    maxPriceImpactBps: intEnv('NVDA_SWAP_MAX_PRICE_IMPACT_BPS') ?? 300,
    minOutRaw: intEnv('NVDA_SWAP_MIN_OUT_AMOUNT') !== null ? BigInt(intEnv('NVDA_SWAP_MIN_OUT_AMOUNT') as number) : null,
    // Default cap 1 SOL per execution — never blindly swap all treasury SOL.
    maxSolPerExecution: intEnv('NVDA_SWAP_MAX_SOL_PER_EXECUTION') ?? 1_000_000_000,
  };
}

function jupiterApiKey(): string | null {
  const k = process.env.JUPITER_API_KEY;
  return k && k.length > 0 ? k : null;
}

/** True when NEXT_PUBLIC_NVDA_SWAP_ADAPTER selects the real Jupiter adapter. */
export function jupiterAdapterSelected(): boolean {
  return getEnv().nvdaSwapAdapter === 'jupiter-swap-v2';
}

export interface LivePrereqs {
  ok: boolean;
  reasons: string[];
}

/** Mainnet-safety gate (task 16) — anything missing fails closed. */
export function jupiterLivePrereqs(): LivePrereqs {
  const env = getEnv();
  const reasons: string[] = [];
  if (env.demoMode) reasons.push('NEXT_PUBLIC_DEMO_MODE=true — live execution is disabled in demo mode.');
  if (!jupiterAdapterSelected()) reasons.push('NEXT_PUBLIC_NVDA_SWAP_ADAPTER must be "jupiter-swap-v2" (got ' + (env.nvdaSwapAdapter ?? 'unset') + ').');
  if (!jupiterApiKey()) reasons.push('JUPITER_API_KEY is not configured (server-side only).');
  if (!process.env.ADMIN_WALLET) reasons.push('ADMIN_WALLET (operator wallet) is not configured.');
  if (!mainnetRpcUrl()) reasons.push('Mainnet RPC is unavailable (ALCHEMY_API_KEY required).');
  const nvdaMint = (env.nvdaMint ?? '').trim();
  if (nvdaMint !== NVDAX_MINT_PINNED) reasons.push('NEXT_PUBLIC_NVDA_MINT does not match the pinned verified NVDAx mint.');
  return { ok: reasons.length === 0, reasons };
}

/** Operator/admin wallet (server-side only). */
export function operatorWallet(): string | null {
  const w = process.env.ADMIN_WALLET;
  return w && w.length > 0 ? w.trim() : null;
}

/** Server-side authorization: connected wallet must be the configured operator. */
export function isAuthorizedOperator(wallet: string | null | undefined): boolean {
  const op = operatorWallet();
  return !!op && !!wallet && wallet.trim() === op;
}

// ---------- normalised Jupiter types ----------

export interface JupiterOrder {
  requestId: string;
  transaction: string; // base64 unsigned transaction (versioned)
  inAmount: string;
  outAmount: string;
  router: string;
  priceImpactBps: number | null;
  slippageBps: number | null;
}

export type JupiterFailureCode =
  | 'NETWORK_ERROR'
  | 'NO_ROUTE'
  | 'MISSING_REQUEST_ID'
  | 'MISSING_TRANSACTION'
  | 'ZERO_OUTPUT'
  | 'PRICE_IMPACT'
  | 'API_ERROR'
  | 'EXPIRED_REQUEST'
  | 'INVALID_SIGNED_TRANSACTION'
  | 'FAILED_LANDING'
  | 'INCOMPLETE_SIGNATURE'
  | 'INSUFFICIENT_SOL'
  | 'EXECUTION_FAILED';

export class JupiterError extends Error {
  code: JupiterFailureCode;
  detail?: unknown;
  constructor(code: JupiterFailureCode, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}
