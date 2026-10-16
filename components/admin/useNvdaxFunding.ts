'use client';

// Operator-only NVDAx funding flow (client hook). The operator signs each
// transaction locally in their wallet; the server holds the Jupiter API key,
// executes/verifies swaps and relays fund_spl_rewards. No keys in the browser.
import { useCallback, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, Transaction, type PublicKey } from '@solana/web3.js';

export type FundingPhase = 'idle' | 'quoted' | 'confirmed' | 'funded';

export interface QuoteResponse {
  ok: boolean;
  error?: string;
  reasons?: string[];
  requestId?: string;
  transaction?: string;
  inAmount?: string;
  outAmount?: string;
  router?: string;
  priceImpactBps?: number | null;
  code?: string;
}

export interface ExecuteResponse {
  ok: boolean;
  error?: string;
  code?: string;
  swapSignature?: string;
  solDebitedLamports?: string;
  nvdaRawReceived?: string;
}

export interface BuildFundResponse {
  ok: boolean;
  error?: string;
  transaction?: string;
  amountRaw?: string;
  vault?: string;
}

export interface FundResponse {
  ok: boolean;
  error?: string;
  fundingSignature?: string;
  nvdaRawFunded?: string;
  vault?: string;
}

const MAINNET_CONN = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

/** Refresh the placeholder blockhash server-built txs carry before signing. */
async function prepareForSigning(tx: Transaction, payer: PublicKey): Promise<void> {
  tx.recentBlockhash = (await MAINNET_CONN.getLatestBlockhash('finalized')).blockhash;
  tx.feePayer = payer;
}

export function useNvdaxFunding() {
  const { publicKey, signTransaction } = useWallet();
  const [busy, setBusy] = useState(false);
  const [amountSol, setAmountSol] = useState('1');
  const [phase, setPhase] = useState<FundingPhase>('idle');
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [executed, setExecuted] = useState<ExecuteResponse | null>(null);
  const [funded, setFunded] = useState<FundResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const wallet = publicKey?.toBase58() ?? null;

  /** GET QUOTE: server requests the Jupiter order; returns an unsigned tx. */
  const getQuote = useCallback(async () => {
    if (!wallet) return;
    setBusy(true);
    setMessage(null);
    setExecuted(null);
    setFunded(null);
    try {
      const res = await fetch('/api/nvdax-funding/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, amountSol: Number(amountSol) }),
      });
      const j = (await res.json()) as QuoteResponse;
      setQuote(j);
      setPhase(j.ok ? 'quoted' : 'idle');
      setMessage(j.ok ? 'Order received. Review the route, then convert.' : j.error ?? 'Quote failed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Quote failed.');
    } finally {
      setBusy(false);
    }
  }, [wallet, amountSol]);

  /** CONVERT: sign the Jupiter tx locally; server executes + verifies. */
  const convert = useCallback(async () => {
    if (!wallet || !publicKey || !signTransaction || !quote?.ok || !quote.transaction) return;
    setBusy(true);
    setMessage(null);
    try {
      const tx = Transaction.from(Buffer.from(quote.transaction, 'base64'));
      await prepareForSigning(tx, publicKey);
      const signed = await signTransaction(tx);
      const res = await fetch('/api/nvdax-funding/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, requestId: quote.requestId, signedTransaction: signed.serialize().toString('base64') }),
      });
      const j = (await res.json()) as ExecuteResponse;
      setExecuted(j);
      setPhase(j.ok ? 'confirmed' : 'idle');
      setMessage(j.ok ? 'Swap verified on-chain: +' + (Number(j.nvdaRawReceived ?? '0') / 1e8).toFixed(4) + ' NVDAx received.' : j.error ?? 'Execute failed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Signing or execution failed.');
    } finally {
      setBusy(false);
    }
  }, [wallet, publicKey, signTransaction, quote]);

  /** FUND: server builds fund_spl_rewards; we sign; server submits + verifies. */
  const fund = useCallback(async () => {
    if (!wallet || !publicKey || !signTransaction || !executed?.ok || !executed.nvdaRawReceived) return;
    setBusy(true);
    setMessage(null);
    try {
      const buildRes = await fetch('/api/nvdax-funding/build-fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, requestId: quote?.requestId, amountRaw: executed.nvdaRawReceived }),
      });
      const built = (await buildRes.json()) as BuildFundResponse;
      if (!built.ok || !built.transaction) {
        setMessage(built.error ?? 'Funding transaction could not be built.');
        return;
      }
      const tx = Transaction.from(Buffer.from(built.transaction, 'base64'));
      await prepareForSigning(tx, publicKey);
      const signed = await signTransaction(tx);
      const res = await fetch('/api/nvdax-funding/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, requestId: quote?.requestId, signedTransaction: signed.serialize().toString('base64') }),
      });
      const j = (await res.json()) as FundResponse;
      setFunded(j);
      setPhase(j.ok ? 'funded' : 'confirmed');
      setMessage(j.ok ? 'Funding verified: vault received ' + (Number(j.nvdaRawFunded ?? '0') / 1e8).toFixed(4) + ' NVDAx.' : j.error ?? 'Funding failed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Signing or funding failed.');
    } finally {
      setBusy(false);
    }
  }, [wallet, publicKey, signTransaction, executed, quote]);

  return { busy, amountSol, setAmountSol, phase, quote, executed, funded, message, wallet, getQuote, convert, fund };
}
