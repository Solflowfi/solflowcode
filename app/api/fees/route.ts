import { NextResponse } from 'next/server';
import { getProtocolData } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = getProtocolData();
  return NextResponse.json({
    mode: data.mode,
    feeEngine: data.feeEngine,
    sources: data.sources,
    error: data.error ?? null,
  });
}
