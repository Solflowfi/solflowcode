import { NextResponse } from 'next/server';
import { validateInfrastructure } from '@/lib/validation/infrastructure';

export const dynamic = 'force-dynamic';

/**
 * Server-side infrastructure validation. Performs REAL on-chain checks via
 * RPC (account existence, SPL mint validity, program deployment). Results
 * drive the 3-state ModeBanner and /admin status cards. No secrets returned.
 */
export async function GET() {
  try {
    const status = await validateInfrastructure();
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json(
      {
        mode: 'demo',
        liveReady: false,
        missing: ['Infrastructure validation failed'],
        components: [],
        error: e instanceof Error ? e.message : 'Live data unavailable',
      },
      { status: 200 }
    );
  }
}
