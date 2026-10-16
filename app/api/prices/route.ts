import { NextResponse } from 'next/server';
import { getPriceProvider } from '@/lib/providers/price-provider';

export const dynamic = 'force-dynamic';

export async function GET() {
  const provider = getPriceProvider();
  try {
    const [sol, nvda] = await Promise.all([provider.getSolPrice(), provider.getNvdaTokenPrice()]);
    return NextResponse.json({ sol, nvda, unavailable: sol === null });
  } catch {
    return NextResponse.json({ sol: null, nvda: null, unavailable: true });
  }
}
