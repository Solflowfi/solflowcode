import { NextResponse } from 'next/server';
import { getProtocolData } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = getProtocolData();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { mode: 'live', stats: null, feeEngine: null, sources: [], epochs: [], error: e instanceof Error ? e.message : 'Live data unavailable' },
      { status: 200 }
    );
  }
}
