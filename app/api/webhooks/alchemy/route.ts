import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Alchemy webhook receiver (server-side) — prepared, NOT activated.
 *
 * Real-time architecture once ALCHEMY_SOLANA_WS_URL / Alchemy webhooks are
 * configured by the operator:
 *
 *   Creator Fee Source
 *     -> Alchemy Solana WebSocket / webhook
 *       -> SOLFLOW server (this route)
 *         -> transaction verification (serverGetTransaction via Alchemy RPC)
 *           -> creator-fee classification (source + destination + amount +
 *              success + slot all validated)
 *             -> reward engine
 *
 * Payloads are NEVER trusted blindly. Every incoming transaction must be
 * re-verified against the chain via standard Solana RPC before it affects
 * reward accounting. No accounting side effects occur until the operator
 * configures fee sources, vaults and the deployed program.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Array<{
    webhookId?: string;
    type?: string;
    event?: { signature?: string; slot?: number };
  }> | null;

  if (!Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
  }

  // Phase 1: acknowledge and queue for on-chain re-verification. No reward
  // side effects until live-mode gating is satisfied.
  for (const item of body) {
    const sig = item?.event?.signature;
    if (sig) {
      console.log('[solflow:alchemy-webhook] queued for verification:', sig);
    }
  }

  return NextResponse.json({ ok: true, validated: 0, pending: body.length });
}
