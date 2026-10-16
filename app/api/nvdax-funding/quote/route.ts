import { NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import { JupiterError, jupiterLivePrereqs, isAuthorizedOperator, operatorWallet } from '@/lib/server/jupiter';
import { createJupiterOrder } from '@/lib/server/jupiter-order';
import { conversionStore, createRecord, markAwaitingSignature } from '@/lib/server/conversion-records';

export const dynamic = 'force-dynamic';

/**
 * POST /api/nvdax-funding/quote
 * OPERATOR-ONLY. Requests a Jupiter Swap API v2 order for the configured
 * operator wallet and stores a conversion record. Returns ONLY the unsigned
 * transaction + requestId + quote metadata — never keys, never the API key.
 * Fails closed on any missing prerequisite, safety cap violation, or
 * malformed Jupiter response.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; amountSol?: number; amountLamports?: number };
  if (!isAuthorizedOperator(body.wallet)) {
    return NextResponse.json({ ok: false, error: 'Not authorized. Connected wallet is not the configured operator (ADMIN_WALLET).' }, { status: 403 });
  }
  const env = getEnv();
  const prereqs = jupiterLivePrereqs();
  if (!prereqs.ok) {
    return NextResponse.json({ ok: false, error: 'Live conversion unavailable (fail closed).', reasons: prereqs.reasons }, { status: 412 });
  }
  // amountSol is in SOL (UI); convert to lamports server-side. Accept raw
  // lamports too when amountLamports is provided (exactness matters).
  let lamports: number;
  if (typeof body.amountLamports === 'number' && Number.isFinite(body.amountLamports)) {
    lamports = Math.floor(body.amountLamports);
  } else if (typeof body.amountSol === 'number' && Number.isFinite(body.amountSol)) {
    lamports = Math.round(body.amountSol * 1_000_000_000);
  } else {
    return NextResponse.json({ ok: false, error: 'Missing amountSol.' }, { status: 400 });
  }

  try {
    const order = await createJupiterOrder(lamports);
    const store = conversionStore();
    const rec = createRecord(store, {
      requestId: order.requestId,
      operatorWallet: operatorWallet() as string,
      inputLamports: Number(BigInt(order.inAmount || String(lamports))),
      quotedOutRaw: BigInt(order.outAmount),
      nvdaMint: env.nvdaMint as string,
      router: order.router,
      priceImpactBps: order.priceImpactBps,
    });
    markAwaitingSignature(store, order.requestId);
    return NextResponse.json({
      ok: true,
      requestId: order.requestId,
      transaction: order.transaction, // UNSIGNED base64 — operator signs locally
      inAmount: order.inAmount,
      outAmount: order.outAmount,
      router: order.router,
      priceImpactBps: order.priceImpactBps,
      slippageBps: order.slippageBps,
      status: rec.status,
    });
  } catch (e) {
    if (e instanceof JupiterError) {
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: 502 });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Order request failed.' }, { status: 500 });
  }
}
