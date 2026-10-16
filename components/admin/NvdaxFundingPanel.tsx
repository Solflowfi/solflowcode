'use client';

// Operator-only NVDAx reward funding control. Rendered ONLY inside the
// admin view after the server confirms the connected wallet is the
// configured operator. Shows route/status/signatures and the three-step
// live flow. Ordinary stakers never see this interface.
import { TokenIcon } from '@/components/common/TokenIcon';
import { useNvdaxFunding } from './useNvdaxFunding';

function row(label: string, value: string) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="mono text-right">{value}</span>
    </div>
  );
}

export function NvdaxFundingPanel() {
  const { busy, amountSol, setAmountSol, phase, quote, executed, funded, message, getQuote, convert, fund } = useNvdaxFunding();

  const okish = message !== null && (message.startsWith('Swap verified') || message.startsWith('Funding verified') || message.startsWith('Order received'));

  return (
    <div className="panel p-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TokenIcon symbol="NVDAx" size={36} />
          <div>
            <div className="font-bold">NVDAx Reward Funding</div>
            <div className="label">Jupiter Swap API v2 — operator only</div>
          </div>
        </div>
        <span className="badge badge-amber">LIVE FLOW</span>
      </div>

      <p className="text-xs text-[var(--muted)] mb-4">
        Converts the SOL reserved for NVDAx rewards (30% of the reward pool) into real NVDAx via Jupiter, then funds
        the SOLFLOW NVDAx reward vault (fund_spl_rewards, Token-2022, pinned mint). Every step is independently
        verified on-chain server-side; allocation economics are unchanged. Demo mode blocks live execution (fail closed).
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <div className="label mb-1">SOL amount to convert</div>
          <input
            className="input w-full mono"
            inputMode="decimal"
            value={amountSol}
            onChange={(e) => setAmountSol(e.target.value.replace(/[^0-9.]/g, ''))}
            disabled={busy || phase !== 'idle'}
          />
        </div>
        <div className="grid content-start gap-1">
          {row('Status', busy ? 'BUSY…' : phase.toUpperCase())}
          {quote?.ok && quote.router ? row('Router', quote.router) : null}
          {quote?.ok && quote.outAmount ? row('Est. NVDAx out', (Number(quote.outAmount) / 1e8).toFixed(4)) : null}
          {quote?.ok && quote.priceImpactBps !== null && quote.priceImpactBps !== undefined ? row('Price impact', quote.priceImpactBps + ' bps') : null}
          {executed?.ok && executed.nvdaRawReceived ? row('Verified received', (Number(executed.nvdaRawReceived) / 1e8).toFixed(4) + ' NVDAx') : null}
        </div>
      </div>

      {message ? <p className={`text-sm mb-4 ${okish ? 'text-[var(--green)]' : 'text-[var(--amber)]'}`}>{message}</p> : null}
      {executed?.swapSignature ? <div className="text-xs mono text-[var(--muted)] mb-1 break-all">Swap tx: {executed.swapSignature}</div> : null}
      {funded?.fundingSignature ? <div className="text-xs mono text-[var(--muted)] mb-1 break-all">Funding tx: {funded.fundingSignature}</div> : null}

      <div className="grid sm:grid-cols-3 gap-3">
        <button className="btn btn-secondary" disabled={busy || phase !== 'idle'} onClick={() => void getQuote()}>
          GET QUOTE
        </button>
        <button className="btn btn-primary" disabled={busy || phase !== 'quoted'} onClick={() => void convert()}>
          {busy && phase === 'quoted' ? 'PROCESSING…' : 'CONVERT SOL → NVDAx'}
        </button>
        <button className="btn btn-primary" disabled={busy || phase !== 'confirmed'} onClick={() => void fund()}>
          {busy && phase === 'confirmed' ? 'PROCESSING…' : 'FUND NVDAx REWARDS'}
        </button>
      </div>
    </div>
  );
}
