// Jupiter Swap API v2 order/execute client — SERVER ONLY.
import { VersionedTransaction } from '@solana/web3.js';
import { getEnv } from '../../config/env.ts';
import {
  JupiterError,
  NVDAX_MINT_PINNED,
  SOL_MINT,
  jupiterAdapterSelected,
  operatorWallet,
  swapSafetyConfig,
  type JupiterFailureCode,
  type JupiterOrder,
  type SwapSafetyConfig,
} from './jupiter.ts';

const JUP_SWAP_BASE = 'https://api.jup.ag/swap/v2';

function jupiterApiKey(): string | null {
  const k = process.env.JUPITER_API_KEY;
  return k && k.length > 0 ? k : null;
}

export type FetchImpl = typeof fetch;
export interface Deps {
  fetchImpl?: FetchImpl;
}
function pickFetch(deps?: Deps): FetchImpl {
  return (deps && deps.fetchImpl) || fetch;
}

export function validateOrderResponse(raw: unknown, lamportsIn: number, safety: SwapSafetyConfig): JupiterOrder {
  const r = (raw ?? {}) as Record<string, unknown>;
  const requestId = typeof r.requestId === 'string' ? r.requestId : '';
  const transaction = typeof r.transaction === 'string' ? r.transaction : '';
  const outAmount = typeof r.outAmount === 'string' ? r.outAmount : '';
  const inAmount = typeof r.inAmount === 'string' ? r.inAmount : '';
  const router = typeof r.router === 'string' && r.router.length > 0 ? r.router : 'unknown';

  if (!requestId) throw new JupiterError('MISSING_REQUEST_ID', 'Jupiter order response has no requestId.');
  if (!transaction) throw new JupiterError('MISSING_TRANSACTION', 'Jupiter returned no transaction ("" or null) — swap unavailable; not attempting signing.');
  const outRaw = BigInt(outAmount === '' ? '0' : outAmount);
  if (outRaw <= 0n) throw new JupiterError('ZERO_OUTPUT', 'Jupiter order output amount is zero — swap refused.');
  if (safety.minOutRaw !== null && outRaw < safety.minOutRaw) {
    throw new JupiterError('ZERO_OUTPUT', 'Jupiter order output ' + outAmount + ' is below the configured NVDA_SWAP_MIN_OUT_AMOUNT floor.');
  }
  let priceImpactBps: number | null = null;
  if (typeof r.priceImpactBps === 'number') {
    priceImpactBps = r.priceImpactBps;
  } else if (typeof r.priceImpactPct === 'string' || typeof r.priceImpactPct === 'number') {
    const pct = Number(r.priceImpactPct);
    if (Number.isFinite(pct)) priceImpactBps = Math.round(pct * 10_000);
  }
  if (safety.maxPriceImpactBps !== null) {
    if (priceImpactBps === null) {
      throw new JupiterError('PRICE_IMPACT', 'Jupiter order did not report a price impact — refusing to proceed (fail closed).');
    }
    if (priceImpactBps > safety.maxPriceImpactBps) {
      throw new JupiterError('PRICE_IMPACT', 'Price impact ' + priceImpactBps + ' bps exceeds NVDA_SWAP_MAX_PRICE_IMPACT_BPS=' + safety.maxPriceImpactBps + '.');
    }
  }
  if (inAmount && BigInt(inAmount) !== BigInt(lamportsIn)) {
    throw new JupiterError('API_ERROR', 'Jupiter order inAmount does not match the requested input amount.');
  }
  return { requestId, transaction, inAmount, outAmount, router, priceImpactBps, slippageBps: typeof r.slippageBps === 'number' ? r.slippageBps : null };
}

