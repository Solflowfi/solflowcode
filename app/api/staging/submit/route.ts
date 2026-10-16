import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt } from '@/lib/providers/alchemy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/staging/submit
 * Relays an ALREADY-SIGNED staking transaction (Phantom-signed in the browser)
 * to mainnet via the keyed server RPC. The browser's public RPC endpoint often
 * rejects browser-originated sendTransaction with 403 — the keyed server path
 * avoids that. NO server keys exist: the transaction must already carry the
 * user's signature, and preflight checks stay ON.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { signedTransaction?: string };
  const raw = body.signedTransaction;
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'Missing signedTransaction.' }, { status: 400 });
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(raw, 'base64');
    if (bytes.length < 64) throw new Error('too short');
  } catch {
    return NextResponse.json({ ok: false, error: 'signedTransaction is not decodable.' }, { status: 400 });
  }
  const url = mainnetRpcUrl() ?? resolveRpcUrl();
  if (!url) {
    return NextResponse.json({ ok: false, error: 'RPC unavailable (server-side provider not configured).' }, { status: 503 });
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [bytes.toString('base64'), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string; data?: unknown } };
    if (json.error || !json.result) {
      // Sanitized: the preflight error may name accounts but never our key.
      const msg = json.error?.message ?? 'sendTransaction rejected.';
      return NextResponse.json({ ok: false, error: msg.slice(0, 400) }, { status: 502 });
    }
    const signature = json.result;
    // Bounded confirmation wait.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await serverRpcAt<{ value: Array<{ err: unknown } | null> }>(
        url, 'getSignatureStatuses', [[signature], { searchTransactionHistory: false }],
      );
      const status = st.value?.[0] ?? null;
      if (status) {
        if (status.err) {
          return NextResponse.json({ ok: false, error: 'Transaction failed on-chain: ' + JSON.stringify(status.err).slice(0, 300), signature }, { status: 502 });
        }
        return NextResponse.json({ ok: true, signature, confirmed: true });
      }
    }
    return NextResponse.json({ ok: true, signature, confirmed: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Submit failed: ' + String(e instanceof Error ? e.message : e).slice(0, 200) },
      { status: 502 },
    );
  }
}
