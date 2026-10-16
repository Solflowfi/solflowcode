'use client';

import { useEffect, useState } from 'react';
import type { InfrastructureStatus } from '@/types';

/**
 * Environment-matrix banner driven by server-side infrastructure validation:
 *  1. DEMO                - demo mode active
 *  2. MAINNET STAGING     - staging mode: STAKING NOT READY (prereqs missing)
 *                           or ready (STAKING TOKEN: $TST)
 *  3. MAINNET PRODUCTION  - live set but infrastructure missing/invalid, or
 *                           every component verified on-chain
 * Staging NEVER displays as "LIVE MODE". Never silently falls back to demo data.
 */
export function ModeBanner() {
  const [mode, setMode] = useState<'demo' | 'live' | 'staging' | null>(null);
  const [infra, setInfra] = useState<InfrastructureStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/infrastructure', { cache: 'no-store' });
        const data = (await res.json()) as InfrastructureStatus;
        if (!cancelled) {
          setInfra(data);
          setMode(data.mode);
        }
      } catch {
        if (!cancelled) setMode(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode === null) return null;

  if (mode === 'demo') {
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs font-semibold tracking-wide text-center py-2 px-4">
        DEMO MODE — NO REAL FUNDS. All figures below are simulated. Configure a deployed program for live operation.
      </div>
    );
  }

  if (mode === 'staging') {
    if (infra && !infra.liveReady) {
      const programMissing = infra.missing.some((m) => m.toLowerCase().includes('program'));
      return (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs font-semibold tracking-wide text-center py-2 px-4">
          MAINNET STAGING — STAKING NOT READY.{' '}
          {programMissing
            ? 'Staging program is not deployed on Mainnet yet.'
            : 'Missing: ' + (infra.missing.join(' · ') || 'staging prerequisites') + '.'}{' '}
          Staking activates as soon as every staging prerequisite verifies on-chain.
        </div>
      );
    }
    return (
      <div className="bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-300 text-xs font-semibold tracking-wide text-center py-2 px-4">
        MAINNET STAGING — STAKING TOKEN: $TST. Real Solana mainnet transactions via the dedicated staging program. Rewards are not distributed in staging.
      </div>
    );
  }

  if (infra && !infra.liveReady) {
    // Operator request: the red "CONFIGURATION INCOMPLETE" banner is hidden.
    // Live data remains blocked by the data layer (never fabricated); only the
    // banner display is suppressed.
    return null;
  }

  return (
    <div className="bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-300 text-xs font-semibold tracking-wide text-center py-2 px-4">
      MAINNET PRODUCTION — reading real Solana data via verified infrastructure.
    </div>
  );
}
