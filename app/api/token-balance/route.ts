import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt } from '@/lib/providers/alchemy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/token-balance?wallet=<pubkey>&mint=<pubkey>
 * Server-side SPL/Token-2022 token account balance via the keyed RPC.
 * A missing token account is a VALID zero-balance state (never an error).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = (searchParams.get('wallet') ?? '').trim();
  const mint = (searchParams.get('mint') ?? '').trim();
  let walletKey: PublicKey;
  let mintKey: PublicKey;
  try {
    walletKey = new PublicKey(wallet);
    mintKey = new PublicKey(mint);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid wallet or mint public key.' }, { status: 400 });
  }
  const url = mainnetRpcUrl() ?? resolveRpcUrl();
  if (!url) return NextResponse.json({ ok: false, error: 'RPC unavailable.' }, { status: 503 });

  const mintInfo = await serverRpcAt<{ value: { owner: string; data: [string, string] } | null }>(
    url, 'getAccountInfo', [mintKey.toBase58(), { encoding: 'base64' }],
  );
  if (!mintInfo.value) {
    return NextResponse.json({ ok: false, error: 'Mint account does not exist.' }, { status: 404 });
  }
  const tokenProgram = mintInfo.value.owner;
  // ATA derivation for either token program:
  const ata = PublicKey.findProgramAddressSync(
    [walletKey.toBuffer(), new PublicKey(tokenProgram).toBuffer(), mintKey.toBuffer()],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  )[0];
  try {
    const acc = await serverRpcAt<{ value: { data: [string, string] } | null }>(
      url, 'getAccountInfo', [ata.toBase58(), { encoding: 'base64' }],
    );
    if (!acc.value) {
      return NextResponse.json({ ok: true, wallet: walletKey.toBase58(), mint: mintKey.toBase58(), ata: ata.toBase58(), exists: false, balanceRaw: '0', decimals: null });
    }
    const data = Buffer.from(acc.value.data[0], 'base64');
    // Token account layout: amount at byte 64..72 (u64 LE) for both programs.
    const amount = data.length >= 72 ? data.readBigUInt64LE(64) : 0n;
    let decimals: number | null = null;
    const mintData = Buffer.from(mintInfo.value.data[0], 'base64');
    if (mintData.length >= 45) decimals = mintData[44];
    return NextResponse.json({
      ok: true,
      wallet: walletKey.toBase58(),
      mint: mintKey.toBase58(),
      ata: ata.toBase58(),
      exists: true,
      balanceRaw: amount.toString(),
      decimals,
      tokenProgram,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Token balance lookup failed: ' + String(e instanceof Error ? e.message : e).slice(0, 160) },
      { status: 502 },
    );
  }
}
