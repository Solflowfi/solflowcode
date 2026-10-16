import { NextResponse } from 'next/server';
import { getAnalytics } from '@/lib/data';
import { getMode } from '@/lib/mode';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = (searchParams.get('range') ?? '7D').toUpperCase();
  const range = (['24H', '7D', '30D', '90D', 'ALL'].includes(rangeParam) ? rangeParam : '7D') as '24H' | '7D' | '30D' | '90D' | 'ALL';
  try {
    const series = getAnalytics(range);
    return NextResponse.json({ mode: getMode(), range, ...series });
  } catch (e) {
    return NextResponse.json({ mode: getMode(), range, points: [], source: 'live', error: e instanceof Error ? e.message : 'Live data unavailable' });
  }
}
