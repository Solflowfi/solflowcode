'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GpuHero, MiniGpu } from '@/components/landing/GpuHero';
import { Metric } from '@/components/common/Metric';
import { useProtocolData } from '@/hooks/useProtocolData';
import { formatTokenAmount } from '@/lib/format';

/* SECTION 02 — creator fee processing: fees entering the engine */
function FeeProcessingSection() {
  return (
    <section className="container-page section" id="processing">
      <div className="section-kicker">SECTION 02 — INTAKE</div>
      <h2 className="section-title">Creator Fee Processing</h2>
      <p className="section-sub mb-10">
        Verified creator fees enter the SOLFLOW engine as on-chain flow. Each packet is
        validated before it reaches the reward allocation layer.
        <span className="label ml-2">DEMO VISUALIZATION</span>
      </p>
      <div className="panel panel-glow p-6 sm:p-10">
        <div className="flex flex-col items-center gap-1">
          {[
            { label: 'CREATOR ACTIVITY', color: 'var(--purple)' },
            { label: 'CREATOR FEES', color: 'var(--cyan)' },
            { label: 'SOLFLOW GPU — PROCESSING', color: '#c4b5fd' },
            { label: 'REWARD ENGINE', color: 'var(--green)' },
          ].map((n, i) => (
            <div key={n.label} className="flex flex-col items-center w-full max-w-xl">
              <div
                className="px-4 py-2 rounded-xl border text-xs font-bold tracking-widest text-center"
                style={{ borderColor: n.color + '55', color: n.color, background: n.color + '0d' }}
              >
                {n.label}
              </div>
              {i < 3 ? (
                <div className="relative h-10 w-px bg-[var(--border-strong)]">
                  {[0, 0.5, 1].map((d) => (
                    <span
                      key={d}
                      className="particle absolute left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full"
                      style={{ background: i >= 2 ? 'var(--green)' : 'var(--cyan)', animationDelay: `${d}s`, top: 0 }}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* SECTION 03 — SOLFLOW engine telemetry */
function EngineSection({ stats, loading }: { stats: { tvl: string; creatorPayout: string; solDistributed: string; nvdaDistributed: string; nvdaPendingConversion: string; creatorFees: string } | null; loading: boolean }) {
  const rows: [string, string, boolean?][] = [
    ['FEE PROCESSING', 'ACTIVE', true],
    ['REWARD ENGINE', 'ACTIVE', true],
    ['CREATOR PAYOUT', '70% OF FEES'],
    ['REWARD POOL', '30% OF FEES'],
    ['SOL REWARDS', '21% OF FEES'],
    ['NVDAX ALLOCATION', '9% OF FEES'],
    ['NETWORK', 'SOLANA'],
    ['RPC', 'ALCHEMY'],
  ];
  return (
    <section className="container-page section" id="engine">
      <div className="grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="section-kicker">SECTION 03 — ENGINE</div>
          <h2 className="section-title">SOLFLOW Engine</h2>
          <p className="section-sub mb-8">
            A look at the processing pipeline. Telemetry values are simulated for
            demonstration — protocol accounting always follows on-chain state.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Metric loading={loading} label="Total Value Locked" value={stats ? `${formatTokenAmount(stats.tvl, 2)} FLOW` : '—'} accent="green" />
            <Metric loading={loading} label="Creator Fees" value={stats ? formatTokenAmount(stats.creatorFees, 2) : '—'} accent="cyan" />
            <Metric loading={loading} label="Creator Payout (70%)" value={stats ? formatTokenAmount(stats.creatorPayout, 2) : '—'} accent="green" />
            <Metric loading={loading} label="SOL Rewards (21%)" value={stats ? formatTokenAmount(stats.solDistributed, 2) : '—'} accent="green" />
            <Metric loading={loading} label="NVDAx Pending (9%)" value={stats ? formatTokenAmount(stats.nvdaPendingConversion, 2) : '—'} accent="purple" />
          </div>
        </div>
        <div className="panel p-0 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] bg-[rgba(255,255,255,0.02)]">
            <div className="terminal-dots">
              <i />
              <i />
              <i />
            </div>
            <span className="label mb-0">solflow-engine — telemetry</span>
          </div>
          <div className="p-5 mono text-sm">
            {rows.map(([k, v, on]) => (
              <div key={k} className="hud-row" style={{ fontSize: 12.5, padding: '6px 0' }}>
                <span>{k}</span>
                <b className={on ? 'on' : undefined}>{v}</b>
              </div>
            ))}
            <div className="hud-note mt-3">SIMULATED TELEMETRY — NOT LIVE PROTOCOL DATA</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* SECTION 04 — multi-reward output */
function RewardOutputSection() {
  return (
    <section className="container-page section" id="rewards">
      <div className="section-kicker">SECTION 04 — OUTPUT</div>
      <h2 className="section-title">Multi-Reward Output</h2>
      <p className="section-sub mb-10">
        Every verified creator fee is split twice: 70% goes to the creator payout and 30%
        becomes the SOLFLOW reward pool. That pool is itself split 70% SOL / 30% NVDAx — an
        effective 70% creator · 21% SOL · 9% NVDAx allocation of every fee.
        <span className="label ml-2">DEMO VALUES</span>
      </p>
      <div className="grid sm:grid-cols-2 gap-5 max-w-3xl">
        <div className="fanout-node solanode">
          <div className="flex items-center justify-between mb-3">
            <span className="display text-xl" style={{ color: '#c4b5fd' }}>SOL REWARDS</span>
            <span className="mono text-sm text-[var(--muted)]">70% OF POOL</span>
          </div>
          <div className="allocation-bar mb-3">
            <i style={{ width: '70%' }} />
          </div>
          <p className="text-sm text-[var(--muted)] mb-0">
            70% of the 30% reward pool — 21 SOL of every 100 SOL in creator fees — is routed
            to the SOL reward pool for stakers.
          </p>
        </div>
        <div className="fanout-node nvdxnode">
          <div className="flex items-center justify-between mb-3">
            <span className="display text-xl" style={{ color: '#86efac' }}>NVDAX REWARDS</span>
            <span className="mono text-sm text-[var(--muted)]">30% OF POOL</span>
          </div>
          <div className="allocation-bar mb-3">
            <i className="greenfill" style={{ width: '30%' }} />
          </div>
          <p className="text-sm text-[var(--muted)] mb-0">
            30% of the reward pool — 9 SOL of every 100 SOL in creator fees. Fees arrive as
            SOL and are converted to NVDAx before crediting (SIMULATED conversion in demo
            mode; live conversion requires a configured route and is otherwise retained as
            pending — never counted as SOL).
          </p>
        </div>
      </div>
    </section>
  );
}

/* SECTION 05 — stake: plugging $FLOW into the protocol */
function StakeSection() {
  const [connected, setConnected] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setConnected(3);
      return;
    }
    const id = setInterval(() => {
      setConnected((c) => (c >= 3 ? 1 : c + 1));
    }, 1600);
    return () => clearInterval(id);
  }, []);

  const items = [
    { label: 'STAKE $FLOW', sub: 'Stake $FLOW' },
    { label: 'VERIFY', sub: 'On-chain check' },
    { label: 'EARN', sub: 'Rewards flow' },
  ];

  return (
    <section className="container-page section" id="stake">
      <div className="section-kicker">SECTION 05 — STAKE</div>
      <h2 className="section-title">Plug Into the Flow</h2>
      <p className="section-sub mb-10">
        Staking connects your $FLOW to the protocol. Once verified, your position starts
        receiving the reward flow proportional to your share.
      </p>
      <div className="panel p-8">
        <div className="flex flex-wrap items-stretch justify-center gap-6">
          {items.map((it, i) => (
            <div key={it.label} className="flex items-center gap-4">
              <div className={`plug-item ${i < connected ? 'connected' : ''}`}>
                <div className="plug-label">{it.label}</div>
                <div className="flex items-center gap-3">
                  <div className={`plug-socket ${i < connected ? 'connected' : ''}`}>
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: i < connected ? 'var(--green)' : 'var(--muted)' }} />
                  </div>
                  <div className="plug-card text-center">
                    <div className="text-xs font-bold tracking-widest mb-1">{it.label}</div>
                    <div className="text-[10px] text-[var(--muted)]">{it.sub}</div>
                  </div>
                </div>
                <div className="plug-cable" />
              </div>
            </div>
          ))}
        </div>
        <div className="text-center mt-6">
          <Link href="/earn" className="btn btn-primary no-underline">
            Open Staking
          </Link>
        </div>
      </div>
    </section>
  );
}

/* SECTION 06 — earn: reward accumulation */
function EarnSection() {
  const [accrued, setAccrued] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(() => setAccrued((v) => v + 1), 2400);
    return () => clearInterval(id);
  }, []);

  const sol = (128.4021 + accrued * 0.0137).toFixed(4);
  const nvdx = (962.5 + accrued * 0.113).toFixed(1);

  return (
    <section className="container-page section" id="earn">
      <div className="grid lg:grid-cols-2 gap-10 items-center">
        <div>
          <div className="section-kicker">SECTION 06 — EARN</div>
          <h2 className="section-title">Rewards Accumulate</h2>
          <p className="section-sub mb-8">
            As the engine processes creator fees, rewards accrue to staker positions
            continuously. Figures below are a simulated accumulation for illustration.
            <span className="label block mt-2">SIMULATED — DEMO MODE</span>
          </p>
          <Link href="/app" className="btn btn-primary no-underline">
            View Portfolio
          </Link>
        </div>
        <div className="panel p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="terminal-dots">
              <i />
              <i />
              <i />
            </div>
            <span className="label mb-0">reward accumulator</span>
          </div>
          <div className="earn-row mb-3">
            <span className="label mb-0">SOL ACCRUED</span>
            <span key={`sol-${accrued}`} className="earn-accrual flash display text-xl" style={{ color: '#c4b5fd' }}>
              {sol}
            </span>
          </div>
          <div className="earn-row">
            <span className="label mb-0">NVDAx ACCRUED</span>
            <span key={`nvdx-${accrued}`} className="earn-accrual flash display text-xl" style={{ color: '#86efac' }}>
              {nvdx}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* SECTION 07 — transparency / security */
function TransparencySection() {
  const items = [
    ['On-Chain Accounting', 'Reward allocation is derived from verified on-chain fee events — not off-chain promises.'],
    ['Devnet Transparency', 'Every demo transaction is visible on Solana Devnet via Solscan explorer links.'],
    ['No Custody of Keys', 'The interface never requests or stores your private keys. Wallets stay non-custodial.'],
    ['Demo Mode Defaults', 'The site ships in DEMO MODE on devnet. Live staking is disabled until infrastructure validation passes.'],
  ];
  return (
    <section className="container-page section" id="transparency">
      <div className="section-kicker">SECTION 07 — TRANSPARENCY</div>
      <h2 className="section-title">Built Transparent. Run Safe.</h2>
      <p className="section-sub mb-10">
        SOLFLOW is engineered around verifiable state and conservative safety defaults.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        {items.map(([title, body]) => (
          <div key={title} className="panel panel-hover p-6">
            <div className="font-bold mb-2">{title}</div>
            <p className="text-sm text-[var(--muted)] mb-0">{body}</p>
          </div>
        ))}
      </div>
      <div className="panel p-5 mt-8 border-[rgba(255,180,84,0.3)]">
        <p className="text-sm text-[var(--amber)] mb-0 text-center font-semibold">
          Rewards depend on actual creator-fee generation and the amount of eligible staking activity. There is no guaranteed return. This site is a demo — nothing here is financial advice.
        </p>
      </div>
    </section>
  );
}

/* SECTION 08 — final CTA with the mini GPU */
function LaunchSection() {
  return (
    <section className="container-page section" id="launch">
      <div className="panel panel-glow p-10 sm:p-14 text-center relative overflow-hidden">
        <div className="hero-grid absolute inset-0 pointer-events-none opacity-40" />
        <div className="relative z-10">
          <div className="flex justify-center gap-3 mb-8">
            <span className="badge badge-green">SOLANA DEVNET</span>
            <span className="badge badge-purple">DEMO MODE</span>
          </div>
          <MiniGpu />
          <h2 className="section-title mt-10 mb-4">Ready to Stake Into the Flow?</h2>
          <p className="section-sub mx-auto mb-8">
            Connect your wallet, stake $FLOW, and watch creator fees convert into multi-asset
            rewards — live on devnet.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/app" className="btn btn-primary no-underline">
              LAUNCH APP
            </Link>
            <Link href="/transparency" className="btn btn-secondary no-underline">
              Read Transparency
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { data, loading, error } = useProtocolData(20000);
  const stats = data?.stats ?? null;

  return (
    <div>
      {/* SECTION 01 — giant animated GPU hero */}
      <GpuHero />

      {/* 02 — fee processing */}
      <FeeProcessingSection />

      {/* 03 — engine telemetry */}
      <EngineSection stats={stats} loading={loading} />

      {/* 04 — multi-reward output */}
      <RewardOutputSection />

      {/* 05 — stake */}
      <StakeSection />

      {/* 06 — earn */}
      <EarnSection />

      {/* 07 — transparency / security */}
      <TransparencySection />

      {/* 08 — launch */}
      <LaunchSection />

      {error !== null && !loading ? (
        <div className="container-page pb-16">
          <p className="text-xs text-[var(--amber)] text-center">
            Live protocol data temporarily unavailable — showing simulated visuals only.
          </p>
        </div>
      ) : null}
    </div>
  );
}

