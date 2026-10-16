'use client';

import { useEffect, useState } from 'react';
import { getEnv } from '@/config/env';
import { shortAddress, solscanAccount } from '@/lib/format';
import { useProtocolData } from '@/hooks/useProtocolData';
import { Metric } from '@/components/common/Metric';

interface AddrRow {
  label: string;
  address: string | null;
  note: string;
}

export default function TransparencyPage() {
  const env = getEnv();
  const { data, loading } = useProtocolData(30000);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const rows: AddrRow[] = [
    { label: 'Reward Treasury', address: env.rewardTreasury, note: 'Receives eligible creator fees and funds the reward engine.' },
    { label: 'Program ID', address: env.programId, note: 'Deployed SOLFLOW staking/reward program (when configured).' },
    { label: 'SOL Reward Vault', address: env.rewardTreasury, note: 'Holds SOL pending distribution to stakers.' },
    { label: 'NVDA Reward Vault', address: env.nvdaMint ? env.rewardTreasury : null, note: 'Requires NEXT_PUBLIC_NVDA_MINT configuration.' },
    ...env.feeSources.map((addr, i) => ({
      label: `Creator Fee Source ${i + 1}`,
      address: addr,
      note: 'Watched creator-fee source wallet (verify before counting inflows).',
    })),
  ];

  return (
    <div className="container-page py-10">
      <h1 className="display text-3xl mb-2">Proof of Yield</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Every major number in SOLFLOW maps to a real on-chain account or transaction. Addresses shown here are operator-configured; figures update only from verified data.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Metric loading={loading} label="Total Creator Fees" value={data?.stats ? `${data.stats.creatorFees} SOL` : '—'} />
        <Metric loading={loading} label="Creator Payout (70%)" value={data?.stats ? `${data.stats.creatorPayout} SOL` : '—'} />
        <Metric loading={loading} label="SOL Rewards (21%)" value={data?.stats ? `${data.stats.solDistributed} SOL` : '—'} accent="green" />
        <Metric loading={loading} label="NVDAx Pending (9%)" value={data?.stats ? `${data.stats.nvdaPendingConversion} SOL-eq` : '—'} accent="purple" />
        <Metric loading={loading} label="Current Epoch" value={data?.stats?.currentEpoch ?? '—'} />
      </div>

      <div className="panel divide-y divide-[var(--border)]">
        {rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-semibold text-sm">{r.label}</div>
              <div className="text-xs text-[var(--muted)]">{r.note}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="mono text-sm">{r.address ? shortAddress(r.address, 8) : 'Not configured'}</span>
              {r.address ? (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(r.address as string).then(() => setCopied(r.label));
                    }}
                  >
                    {copied === r.label ? 'Copied ✓' : 'Copy'}
                  </button>
                  <a className="btn btn-ghost btn-sm text-[var(--green)]" href={solscanAccount(r.address)} target="_blank" rel="noreferrer">
                    Solscan ↗
                  </a>
                </>
              ) : (
                <span className="badge badge-amber">UNCONFIGURED</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-[var(--muted)] mt-6">
        On-chain verified badges appear only after an operator-configured address has been validated against mainnet data. SOLFLOW does not claim verification that has not occurred.
      </p>
    </div>
  );
}
