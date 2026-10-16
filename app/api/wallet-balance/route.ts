import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt } from '@/lib/providers/alchemy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/wallet-balance?wallet=<pubkey>
 *
 * Server-side wallet SOL balance via the keyed Alchemy mainnet RPC. This is
 * the reliable balance path: the PUBLIC mainnet endpoint
 * (api.mainnet-beta.solana.com) rejects browser-originated JSON-RPC with
 * 403 "Access forbidden" (provider abuse protection), so the browser must
 * not depend on it for balance polling.
 *
 * A nonexistent account is a VALID zero-balance state (Solana getBalance
 * returns 0 for nonexistent accounts) — it is never surfaced as an error.
 * The API key never appears in the response; errors are sanitized.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = (searchParams.get('wallet') ?? '').trim();
  if (!wallet) {
    return NextResponse.json({ ok: false, error: 'Missing wallet parameter.' }, { status: 400 });
  }
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(wallet);
  } catch {
    return NextResponse.json({ ok: false, error: 'wallet is not a valid Solana public key.' }, { status: 400 });
  }

  const url = mainnetRpcUrl() ?? resolveRpcUrl();
  if (!url) {
    return NextResponse.json({ ok: false, error: 'RPC unavailable (server-side provider not configured).' }, { status: 503 });
  }

  try {
    const r = await serverRpcAt<{ context: { slot: number }; value: number }>(url, 'getBalance', [pubkey.toBase58()]);
    const lamports = typeof r?.value === 'number' ? r.value : 0;
    return NextResponse.json({
      ok: true,
      wallet: pubkey.toBase58(),
      // A zero lamport value covers both "empty account" and "account does
      // not exist yet" — both are zero/unavailable balance states, NOT errors.
      balanceLamports: lamports,
      exists: lamports > 0,
      network: 'mainnet-beta',
    });
  } catch (e) {
    // Sanitized: never include the endpoint URL (it contains the API key).
    return NextResponse.json(
      { ok: false, error: 'RPC balance lookup failed (provider rejected the request).', code: 'RPC_BALANCE_FAILED' },
      { status: 502 },
    );
  }
}