/** GET /order — validated, safety-checked, fail-closed. */
export async function createJupiterOrder(lamportsIn: number, deps?: Deps): Promise<JupiterOrder> {
  if (!jupiterAdapterSelected()) {
    throw new JupiterError('EXECUTION_FAILED', 'NEXT_PUBLIC_NVDA_SWAP_ADAPTER must be "jupiter-swap-v2" (got ' + (getEnv().nvdaSwapAdapter ?? 'unset') + ').');
  }
  if (getEnv().demoMode) {
    throw new JupiterError('EXECUTION_FAILED', 'NEXT_PUBLIC_DEMO_MODE=true — live Jupiter execution is disabled in demo mode.');
  }
  if (!jupiterApiKey()) {
    throw new JupiterError('EXECUTION_FAILED', 'JUPITER_API_KEY is not configured (server-side only).');
  }
  const nvdaMint = (getEnv().nvdaMint ?? '').trim();
  if (nvdaMint !== NVDAX_MINT_PINNED) {
    throw new JupiterError('EXECUTION_FAILED', 'NEXT_PUBLIC_NVDA_MINT does not match the pinned verified NVDAx mint.');
  }
  if (!Number.isFinite(lamportsIn) || lamportsIn <= 0) {
    throw new JupiterError('API_ERROR', 'Swap input amount must be a positive lamport amount.');
  }
  const safety = swapSafetyConfig();
  if (lamportsIn > safety.maxSolPerExecution) {
    throw new JupiterError('API_ERROR', 'Requested input ' + lamportsIn + ' lamports exceeds NVDA_SWAP_MAX_SOL_PER_EXECUTION=' + safety.maxSolPerExecution + '.');
  }
  const op = operatorWallet();
  if (!op) throw new JupiterError('EXECUTION_FAILED', 'ADMIN_WALLET (operator wallet) is not configured.');
  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint: NVDAX_MINT_PINNED,
    amount: String(lamportsIn),
    taker: op,
  });
  const res = await pickFetch(deps)(JUP_SWAP_BASE + '/order?' + params.toString(), {
    headers: { 'x-api-key': jupiterApiKey() as string, accept: 'application/json' },
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    const msg = (body as { error?: string } | null)?.error;
    if (res.status === 400 && typeof msg === 'string' && /route|not routable|no market/i.test(msg)) {
      throw new JupiterError('NO_ROUTE', 'No Jupiter route exists for SOL -> NVDAx at this size.', body);
    }
    throw new JupiterError('API_ERROR', 'Jupiter /order failed: HTTP ' + res.status + (msg ? ' — ' + msg : ''), body);
  }
  return validateOrderResponse(await res.json(), lamportsIn, safety);
}

export interface JupiterExecuteResult {
  ok: boolean;
  signature: string | null;
  code: JupiterFailureCode | null;
  message: string;
}

export function classifyExecute(raw: unknown): JupiterExecuteResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const signature = typeof r.signature === 'string' && r.signature.length > 0 ? r.signature : null;
  const status = typeof r.status === 'string' ? r.status.toUpperCase() : '';
  const errObj = (r.error ?? undefined) as { errorCode?: string; errorName?: string; description?: string } | undefined;
  const errName = (typeof r.error === 'string' ? r.error : '') || errObj?.errorName || errObj?.errorCode || '';
  const desc = errObj?.description ?? (typeof r.error === 'string' ? r.error : '');
  if (signature && (status === 'SUCCESS' || status === '' || status === 'CONFIRMED')) {
    return { ok: true, signature, code: null, message: 'Swap executed.' };
  }
  const name = (status || String(errName)).toUpperCase();
  let code: JupiterFailureCode = 'EXECUTION_FAILED';
  if (name.includes('EXPIR')) code = 'EXPIRED_REQUEST';
  else if (name.includes('INVALID_SIGNED')) code = 'INVALID_SIGNED_TRANSACTION';
  else if (name.includes('LANDING') || name.includes('DROPPED')) code = 'FAILED_LANDING';
  else if (name.includes('INCOMPLETE')) code = 'INCOMPLETE_SIGNATURE';
  else if (name.includes('INSUFFICIENT') || name.includes('BALANCE')) code = 'INSUFFICIENT_SOL';
  else if (name.includes('FAILED')) code = 'FAILED_LANDING';
  return { ok: false, signature, code, message: 'Jupiter /execute failed: ' + (name || 'UNKNOWN') + (desc ? ' — ' + desc : '') };
}

/** POST /execute — relays the operator-signed transaction to Jupiter. */
export async function executeJupiterSwap(requestId: string, signedTransaction: string, deps?: Deps): Promise<JupiterExecuteResult> {
  if (!requestId || !signedTransaction) {
    return { ok: false, signature: null, code: 'INVALID_SIGNED_TRANSACTION', message: 'Missing requestId or signedTransaction.' };
  }
  try {
    VersionedTransaction.deserialize(Buffer.from(signedTransaction, 'base64'));
  } catch {
    return { ok: false, signature: null, code: 'INVALID_SIGNED_TRANSACTION', message: 'signedTransaction is not a decodable Solana transaction.' };
  }
  if (!jupiterApiKey()) {
    return { ok: false, signature: null, code: 'EXECUTION_FAILED', message: 'JUPITER_API_KEY is not configured (server-side only).' };
  }
  const res = await pickFetch(deps)(JUP_SWAP_BASE + '/execute', {
    method: 'POST',
    headers: { 'x-api-key': jupiterApiKey() as string, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ signedTransaction, requestId }),
  });
  if (!res.ok) {
    const raw = await res.json().catch(() => null);
    const msg = (raw as { error?: string } | null)?.error;
    return { ok: false, signature: null, code: 'API_ERROR', message: 'Jupiter /execute failed: HTTP ' + res.status + (msg ? ' — ' + msg : '') };
  }
  return classifyExecute(await res.json());
}