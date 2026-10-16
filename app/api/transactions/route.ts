import { NextResponse } from 'next/server';
import { getActivity } from '@/lib/data';
import { getMode } from '@/lib/mode';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get('wallet');
  const mode = getMode();
  const { rows, error } = getActivity(mode, wallet);
  return NextResponse.json({ mode, rows, error: error ?? null });
}
