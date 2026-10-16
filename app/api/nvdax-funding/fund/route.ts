import { NextResponse } from 'next/server';
import { jupiterLivePrereqs, isAuthorizedOperator, NVDAX_VAULT_PINNED } from '@/lib/server/jupiter';
import { sendAndConfirmFunding } from '@/lib/server/jupiter-fund';
import { analyzeFundingTransaction } from '@/lib/server/jupiter-verify';
import { conversionStore, getRecord, listRecords, markFunded } from '@/lib/server/conversion-records';

export const dynamic = 'force-dynamic';

/**
 * POST /api/nvdax-funding/fund
 * OPERATOR-ONLY. Receives the operator-signed fund_spl_rewards transaction,
 * submits it to mainnet RPC, then independently verifies via RPC that the
 * authoritative NVDAx reward vault (FjHv…) actually received the exact
 * pinned NVDAx mint. Only then is the conversion marked funded.
 * Duplicate funding signatures / already-funded conversions are rejected.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; requestId?: string; signedTransaction?: string };
  if (!isAuthorizedOperator(body.wallet)) {
    return NextResponse.json({ ok: false, error: 'Not authorized. Connected wallet is not the configured operator (ADMIN_WALLET).' }, { status: 403 });
  }
  const prereqs = jupiterLivePrereqs();
  if (!prereqs.ok) {
    return NextResponse.json({ ok: false, error: 'Live funding unavailable (fail closed).', reasons: prereqs.reasons }, { status: 412 });
  }
  const { requestId, signedTransaction } = body;
  if (!requestId || !signedTransaction) {
    return NextResponse.json({ ok: false, error: 'Missing requestId or signedTransaction.' }, { status: 400 });
  }
  const store = conversionStore();
  const rec = getRecord(store, requestId);
  if (!rec) return NextResponse.json({ ok: false, error: 'Unknown conversion requestId.' }, { status: 404 });
  if (rec.status === 'funded') {
    return NextResponse.json({ ok: false, error: 'Conversion already funded — duplicate funding rejected.' }, { status: 409 });
  }
  if (rec.status !== 'confirmed' || rec.verifiedOutRaw === null) {
    return NextResponse.json({ ok: false, error: 'Conversion is ' + rec.status + ' — funding requires an independently verified swap.' }, { status: 409 });
  }

  const send = await sendAndConfirmFunding(signedTransaction);
  if (!send.signature) {
    return NextResponse.json({ ok: false, error: send.error ?? 'Funding transaction was not accepted.' }, { status: 502 });
  }
  if (!send.tx) {
    // Submitted but not yet visible: NOT funded; the operator can re-check.
    return NextResponse.json({ ok: false, error: send.error ?? 'Funding transaction not yet confirmed.', fundingSignature: send.signature, status: 'submitted' }, { status: 502 });
  }

  const verification = analyzeFundingTransaction(send.tx, {
    vaultAddress: NVDAX_VAULT_PINNED,
    expectedRaw: rec.verifiedOutRaw,
  });
  if (!verification.ok) {
    return NextResponse.json(
      { ok: false, error: verification.error ?? 'Vault funding could not be verified.', fundingSignature: send.signature },
      { status: 502 },
    );
  }
  markFunded(store, requestId, send.signature);

  return NextResponse.json({
    ok: true,
    requestId,
    fundingSignature: send.signature,
    vault: NVDAX_VAULT_PINNED,
    nvdaRawFunded: verification.nvdaRawFunded.toString(),
    status: 'funded',
  });
}

/**
 * GET /api/nvdax-funding/fund?wallet=… — operator-only audit trail of
 * recent conversions (statuses, signatures, amounts).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!isAuthorizedOperator(searchParams.get('wallet'))) {
    return NextResponse.json({ ok: false, error: 'Not authorized.' }, { status: 403 });
  }
  const store = conversionStore();
  return NextResponse.json({ ok: true, conversions: listRecords(store) });
}
