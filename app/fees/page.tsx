'use client';

import { FeeFlow } from '@/components/flow/FeeFlow';
import { Metric } from '@/components/common/Metric';
import { Unavailable } from '@/components/common/Unavailable';
import { useProtocolData } from '@/hooks/useProtocolData';
import { formatTokenAmount, shortAddress, solscanAccount } from '@/lib/format';

export default function FeesPage() {
  const { data, loading, error } = useProtocolData(30000);
  const fe = data?.feeEngine ?? null;
  const unavailable = !loading && (error !== null || fe === null);

  return (
    <div className="container-page py-10">
      <h1 className="display text-3xl mb-2">Where Rewards Come From</h1>
      <p className="text-sm text-[var(--muted)] mb-4">
        The SOLFLOW fee engine tracks eligible creator-fee inflows on-chain. Every verified fee is split 70% creator payout / 30% reward pool, and the pool is split 70% SOL / 30% NVDAx — an effective 70% creator · 21% SOL · 9% NVDAx allocation.
      </p>
      <p className="text-xs text-[var(--muted)] mb-8">
        NVDAx note: fees arrive as SOL. The 9% NVDAx allocation is converted to real NVDAx through a dedicated conversion route (SIMULATED at a labeled test rate in demo mode). Until a live route is configured it is retained as pending conversion — never counted as SOL, never credited as fake NVDAx.
      </p>

      <div className="grid lg:grid-cols-2 gap-8 items-start mb-10">
        <FeeFlow />
        <div className="grid sm:grid-cols-2 gap-4">
          <Metric loading={loading} label="Creator Fees Received" value={unavailable ? '—' : `${formatTokenAmount(fe?.feesReceived ?? '0', 4)} SOL`} accent="green" />
          <Metric loading={loading} label="Creator Payout (70%)" value={unavailable ? '—' : formatTokenAmount(fe?.creatorPayout ?? '0', 4)} />
          <Metric loading={loading} label="Reward Pool (30%)" value={unavailable ? '—' : formatTokenAmount(fe?.rewardPool ?? '0', 4)} accent="cyan" />
          <Metric loading={loading} label="SOL Allocation (21%)" value={unavailable ? '—' : formatTokenAmount(fe?.solAllocation ?? '0', 4)} accent="green" />
          <Metric loading={loading} label="NVDAx Allocation (9%)" value={unavailable ? '—' : formatTokenAmount(fe?.nvdaAllocation ?? '0', 4)} accent="purple" />
          <Metric loading={loading} label="NVDAx Pending Conversion" value={unavailable ? '—' : formatTokenAmount(fe?.nvdaPendingConversion ?? '0', 4)} />
        </div>
      </div>

      {unavailable ? <Unavailable /> : null}

      <h2 className="display text-xl mb-4">Creator Fee Sources</h2>
      <div className="panel overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Address</th>
              <th>Network</th>
              <th>Asset</th>
              <th>Verification</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {(data?.sources ?? []).map((s) => (
              <tr key={s.id}>
                <td className="font-semibold">{s.name}</td>
                <td className="mono">{s.address ? shortAddress(s.address, 6) : '—'}</td>
                <td>{s.network}</td>
                <td>{s.asset}</td>
                <td><span className="badge badge-amber">{s.verification.toUpperCase()}</span></td>
                <td>
                  {s.address ? (
                    <a className="text-[var(--green)] no-underline" href={solscanAccount(s.address)} target="_blank" rel="noreferrer">
                      Solscan ↗
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {(data?.sources ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)]">
                  No creator-fee sources configured. Set NEXT_PUBLIC_CREATOR_FEE_SOURCES (operator).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="panel p-5 mt-8 border-[rgba(255,180,84,0.3)]">
        <p className="text-sm text-[var(--amber)] mb-0">
          Not every SOL inflow is a creator fee. SOLFLOW counts only inflows from configured fee sources into the configured reward treasury that verify on-chain.
        </p>
      </div>
    </div>
  );
}
