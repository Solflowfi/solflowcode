'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const CIRCUIT_PATHS = [
  'M -20 120 H 340 L 420 200 H 900',
  'M -20 300 H 220 L 300 380 H 640',
  'M 1460 140 H 1120 L 1040 220 H 780',
  'M 1460 420 H 1240 L 1150 330 H 860',
  'M 200 660 V 520 L 300 430 H 720',
  'M 1300 700 V 560 L 1200 470 H 900',
];

function CircuitLayer() {
  return (
    <div className="circuit-layer" aria-hidden="true">
      <svg viewBox="0 0 1440 700" preserveAspectRatio="xMidYMid slice">
        {CIRCUIT_PATHS.map((d, i) => (
          <path
            key={`base-${i}`}
            className={`circuit-line ${i % 3 === 1 ? 'purple' : i % 3 === 2 ? 'green' : ''}`}
            d={d}
          />
        ))}
        {CIRCUIT_PATHS.map((d, i) => (
          <path
            key={`pulse-${i}`}
            className={`circuit-pulse ${i % 3 === 1 ? 'purple' : i % 3 === 2 ? 'green' : ''}`}
            d={d}
          />
        ))}
      </svg>
    </div>
  );
}

function Fan({ duration }: { duration: string }) {
  return (
    <div className="gpu-fan">
      <div className="fan-ring" />
      <div className="fan-blades" style={{ '--fan-duration': duration } as React.CSSProperties}>
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="fan-hub" />
    </div>
  );
}

function HudPanel({
  side,
  title,
  rows,
  note,
}: {
  side: 'hud-left' | 'hud-right';
  title: string;
  rows: [string, string, boolean?][];
  note: string;
}) {
  return (
    <div className={`hud-panel ${side}`}>
      <div className="hud-title">{title}</div>
      {rows.map(([k, v, on]) => (
        <div key={k} className="hud-row">
          <span>{k}</span>
          <b className={on ? 'on' : undefined}>{v}</b>
        </div>
      ))}
      <div className="hud-note">{note}</div>
    </div>
  );
}

