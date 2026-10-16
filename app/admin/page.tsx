'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import type { AdminStats } from '@/types';
import { Unavailable } from '@/components/common/Unavailable';
import type { InfrastructureStatus } from '@/types';
import { NvdaxFundingPanel } from '@/components/admin/NvdaxFundingPanel';
import { MainnetReadiness } from '@/components/admin/MainnetReadiness';

interface AdminResponse {
  authorized: boolean;
  mode?: 'demo' | 'live';
  stats?: AdminStats | null;
  error?: string;
}

export default function AdminPage() {
  const { setVisible } = useWalletModal();
  const { publicKey, connected } = useWallet();
  const [resp, setResp] = useState<AdminResponse | null>(null);
  const [infra, setInfra] = useState<InfrastructureStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin?wallet=${publicKey.toBase58()}`, { cache: 'no-store' });
      setResp((await res.json()) as AdminResponse);
    } catch (e) {
      setResp({ authorized: false, error: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
    fetch('/api/infrastructure', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: InfrastructureStatus) => setInfra(d))
      .catch(() => setInfra(null));
  }, [load]);

  return (
    <div className="container-page py-10">
      <h1 className="display text-3xl mb-2">Admin</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Restricted. Access requires the server-configured ADMIN_WALLET to match the connected wallet. No admin authority or keys exist in the browser bundle.
      </p>

      {!connected || !publicKey ? (
        <div className="panel p-10 text-center">
          <p className="text-[var(--muted)] mb-6">Connect the admin wallet to continue.</p>
          <button className="btn btn-primary" onClick={() => setVisible(true)}>
            Connect Wallet
          </button>
        </div>
      ) : loading ? (
        <div className="panel p-6">
          <div className="skeleton h-5 w-40" />
        </div>
      ) : resp && !resp.authorized ? (
        <div className="panel p-8 border-[rgba(255,92,122,0.4)]">
          <div className="badge badge-red mb-3">ACCESS DENIED</div>
          <p className="text-sm text-[var(--muted)] mb-0">{resp.error ?? 'Not authorized.'}</p>
        </div>
      ) : resp?.stats ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {([
            ['Total TVL (FLOW)', resp.stats.totalTvl + ' FLOW'],
            ['Creator Fee Revenue', resp.stats.creatorFeeRevenue + ' SOL'],
            ['SOL Reward Pool', resp.stats.solRewardPool + ' SOL'],
            ['NVDA Reward Pool', resp.stats.nvdaRewardPool],
            ['Active Users', String(resp.stats.activeUsers)],
            ['Pending Claims', String(resp.stats.pendingClaims)],
            ['Completed Claims', String(resp.stats.completedClaims)],
            ['Failed Transactions', String(resp.stats.failedTransactions)],
            ['Epochs', String(resp.stats.epochs)],
          ] as Array<[string, string]>).map(([label, value]) => (
            <div key={label} className="panel p-5">
              <div className="label mb-2">{label}</div>
              <div className="display text-xl">{value}</div>
            </div>
          ))}
        </div>
      ) : (
        <Unavailable message={resp?.error ?? 'Live data unavailable'} />
      )}
      {resp?.authorized && resp?.stats ? <NvdaxFundingPanel /> : null}
      {resp?.authorized && resp?.stats ? <MainnetReadiness /> : null}
      <h2 className="display text-2xl mt-12 mb-2">Infrastructure Status</h2>
      <p className="text-sm text-[var(--muted)] mb-6">
        Server-validated on-chain readiness. States are verified via RPC (account existence, SPL mint validity, program deployment) — never inferred from environment variables alone.
      </p>
      {infra ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {infra.components.map((c) => {
            const cls =
              c.state === 'connected'
                ? 'badge-green'
                : c.state === 'not_deployed'
                  ? 'badge-amber'
                  : c.state === 'invalid'
                    ? 'badge-red'
                    : 'badge';
            return (
              <div key={c.id} className="panel p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="label">{c.label}</div>
                  <span className={`badge ${cls}`}>{c.state.replace('_', ' ').toUpperCase()}</span>
                </div>
                <p className="text-xs text-[var(--muted)] mb-0">{c.detail}</p>
                {c.metrics ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {Object.entries(c.metrics).map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-white/5 px-3 py-2">
                        <div className="label">{k}</div>
                        <div className="mono text-sm text-[var(--green)]">{v}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel p-6 text-sm text-[var(--muted)]">Infrastructure status unavailable.</div>
      )}
      {!infra?.liveReady ? (
        <div className="panel p-5 mt-6 border-[rgba(255,180,84,0.3)]">
          <p className="text-sm text-[var(--amber)] mb-0">
            Live mode is intentionally OFF (NEXT_PUBLIC_DEMO_MODE=true). Missing for live activation: {infra && infra.missing.length > 0 ? infra.missing.join(' · ') : 'see component states above'}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
