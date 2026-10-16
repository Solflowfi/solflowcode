// On-chain verification for the SOL -> NVDAx conversion flow — SERVER ONLY.
// Jupiter's API response is NEVER trusted alone: the landed transaction is
// re-read from the configured mainnet RPC and analyzed here.
import { NVDAX_MINT_PINNED } from './jupiter.ts';
import { mainnetRpcUrl } from '../providers/alchemy.ts';

export type FetchImpl = typeof fetch;
export interface VerifyDeps {
  fetchImpl?: FetchImpl;
}

interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

/** Shape of Solana getTransaction (jsonParsed) used by the analyzers. */
export interface TxInfo {
  slot: number;
  meta: {
    err: unknown;
    fee: number;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances?: TokenBalanceEntry[];
    postTokenBalances?: TokenBalanceEntry[];
  } | null;
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean } | string>;
    };
  };
}

function accountKeyAt(tx: TxInfo, index: number): string {
  const k = tx.transaction.message.accountKeys[index];
  return typeof k === 'string' ? k : k.pubkey;
}

function isSigner(tx: TxInfo, pubkey: string): boolean {
  return tx.transaction.message.accountKeys.some((k) => (typeof k === 'string' ? false : k.pubkey === pubkey && k.signer));
}

function tokenDelta(tx: TxInfo, match: { mint?: string; owner?: string; account?: string }): { delta: bigint; account: string | null } {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const pick = (arr: TokenBalanceEntry[]) =>
    arr.filter(
      (b) =>
        (match.mint ? b.mint === match.mint : true) &&
        (match.owner ? b.owner === match.owner : true) &&
        (match.account ? accountKeyAt(tx, b.accountIndex) === match.account : true),
    );
  const preSum = pick(pre).reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount), 0n);
  const postEntries = pick(post);
  const postSum = postEntries.reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount), 0n);
  return { delta: postSum - preSum, account: postEntries.length > 0 ? accountKeyAt(tx, postEntries[0].accountIndex) : null };
}

/** Raw JSON-RPC getTransaction against mainnet (injectable fetch for tests). */
export async function fetchTransactionInfo(signature: string, deps?: VerifyDeps): Promise<TxInfo | null> {
  const url = mainnetRpcUrl();
  if (!url) return null;
  const f = (deps && deps.fetchImpl) || fetch;
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { result: TxInfo | null };
  return json.result;
}

export interface SwapVerification {
  ok: boolean;
  nvdaRawReceived: bigint;
  solDebited: bigint;
  error?: string;
}

/**
 * Pure analyzer: verifies a landed swap transaction INDEPENDENTLY of Jupiter:
 * tx exists, succeeded, the operator actually signed it, SOL was debited from
 * the operator, and the exact pinned NVDAx mint was received into a token
 * account owned by the operator. Mint equality is exact — a lookalike mint or
 * any other token received by the operator is REFUSED.
 */
export function analyzeSwapTransaction(tx: TxInfo | null, opts: { taker: string; solDebitMinLamports?: bigint }): SwapVerification {
  if (!tx) return { ok: false, nvdaRawReceived: 0n, solDebited: 0n, error: 'Transaction not found on-chain (not yet confirmed or dropped).' };
  if (tx.meta && tx.meta.err) return { ok: false, nvdaRawReceived: 0n, solDebited: 0n, error: 'Transaction failed on-chain: ' + JSON.stringify(tx.meta.err) };
  if (!isSigner(tx, opts.taker)) return { ok: false, nvdaRawReceived: 0n, solDebited: 0n, error: 'Operator wallet is not a signer of the landed transaction.' };
  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => (typeof k === 'string' ? false : k.pubkey === opts.taker));
  if (idx < 0 || !tx.meta) return { ok: false, nvdaRawReceived: 0n, solDebited: 0n, error: 'Operator wallet not found in transaction accounts.' };
  const solDebited = BigInt(Math.max(0, tx.meta.preBalances[idx] - tx.meta.postBalances[idx]));
  if (solDebited <= (opts.solDebitMinLamports ?? 0n)) {
    return { ok: false, nvdaRawReceived: 0n, solDebited, error: 'No meaningful SOL debit detected for the operator wallet.' };
  }
  const nvdaDelta = tokenDelta(tx, { mint: NVDAX_MINT_PINNED, owner: opts.taker });
  if (nvdaDelta.delta <= 0n) {
    const anyMintDelta = tokenDelta(tx, { owner: opts.taker });
    if (anyMintDelta.delta > 0n) {
      return { ok: false, nvdaRawReceived: 0n, solDebited, error: 'Operator received a token, but its mint is NOT the exact pinned NVDAx mint — refusing.' };
    }
    return { ok: false, nvdaRawReceived: 0n, solDebited, error: 'No NVDAx (exact pinned mint) credit detected for the operator wallet.' };
  }
  return { ok: true, nvdaRawReceived: nvdaDelta.delta, solDebited };
}

export interface FundingVerification {
  ok: boolean;
  nvdaRawFunded: bigint;
  error?: string;
}

/**
 * Pure analyzer: verifies the fund_spl_rewards transaction landed and that
 * the authoritative NVDAx reward vault actually received the exact pinned
 * NVDAx mint at the expected raw amount (read from the RPC token balances —
 * never from frontend-supplied numbers).
 */
export function analyzeFundingTransaction(tx: TxInfo | null, opts: { vaultAddress: string; expectedRaw: bigint }): FundingVerification {
  if (!tx) return { ok: false, nvdaRawFunded: 0n, error: 'Funding transaction not found on-chain.' };
  if (tx.meta && tx.meta.err) return { ok: false, nvdaRawFunded: 0n, error: 'Funding transaction failed on-chain: ' + JSON.stringify(tx.meta.err) };
  const vaultEntry = tokenDelta(tx, { mint: NVDAX_MINT_PINNED, account: opts.vaultAddress });
  if (vaultEntry.delta <= 0n) {
    return { ok: false, nvdaRawFunded: 0n, error: 'Vault ' + opts.vaultAddress + ' received no NVDAx (exact pinned mint) in this transaction.' };
  }
  if (vaultEntry.delta !== opts.expectedRaw) {
    return { ok: false, nvdaRawFunded: vaultEntry.delta, error: 'Vault received ' + vaultEntry.delta.toString() + ' raw units but the verified swap amount was ' + opts.expectedRaw.toString() + '.' };
  }
  return { ok: true, nvdaRawFunded: vaultEntry.delta };
}
