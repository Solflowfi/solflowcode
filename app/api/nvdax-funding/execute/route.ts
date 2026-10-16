import { NextResponse } from 'next/server';
import { jupiterLivePrereqs, isAuthorizedOperator, operatorWallet } from '@/lib/server/jupiter';
import { executeJupiterSwap } from '@/lib/server/jupiter-order';
import { analyzeSwapTransaction, fetchTransactionInfo } from '@/lib/server/jupiter-verify';
import { conversionStore, getRecord, markConfirmed, markFailed, markSubmitted } from '@/lib/server/conversion-records';

export const dynamic = 'force-dynamic';

/**
 * POST /api/nvdax-funding/execute
 * OPERATOR-ONLY. Receives the operator-signed swap transaction (Phantom
 * signed locally), relays it to Jupiter /execute, then INDEPENDENTLY
 * verifies the landed transaction on-chain (signer, SOL debit, exact NVDAx
 * mint received by the operator). Funding stays locked until this
 * verification passes.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; requestId?: string; signedTransaction?: string };
  if (!isAuthorizedOperator(body.wallet)) {
    return NextResponse.json({ ok: false, error: 'Not authorized. Connected wallet is not the configured operator (ADMIN_WALLET).' }, { status: 403 });
  }
  const prereqs = jupiterLivePrereqs();
  if (!prereqs.ok) {
    return NextResponse.json({ ok: false, error: 'Live conversion unavailable (fail closed).', reasons: prereqs.reasons }, { status: 412 });
  }
  const { requestId, signedTransaction } = body;
  if (!requestId || !signedTransaction) {
    return NextResponse.json({ ok: false, error: 'Missing requestId or signedTransaction.' }, { status: 400 });
  }
  const store = conversionStore();
  const rec = getRecord(store, requestId);
  if (!rec) {
    return NextResponse.json({ ok: false, error: 'Unknown conversion requestId.' }, { status: 404 });
  }
  if (rec.operatorWallet !== operatorWallet()) {
    return NextResponse.json({ ok: false, error: 'Conversion was requested for a different operator wallet.' }, { status: 403 });
  }
  if (rec.status !== 'quoted' && rec.status !== 'awaiting_signature') {
    return NextResponse.json({ ok: false, error: 'Conversion is ' + rec.status + ' — cannot execute again.' }, { status: 409 });
  }

  // 1) Jupiter execute (managed landing).
  const result = await executeJupiterSwap(requestId, signedTransaction);
  if (!result.ok || !result.signature) {
    markFailed(store, requestId, result.message);
    return NextResponse.json({ ok: false, error: result.message, code: result.code }, { status: 502 });
  }

  // 2) Record the submission (single-use swap signature; replay rejected).
  try {
    markSubmitted(store, requestId, result.signature);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Replay protection rejected the swap.' }, { status: 409 });
  }

  // 3) Independent on-chain verification — never trust Jupiter alone.
  const tx = await fetchTransactionInfo(result.signature);
  const verification = analyzeSwapTransaction(tx, { taker: operatorWallet() as string });
  if (!verification.ok) {
    markFailed(store, requestId, verification.error ?? 'On-chain verification failed.');
    return NextResponse.json(
      { ok: false, error: verification.error ?? 'On-chain verification failed.', swapSignature: result.signature },
      { status: 502 },
    );
  }
  markConfirmed(store, requestId, verification.nvdaRawReceived);

  return NextResponse.json({
    ok: true,
    requestId,
    swapSignature: result.signature,
    solDebitedLamports: verification.solDebited.toString(),
    nvdaRawReceived: verification.nvdaRawReceived.toString(),
    status: 'confirmed',
  });
}
