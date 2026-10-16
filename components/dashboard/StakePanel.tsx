'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { getEnv } from '@/config/env';
import { FLOW_COMING_SOON, FLOW_COMING_SOON_DETAIL } from '@/lib/flow-status';
import { isStagingActive, stakingTokenSymbol } from '@/lib/staging';
import { buildStakeTransaction, buildUnstakeTransaction } from '@/lib/solana/staging-stake';
import { useStaking } from '@/hooks/useStaking';
import { formatTokenAmount } from '@/lib/format';

/** Stake panel modes: MAINNET STAGING ($TST, real txs) vs PRODUCTION
 *  pre-launch ($FLOW, Coming Soon + labeled demo). */
export function StakePanel() {
  const staging = isStagingActive();
  const symbol = stakingTokenSymbol();
  if (staging) return <StagingStakePanel symbol={symbol} />;
  return <FlowStakePanel />;
}

/** ---------- MAINNET STAGING ($TST) ---------- */
function StagingStakePanel({ symbol }: { symbol: string }) {
  const { setVisible } = useWalletModal();
  const { publicKey, signTransaction } = useWallet();
  const env = getEnv();
  const programId = env.stagingProgramId ?? '';
  const mint = env.flowMint ?? '';
  const DEC = 6; // $TST decimals (verified on-chain)

  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'idle' | 'building' | 'signing' | 'confirming'>('idle');
  const [tstBalance, setTstBalance] = useState<number | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [staked, setStaked] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;
  const amtNum = useMemo(() => Number(amount) || 0, [amount]);
  const insufficient = tstBalance !== null && amtNum > tstBalance + 1e-9;
  const notReady = !programId || !mint;

  const loadBalances = useCallback(async () => {
    if (!wallet) return;
    try {
      const res = await fetch(`/api/token-balance?wallet=${wallet}&mint=${mint}`, { cache: 'no-store' });
      const j = (await res.json()) as { ok: boolean; balanceRaw?: string; decimals?: number | null };
      setTstBalance(j.ok && j.balanceRaw !== undefined ? Number(j.balanceRaw) / 10 ** (j.decimals ?? DEC) : null);
    } catch {
      setTstBalance(null); // live read unavailable — never faked
    }
    try {
      const res = await fetch(`/api/wallet-balance?wallet=${wallet}`, { cache: 'no-store' });
      const j = (await res.json()) as { ok: boolean; balanceLamports?: number };
      setSolBalance(j.ok && typeof j.balanceLamports === 'number' ? j.balanceLamports / 1e9 : null);
    } catch {
      setSolBalance(null);
    }
  }, [wallet, mint]);

  const loadStaked = useCallback(async () => {
    if (!wallet || !programId) { setStaked(null); return; }
    try {
      const res = await fetch(`/api/staging/position?wallet=${wallet}`, { cache: 'no-store' });
      const j = (await res.json()) as { ok: boolean; exists?: boolean; sharesRaw?: string };
      setStaked(j.ok && j.exists ? Number(j.sharesRaw) / 10 ** DEC : 0);
    } catch {
      setStaked(null);
    }
  }, [wallet, programId]);

  useEffect(() => {
    void loadBalances();
    void loadStaked();
  }, [loadBalances, loadStaked]);

  async function submitStagingTx(kind: 'stake' | 'unstake') {
    if (!wallet || !publicKey) { setVisible(true); return; }
    if (!signTransaction) { setError('Wallet does not support signing.'); return; }
    setError(null);
    setNotice(null);
    setBusy('building');
    try {
      const rawAmt = BigInt(Math.round(amtNum * 10 ** DEC));
      const built = kind === 'stake'
        ? await buildStakeTransaction(programId, wallet, mint, rawAmt)
        : await buildUnstakeTransaction(programId, wallet, mint, rawAmt);
      built.transaction.feePayer = publicKey;
      setBusy('signing');
      const signed = await signTransaction(built.transaction);
      setBusy('confirming');
      const res = await fetch('/api/staging/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedTransaction: signed.serialize().toString('base64') }),
      });
      const j = (await res.json()) as { ok: boolean; signature?: string; error?: string };
      if (!j.ok) throw new Error(j.error ?? 'Transaction failed.');
      setLastSig(j.signature ?? null);
      setNotice(
        (kind === 'stake' ? 'Stake confirmed: ' : 'Unstake confirmed: ') + formatTokenAmount(amtNum, 4) + ' ' + symbol +
        (j.signature ? ' — tx ' + j.signature.slice(0, 8) + '…' : ''),
      );
      setAmount('');
      await loadBalances();
      await loadStaked();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transaction failed.';
      setError(msg.includes('403') || msg.toLowerCase().includes('forbidden')
        ? 'RPC rejected the request (403). The staging program may not be deployed/initialized yet, or the RPC blocked the request.'
        : msg);
    } finally {
      setBusy('idle');
    }
  }

  function setPct(p: number) {
    const v = (tstBalance ?? 0) * (p / 100);
    setAmount(v > 0 ? v.toFixed(4) : '0');
  }

  if (notReady) {
    return (
      <div className="panel panel-glow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="display text-xl mb-0">Stake ${symbol}</h3>
          <span className="badge badge-amber">MAINNET STAGING</span>
        </div>
        <p className="text-sm text-[var(--red)]">Staging program or staking mint is not configured — staking unavailable.</p>
      </div>
    );
  }

  return (
    <div className="panel panel-glow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="display text-xl mb-0">Stake ${symbol}</h3>
        <span className="badge badge-amber">MAINNET STAGING</span>
      </div>

      <div className="mb-4 p-4 rounded-xl border border-[rgba(255,180,84,0.35)] bg-[rgba(255,180,84,0.05)]">
        <div className="font-bold mb-1">MAINNET STAGING — Stake ${symbol}</div>
        <p className="text-xs text-[var(--muted)] mb-0">
          Real Solana Mainnet transactions. Real SOL network fees apply. Rewards are not distributed in staging.
        </p>
      </div>

      <label className="label block mb-2">Amount</label>
      <div className="flex items-center gap-3 input !py-2">
        <input
          className="flex-1 bg-transparent border-0 outline-none text-lg mono"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <span className="label">{symbol}</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-[var(--muted)]">
        <span>${symbol} Balance: {tstBalance === null ? 'unavailable' : formatTokenAmount(tstBalance, 4) + ' ' + symbol}</span>
        <span>SOL (gas): {solBalance === null ? 'unavailable' : formatTokenAmount(solBalance, 4)}</span>
      </div>

      <div className="grid grid-cols-4 gap-2 mt-3">
        {[25, 50, 75, 100].map((p) => (
          <button key={p} className="btn btn-secondary btn-sm" onClick={() => setPct(p)}>
            {p === 100 ? 'MAX' : `${p}%`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
        <div>
          <div className="label mb-1">Staked {symbol}</div>
          <div className="mono">{staked === null ? 'unavailable' : formatTokenAmount(staked, 4)}</div>
        </div>
        <div>
          <div className="label mb-1">Rewards</div>
          <div className="mono text-[var(--muted)]">Reward distribution not enabled in staging.</div>
        </div>
      </div>

      {insufficient && amtNum > 0 ? <p className="text-xs text-[var(--red)] mt-3 mb-0">Insufficient ${symbol} balance for this amount.</p> : null}
      {solBalance !== null && solBalance < 0.001 ? <p className="text-xs text-[var(--amber)] mt-3 mb-0">Low SOL — network fees may fail.</p> : null}
      {error ? <p className="text-xs text-[var(--red)] mt-3 mb-0">{error}</p> : null}
      {notice ? <p className="text-xs text-[var(--green)] mt-3 mb-0">{notice}</p> : null}
      {lastSig ? <div className="text-xs mono text-[var(--muted)] mt-2 break-all">Last tx: {lastSig}</div> : null}

      <div className="grid grid-cols-2 gap-3 mt-4">
        <button
          className="btn btn-primary"
          disabled={busy !== 'idle' || amtNum <= 0 || insufficient}
          onClick={() => void submitStagingTx('stake')}
        >
          {busy === 'building' ? 'BUILDING…' : busy === 'signing' ? 'SIGN IN WALLET…' : busy === 'confirming' ? 'CONFIRMING…' : `STAKE ${symbol}`}
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy !== 'idle' || amtNum <= 0 || (staked !== null && amtNum > staked + 1e-9)}
          onClick={() => void submitStagingTx('unstake')}
        >
          {busy === 'building' ? 'BUILDING…' : busy === 'signing' ? 'SIGN IN WALLET…' : busy === 'confirming' ? 'CONFIRMING…' : `UNSTAKE ${symbol}`}
        </button>
      </div>
      {!publicKey ? <p className="text-xs text-[var(--muted)] mt-2 mb-0">Connect Phantom to stake ${symbol}.</p> : null}
    </div>
  );
}

/** ---------- PRODUCTION FALLBACK ($FLOW) — unchanged behavior ---------- */
function FlowStakePanel() {
  const { setVisible } = useWalletModal();
  const { publicKey, connected } = useWallet();
  const { runOp, txState, setTxState, lastError, setLastError } = useStaking();
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const env = getEnv();
  const flowLaunched = !!env.flowMint;

  const amtNum = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : 0;
  }, [amount]);
  const busy = txState === 'building' || txState === 'signing' || txState === 'confirming';

  async function handleStake() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    setNotice(null);
    setTxState('building');
    if (amtNum <= 0) {
      setLastError('Enter an amount greater than zero.');
      setTxState('failed');
      return;
    }
    const res = await runOp('stake', amtNum);
    if (res.ok) {
      setNotice('Stake confirmed (demo ledger updated).');
      setAmount('');
    } else if (res.error) {
      setLastError(res.error);
    }
  }

  return (
    <div className="panel panel-glow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="display text-xl mb-0">Stake $FLOW</h3>
        <span className="badge">{flowLaunched ? 'STAKE: FLOW' : 'COMING SOON'}</span>
      </div>

      {!flowLaunched ? (
        <div className="mb-4 p-4 rounded-xl border border-[rgba(255,180,84,0.3)] bg-[rgba(255,180,84,0.05)]">
          <div className="font-bold mb-1">$FLOW {FLOW_COMING_SOON}</div>
          <p className="text-xs text-[var(--muted)] mb-0">
            {FLOW_COMING_SOON_DETAIL} Live staking stays locked until the official $FLOW mint is configured, verified
            on-chain and initialized. This panel shows the demo experience only.
          </p>
        </div>
      ) : null}

      <label className="label block mb-2">Amount</label>
      <div className="flex items-center gap-3 input !py-2">
        <input
          className="flex-1 bg-transparent border-0 outline-none text-lg mono"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <span className="label">FLOW</span>
      </div>

      {lastError ? <p className="text-xs text-[var(--red)] mt-3 mb-0">{lastError}</p> : null}
      {notice ? <p className="text-xs text-[var(--green)] mt-3 mb-0">{notice}</p> : null}

      <button
        className="btn btn-primary w-full mt-4"
        disabled={busy}
        onClick={() => void handleStake()}
      >
        {busy ? 'PROCESSING…' : 'STAKE $FLOW'}
      </button>
    </div>
  );
}

