import { NextResponse } from 'next/server';
import { getMode } from '@/lib/mode';
import {
  claimAll,
  claimAsset,
  demoFlowBalance,
  distributeFees,
  getOrCreateStaker,
  stake,
  unstake,
  userRewardViews,
} from '@/lib/solana/rewards';
import { FLOW_DIVISOR } from '@/lib/solana/tokens';
import { getDemoState } from '@/lib/data';

export const dynamic = 'force-dynamic';

// Raw-unit scale for FLOW staking amounts (demo accounting, 9 decimals).
const FLOW_SCALE = FLOW_DIVISOR;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  if (!wallet) {
    return NextResponse.json({ error: 'wallet parameter required' }, { status: 400 });
  }
  const mode = getMode();
  if (mode !== 'demo') {
    return NextResponse.json(
      { error: 'Live data unavailable', available: false },
      { status: 503 }
    );
  }
  const state = getDemoState();
  const assets = userRewardViews(state, wallet);
  const user = getOrCreateStaker(state, wallet);
  return NextResponse.json({
    address: wallet,
    demo: true,
    // Staking position + wallet balance are denominated in $FLOW (staking token).
    staked: (user.shares / FLOW_SCALE).toString(10),
    asset: 'FLOW',
    flowBalance: (demoFlowBalance(state, wallet) / FLOW_SCALE).toString(10),
    assets,
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    op?: string;
    wallet?: string;
    /** FLOW amount (UI units) for stake/unstake. */
    amount?: number;
    asset?: string;
  } | null;
  if (!body || !body.op || !body.wallet) {
    return NextResponse.json({ ok: false, error: 'op and wallet required' }, { status: 400 });
  }
  const mode = getMode();
  if (mode !== 'demo') {
    return NextResponse.json(
      { ok: false, error: 'Live staking requires a deployed SOLFLOW program. Program is not configured.' },
      { status: 501 }
    );
  }
  const state = getDemoState();
  const wallet = body.wallet;
  try {
    if (body.op === 'stake') {
      // Stake $FLOW — never SOL.
      const amt = typeof body.amount === 'number' ? BigInt(Math.floor(body.amount * Number(FLOW_SCALE))) : 0n;
      if (amt <= 0n) return NextResponse.json({ ok: false, error: 'Amount must be greater than zero.' }, { status: 400 });
      stake(state, wallet, amt);
      return NextResponse.json({ ok: true, demo: true, signature: null });
    }
    if (body.op === 'unstake') {
      // Unstake $FLOW — pending rewards are synced inside the engine first.
      const amt = typeof body.amount === 'number' ? BigInt(Math.floor(body.amount * Number(FLOW_SCALE))) : 0n;
      if (amt <= 0n) return NextResponse.json({ ok: false, error: 'Amount must be greater than zero.' }, { status: 400 });
      unstake(state, wallet, amt);
      return NextResponse.json({ ok: true, demo: true, signature: null });
    }
    if (body.op === 'claim') {
      const symbol = body.asset ?? 'SOL';
      const claimed = claimAsset(state, wallet, symbol);
      return NextResponse.json({ ok: true, demo: true, signature: null, claimed: claimed.toString() });
    }
    if (body.op === 'claimAll') {
      const out = claimAll(state, wallet);
      return NextResponse.json({ ok: true, demo: true, signature: null, claimed: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toString()])) });
    }
    if (body.op === 'fundFees') {
      // DEMO-ONLY: simulate verified creator-fee revenue entering the reward
      // engine (70/30 SOL/NVDAx allocation). Rejected outside demo mode; this
      // never touches real funds and never invents the NVDAx mint — when the
      // NVDAx mint is unconfigured its 30% share is retained as unallocated.
      const fees = typeof body.amount === 'number' ? BigInt(Math.floor(body.amount * Number(FLOW_SCALE))) : 0n;
      if (fees <= 0n) return NextResponse.json({ ok: false, error: 'Amount must be greater than zero.' }, { status: 400 });
      const out = distributeFees(state, fees);
      return NextResponse.json({ ok: true, demo: true, funded: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toString()])) });
    }
    return NextResponse.json({ ok: false, error: 'Unknown operation' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Operation failed' }, { status: 400 });
  }
}
