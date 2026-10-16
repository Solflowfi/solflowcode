import { NextResponse } from 'next/server';
import { getAdminStats } from '@/lib/data';
import { getMode } from '@/lib/mode';

export const dynamic = 'force-dynamic';

/**
 * Admin data endpoint. Authorization is wallet-based: the connected wallet
 * must be the configured admin (ADMIN_WALLET env, server-side only).
 * Admin capabilities that require authority are executed server-side; no
 * private keys ever reach this route or the browser.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const adminWallet = process.env.ADMIN_WALLET ?? null;

  if (!adminWallet) {
    return NextResponse.json({ authorized: false, error: 'Admin wallet not configured (ADMIN_WALLET).' }, { status: 403 });
  }
  if (!wallet || wallet !== adminWallet) {
    return NextResponse.json({ authorized: false, error: 'Not authorized. Connected wallet is not the admin.' }, { status: 403 });
  }

  try {
    const stats = getAdminStats();
    return NextResponse.json({ authorized: true, mode: getMode(), stats });
  } catch (e) {
    return NextResponse.json({ authorized: true, mode: getMode(), stats: null, error: e instanceof Error ? e.message : 'Live data unavailable' });
  }
}
