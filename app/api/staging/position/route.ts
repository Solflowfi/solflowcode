import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getEnv } from '@/config/env';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt } from '@/lib/providers/alchemy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/staging/position?wallet=<pubkey>
 * Reads the caller's STAGING program position PDA (seed 'position') from
 * mainnet. Account layout: 8-byte discriminator + 32-byte owner + u64 shares
 * (offset 40..48). A missing position is a VALID zero state (first-time
 * staker), never an error. No balances or rewards are fabricated.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = (searchParams.get('wallet') ?? '').trim();
  let walletKey: PublicKey;
  try {
    walletKey = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid wallet public key.' }, { status: 400 });
  }
  const env = getEnv();
  const stagingProgram = env.stagingProgramId ?? '';
  if (!stagingProgram) {
    return NextResponse.json({ ok: true, stagingActive: false, exists: false, sharesRaw: '0' });
  }
  const rpc = mainnetRpcUrl() ?? resolveRpcUrl();
  if (!rpc) return NextResponse.json({ ok: false, error: 'RPC unavailable.' }, { status: 503 });

  const position = PublicKey.findProgramAddressSync(
    [Buffer.from('position'), walletKey.toBuffer()],
    new PublicKey(stagingProgram),
  )[0];
  try {
    const r = await serverRpcAt<{ value: { data: [string, string] } | null }>(
      rpc, 'getAccountInfo', [position.toBase58(), { encoding: 'base64' }],
    );
    if (!r.value) {
      return NextResponse.json({ ok: true, stagingActive: true, position: position.toBase58(), exists: false, sharesRaw: '0' });
    }
    const data = Buffer.from(r.value.data[0], 'base64');
    if (data.length < 48) {
      return NextResponse.json({ ok: true, stagingActive: true, position: position.toBase58(), exists: false, sharesRaw: '0' });
    }
    const shares = data.readBigUInt64LE(40);
    return NextResponse.json({
      ok: true,
      stagingActive: true,
      position: position.toBase58(),
      exists: true,
      sharesRaw: shares.toString(),
      program: stagingProgram,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Position lookup failed: ' + String(e instanceof Error ? e.message : e).slice(0, 160) },
      { status: 502 },
    );
  }
}
