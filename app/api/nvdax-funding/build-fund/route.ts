import { NextResponse } from 'next/server';
import { getEnv } from '@/config/env';
import { jupiterLivePrereqs, isAuthorizedOperator, NVDAX_MINT_PINNED, operatorWallet, SOLFLOW_PROGRAM_ID } from '@/lib/server/jupiter';
import { buildFundSplTransaction, deriveFundSplAccounts } from '@/lib/server/jupiter-fund';
import { serverGetAccountRawMainnet } from '@/lib/providers/alchemy';
import { conversionStore, getRecord } from '@/lib/server/conversion-records';

export const dynamic = 'force-dynamic';

const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';

/**
 * POST /api/nvdax-funding/build-fund
 * OPERATOR-ONLY. Builds the UNSIGNED fund_spl_rewards transaction for the
 * exact NVDAx amount verified on-chain after the swap. Mainnet-safety
 * prechecks: program deployed, vault PDA matches the authoritative address,
 * operator ATA exists. The operator signs; /api/nvdax-funding/fund submits.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { wallet?: string; requestId?: string; amountRaw?: string };
  if (!isAuthorizedOperator(body.wallet)) {
    return NextResponse.json({ ok: false, error: 'Not authorized. Connected wallet is not the configured operator (ADMIN_WALLET).' }, { status: 403 });
  }
  const env = getEnv();
  const prereqs = jupiterLivePrereqs();
  if (!prereqs.ok) {
    return NextResponse.json({ ok: false, error: 'Live funding unavailable (fail closed).', reasons: prereqs.reasons }, { status: 412 });
  }
  const { requestId, amountRaw } = body;
  if (!requestId) return NextResponse.json({ ok: false, error: 'Missing requestId.' }, { status: 400 });

  const store = conversionStore();
  const rec = getRecord(store, requestId);
  if (!rec) return NextResponse.json({ ok: false, error: 'Unknown conversion requestId.' }, { status: 404 });
  if (rec.status !== 'confirmed') {
    return NextResponse.json({ ok: false, error: 'Conversion is ' + rec.status + ' — funding is only allowed after independent on-chain verification of the swap.' }, { status: 409 });
  }

  // Exact amount: the verified on-chain NVDAx receipt, never a frontend number.
  const expectedRaw = typeof amountRaw === 'string' && amountRaw.length > 0 ? BigInt(amountRaw) : (rec.verifiedOutRaw ?? 0n);
  if (expectedRaw <= 0n) {
    return NextResponse.json({ ok: false, error: 'No verified NVDAx amount available for funding.' }, { status: 422 });
  }
  if (rec.verifiedOutRaw === null || expectedRaw > rec.verifiedOutRaw) {
    return NextResponse.json({ ok: false, error: 'Requested funding amount exceeds the independently verified NVDAx receipt.' }, { status: 422 });
  }

  const operator = operatorWallet() as string;

  // Mainnet-safety: the SOLFLOW program must actually be deployed on mainnet
  // (it is currently devnet-only — funding fails closed until it is).
  try {
    const info = await serverGetAccountRawMainnet(SOLFLOW_PROGRAM_ID);
    const deployed = !!info && info.exists && info.owner === BPF_LOADER_UPGRADEABLE && info.executable;
    if (!deployed) {
      return NextResponse.json(
        { ok: false, error: 'SOLFLOW program is NOT deployed on mainnet — fund_spl_rewards cannot be executed (fail closed). The swap can be verified, but reward funding requires the mainnet program.' },
        { status: 412 },
      );
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Mainnet program check failed: ' + (e instanceof Error ? e.message : 'RPC error') }, { status: 502 });
  }

  // Vault PDA cross-check + operator ATA existence.
  let accounts;
  try {
    accounts = deriveFundSplAccounts(SOLFLOW_PROGRAM_ID, operator);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Vault derivation failed.' }, { status: 412 });
  }
  try {
    const ata = await serverGetAccountRawMainnet(accounts.funderAta);
    if (!ata || !ata.exists) {
      return NextResponse.json(
        { ok: false, error: 'Operator NVDAx (Token-2022) associated token account does not exist on mainnet. Create it (a swap will create it automatically) and retry.' },
        { status: 412 },
      );
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'Operator ATA check failed: ' + (e instanceof Error ? e.message : 'RPC error') }, { status: 502 });
  }

  try {
    const built = buildFundSplTransaction(SOLFLOW_PROGRAM_ID, operator, expectedRaw);
    return NextResponse.json({
      ok: true,
      requestId,
      amountRaw: expectedRaw.toString(),
      nvdaMint: NVDAX_MINT_PINNED,
      vault: accounts.vault,
      transaction: built.transactionBase64, // UNSIGNED — operator signs locally
      accounts,
      network: env.network,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Failed to build funding transaction.' }, { status: 500 });
  }
}