export function GpuHero() {
  const [state, setState] = useState<'idle' | 'processing'>('idle');
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let timerA: ReturnType<typeof setTimeout> | undefined;
    let timerB: ReturnType<typeof setTimeout> | undefined;

    const cycle = () => {
      setState('processing');
      timerA = setTimeout(() => {
        setState('idle');
        timerB = setTimeout(cycle, 8600);
      }, 3400);
    };

    timerB = setTimeout(cycle, 5200);
    return () => {
      if (timerA) clearTimeout(timerA);
      if (timerB) clearTimeout(timerB);
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(hover: none)').matches) return;

    const onMove = (e: MouseEvent) => {
      const rect = stage.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      stage.style.transform = `rotateY(${px * 7}deg) rotateX(${-py * 4}deg)`;
    };
    const onLeave = () => {
      stage.style.transform = 'rotateY(0deg) rotateX(0deg)';
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    stage.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      stage.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <section className="gpu-hero">
      <BgGpu />
      <CircuitLayer />
      <div className="container-page">
        <div className="gpu-hero-inner">
          <div className="gpu-hero-copy">
            <div className="badge badge-green mb-6">SOLANA DEVNET — DEMO MODE</div>
            <h1 className="gpu-hero-title">
              Turn $FLOW
              <br />
              into <span className="text-gradient">SOL + NVDAx</span>
            </h1>
            <p className="gpu-hero-sub mb-8">
              Stake $FLOW. Earn SOL + NVDAx. Verified creator fees flow through the SOLFLOW
              engine, and $FLOW stakers receive their share of SOL and
              NVDAx reward allocations. Staking never requires depositing SOL.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/app" className="btn btn-primary no-underline">
                LAUNCH APP
              </Link>
              <Link href="/fees" className="btn btn-secondary no-underline">
                EXPLORE FLOW
              </Link>
            </div>
          </div>
          <GpuStage state={state} stageRef={stageRef} />
        </div>
      </div>
    </section>
  );
}

function GpuStage({
  state,
  stageRef,
}: {
  state: 'idle' | 'processing';
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="gpu-stage" data-state={state} ref={stageRef}>
      <div className="gpu-stage-badge">
        <span className="dot" />
        SOLFLOW ENGINE — {state === 'processing' ? 'PROCESSING' : 'IDLE'}
      </div>

      <div className="gpu-float">
        <div className="gpu-card">
          <div className="gpu-backplate" />
          <div className="gpu-glow" />
          <div className="gpu-shell" />
          <div className="gpu-top-rail">
            <div className="gpu-rail-leds">
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="gpu-branding">
            <span className="gb-mark">SOLFLOW</span>
            <span className="gb-sub">FEE PROCESSING UNIT</span>
          </div>
          <div className="gpu-fans">
            <Fan duration="9s" />
            <Fan duration="11s" />
            <Fan duration="7.5s" />
          </div>
          <div className="gpu-heatsink" />
          <div className="gpu-pcb">
            <div className="gpu-pcb-track" />
            <div className="gpu-pcb-track" />
          </div>
          <div className="gpu-pcie" />
        </div>

        <HudPanel
          side="hud-left"
          title="SOLFLOW ENGINE"
          rows={[
            ['FEE PROCESSING', 'ACTIVE', true],
            ['REWARD ENGINE', 'ACTIVE', true],
            ['CREATOR PAYOUT', '70% OF FEES'],
            ['REWARD POOL', '30% OF FEES'],
            ['SOL / NVDAX', '21% / 9%'],
          ]}
          note="SIMULATED TELEMETRY"
        />
        <HudPanel
          side="hud-right"
          title="NETWORK STATUS"
          rows={[
            ['NETWORK', 'SOLANA'],
            ['CLUSTER', 'DEVNET'],
            ['RPC', 'ALCHEMY'],
            ['MODE', 'DEMO', true],
          ]}
          note="SIMULATED TELEMETRY"
        />
      </div>

      <div className="reward-streams">
        <div className="reward-lane">
          <span className="rl-track" />
          <span className="rl-dot" />
          <span className="rl-dot d2" />
          <div className="rl-chip">
            <span className="reward-chip">SOL REWARDS</span>
          </div>
        </div>
        <div className="reward-lane nvdx">
          <span className="rl-track" />
          <span className="rl-dot" />
          <span className="rl-dot d2" />
          <div className="rl-chip">
            <span className="reward-chip nvdx">NVDAx REWARDS</span>
          </div>
        </div>
      </div>

      <div className="demo-tag">DEMO VISUALIZATION</div>
    </div>
  );
}

/* atmospheric background GPU — enormous, darkened, blurred, behind the hero */
function BgGpu() {
  return (
    <div className="bg-gpu" aria-hidden="true">
      <div className="bggpu-chassis" />
      <div className="bggpu-fan" style={{ left: '20%' }} />
      <div className="bggpu-fan" style={{ left: '42%' }} />
      <div className="bggpu-fan" style={{ left: '64%' }} />
    </div>
  );
}

/* smaller GPU for the final CTA section */
export function MiniGpu() {
  return (
    <div className="mini-gpu" aria-hidden="true">
      <div className="gpu-glow" />
      <div className="gpu-shell" />
      <div className="gpu-top-rail">
        <div className="gpu-rail-leds">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="gpu-branding">
        <span className="gb-mark">SOLFLOW</span>
        <span className="gb-sub">REWARD ENGINE</span>
      </div>
      <div className="gpu-fans">
        <Fan duration="6s" />
        <Fan duration="8s" />
        <Fan duration="7s" />
      </div>
      <div className="gpu-heatsink" />
      <div className="gpu-pcb">
        <div className="gpu-pcb-track" />
        <div className="gpu-pcb-track" />
      </div>
      <div className="gpu-pcie" />
    </div>
  );
}
