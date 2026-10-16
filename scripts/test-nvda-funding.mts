// Tests: Jupiter Swap API v2 SOL -> NVDAx conversion/funding flow.
// Run: node --experimental-strip-types --env-file=.env.local --no-warnings scripts/test-nvda-funding.mts
// Covers tasks 18.A–M. Pure logic + stubbed fetch; NO network, NO keys.
import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  NVDAX_MINT_PINNED,
  NVDAX_VAULT_PINNED,
  SOLFLOW_PROGRAM_ID,
  isAuthorizedOperator,
  jupiterLivePrereqs,
  operatorWallet,
} from '../lib/server/jupiter.ts';
import { createJupiterOrder, executeJupiterSwap, validateOrderResponse } from '../lib/server/jupiter-order.ts';
import { analyzeFundingTransaction, analyzeSwapTransaction, type TxInfo } from '../lib/server/jupiter-verify.ts';
import { buildFundSplTransaction, deriveFundSplAccounts } from '../lib/server/jupiter-fund.ts';
import {
  ConversionRecordError,
  createRecord,
  getRecord,
  markAwaitingSignature,
  markConfirmed,
  markFailed,
  markFunded,
  markSubmitted,
  newConversionStore,
} from '../lib/server/conversion-records.ts';
import { getNvdaConversionAdapter } from '../lib/solana/nvda-convert.ts';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string): void {
  if (cond) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    failures.push(label);
    console.log("  FAIL  " + label);
  }
}
function assertThrows(fn: () => unknown, label: string): { ok: boolean; msg: string } {
  try {
    fn();
    assert(false, label);
    return { ok: false, msg: '' };
  } catch (e) {
    assert(true, label);
    return { ok: true, msg: e instanceof Error ? e.message : String(e) };
  }
}

/** Async variant: awaits the promise and expects a rejection. */
async function assertThrowsAsync(fn: () => unknown | Promise<unknown>, label: string): Promise<{ ok: boolean; msg: string }> {
  try {
    await fn();
    assert(false, label);
    return { ok: false, msg: '' };
  } catch (e) {
    assert(true, label);
    return { ok: true, msg: e instanceof Error ? e.message : String(e) };
  }
}

// ---- env snapshot / mutation helpers (config/env prefers process.env) ----
const ENV_SNAPSHOT: Record<string, string | undefined> = {};
function setEnv(k: string, v: string | undefined): void {
  if (!(k in ENV_SNAPSHOT)) ENV_SNAPSHOT[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(ENV_SNAPSHOT)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const OP_WALLET = 'GPsLKasHcWib1dpSZNcitxaXfdLSDCJEE73qZ8qY4DRS';

/** Minimal valid versioned transaction (passes Jupiter-client decode gate). */
function makeUnsignedTxBase64(): string {
  const payer = new PublicKey(OP_WALLET).toBytes();
  const prog = SystemProgram.programId.toBytes();
  const parts: number[] = [];
  parts.push(0x80); // version byte: v0
  parts.push(1, 0, 1); // message header: 1 required sig, 0 readonly signed, 1 readonly unsigned
  parts.push(2, ...Array.from(payer), ...Array.from(prog)); // account keys
  parts.push(...Array.from(new Uint8Array(32))); // recent blockhash
  parts.push(1, 1, 1, 0, 0); // 1 instruction: programIdIndex=1, 1 account [0], data len 0
  const msg = Uint8Array.from(parts);
  // transaction: signature count=1, 64 zero bytes (unsigned placeholder), message
  const tx = Uint8Array.from([1, ...Array.from(new Uint8Array(64)), ...msg]);
  // verify with the exact gate production uses
  VersionedTransaction.deserialize(tx);
  return Buffer.from(tx).toString('base64');
}

/** Fake fetch factory recording calls and returning canned responses. */
function stubFetch(responses: Array<{ status: number; body: unknown }>): { fetchImpl: typeof fetch; calls: number } {
  let calls = 0;
  const impl = (async () => {
    const r = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetchImpl: impl, get calls() { return calls; } };
}

function validLiveEnv(): void {
  setEnv('NEXT_PUBLIC_DEMO_MODE', 'false');
  setEnv('NEXT_PUBLIC_NVDA_SWAP_ADAPTER', 'jupiter-swap-v2');
  setEnv('NEXT_PUBLIC_NVDA_MINT', NVDAX_MINT_PINNED);
  setEnv('ADMIN_WALLET', OP_WALLET);
  setEnv('JUPITER_API_KEY', 'test-key-not-real');
  setEnv('ALCHEMY_API_KEY', process.env.ALCHEMY_API_KEY ?? 'test-rpc-key');
}

/** Build a synthetic getTransaction result (jsonParsed shape). */
function makeTxInfo(opts: {
  succeeded?: boolean;
  takerSigner?: boolean;
  takerSolDebit?: number;
  nvdaMint?: string;
  nvdaOwner?: string;
  nvdaDelta?: string;
  vaultMintDelta?: string;
}): TxInfo {
  const taker = OP_WALLET;
  const debit = opts.takerSolDebit ?? 500_000_000;
  const mint = opts.nvdaMint ?? NVDAX_MINT_PINNED;
  const nvdaDelta = opts.nvdaDelta ?? '100000000';
  const keys = [
    { pubkey: taker, signer: opts.takerSigner ?? true, writable: true },
    { pubkey: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', signer: false, writable: false },
  ];
  return {
    slot: 123,
    meta: {
      err: opts.succeeded === false ? { InstructionError: [0, 'custom'] } : null,
      fee: 5000,
      preBalances: [2_000_000_000, 1],
      postBalances: [2_000_000_000 - debit, 1],
      preTokenBalances: [
        { accountIndex: 0, mint, owner: taker, uiTokenAmount: { amount: '0' } },
      ],
      postTokenBalances: [
        { accountIndex: 0, mint, owner: opts.nvdaOwner ?? taker, uiTokenAmount: { amount: nvdaDelta } },
      ],
    },
    transaction: { message: { accountKeys: keys } },
  };
}

console.log('\n[FT1] Demo conversion still works (A)');
{
  setEnv('NEXT_PUBLIC_DEMO_MODE', 'true');
  const adapter = getNvdaConversionAdapter();
  assert(adapter.id === 'demo-simulated' && adapter.simulated, 'demo mode resolves to the labeled simulated adapter');
  const q = adapter.quote(1_000_000_000n);
  assert(q !== null && q.simulated && q.nvdaRawOut === 100_000_000n, 'demo quote works (1 SOL = 1 NVDAx test rate)');

console.log('\n[FT2] Missing JUPITER_API_KEY fails closed (B)');
{
  validLiveEnv();
  setEnv('JUPITER_API_KEY', '');
  const prereqs = jupiterLivePrereqs();
  assert(!prereqs.ok && prereqs.reasons.some((r) => r.includes('JUPITER_API_KEY')), 'prereqs report the missing server key');
  const r = await assertThrowsAsync(() => createJupiterOrder(500_000_000, { fetchImpl: stubFetch([]).fetchImpl }), 'order creation fails closed without the key');
  assert(r.ok && r.msg.includes('JUPITER_API_KEY'), 'error names the missing key');
}

console.log('\n[FT3] Wrong NVDAx mint env fails closed (C)');
{
  validLiveEnv();
  setEnv('NEXT_PUBLIC_NVDA_MINT', 'WrongMint111111111111111111111111111111111');
  const r = await assertThrowsAsync(() => createJupiterOrder(500_000_000, { fetchImpl: stubFetch([]).fetchImpl }), 'order creation refuses a mint mismatch');
  assert(r.ok && r.msg.includes('pinned verified NVDAx'), 'error names the pinned mint rule');
}

console.log('\n[FT4] Zero quote fails (D)');
{
  validLiveEnv();
  const r = assertThrows(
    () => validateOrderResponse({ requestId: 'r1', transaction: makeUnsignedTxBase64(), outAmount: '0', inAmount: '500000000', router: 'Jupiter' }, 500_000_000, { maxPriceImpactBps: 300, minOutRaw: null, maxSolPerExecution: 1_000_000_000 }),
    'zero output order is refused',
  );
  assert(r.ok, 'zero-output check triggers');
  const r2 = assertThrows(
    () => validateOrderResponse({ requestId: 'r1', transaction: makeUnsignedTxBase64(), outAmount: '5', inAmount: '500000000', router: 'Jupiter' }, 500_000_000, { maxPriceImpactBps: 300, minOutRaw: 100n, maxSolPerExecution: 1_000_000_000 }),
    'output below NVDA_SWAP_MIN_OUT_AMOUNT is refused',
  );
  assert(r2.ok, 'min-out floor check triggers');
}

console.log('\n[FT5] Missing Jupiter transaction fails (E)');
{
  validLiveEnv();
  const safety = { maxPriceImpactBps: 300, minOutRaw: null, maxSolPerExecution: 1_000_000_000 };
  const a = assertThrows(() => validateOrderResponse({ requestId: 'r1', transaction: '', outAmount: '100', inAmount: '500000000' }, 500_000_000, safety), 'empty transaction refused');
  const b = assertThrows(() => validateOrderResponse({ requestId: 'r1', transaction: null, outAmount: '100', inAmount: '500000000' }, 500_000_000, safety), 'null transaction refused');
  const c = assertThrows(() => validateOrderResponse({ requestId: '', transaction: 'tx', outAmount: '100', inAmount: '500000000' }, 500_000_000, safety), 'missing requestId refused');
  assert(a.ok && b.ok && c.ok, 'all three structural failures fail closed');
}

console.log('\n[FT6] Unauthorized operator wallet fails (F)');
{
  validLiveEnv();
  setEnv('ADMIN_WALLET', OP_WALLET);
  assert(isAuthorizedOperator(OP_WALLET), 'configured operator is authorized');
  assert(!isAuthorizedOperator('NotTheOperator111111111111111111111111111'), 'an arbitrary connected wallet is NOT authorized');
  assert(operatorWallet() === OP_WALLET, 'operator wallet resolves server-side only');
}

console.log('\n[FT7] Bad signed transaction fails (G)');
{
  validLiveEnv();
  const stub = stubFetch([{ status: 200, body: { signature: 'SHOULD_NOT_BE_USED' } }]);
  const res = await executeJupiterSwap('req-1', 'definitely-not-a-transaction', { fetchImpl: stub.fetchImpl });
  assert(!res.ok && res.code === 'INVALID_SIGNED_TRANSACTION', 'undecodable payload refused before any network call');
  assert(stub.calls === 0, 'Jupiter was never contacted for a bad payload');
}


console.log('\n[FT8] Jupiter execution failure -> no reward funding (H)');
{
  validLiveEnv();
  const res = await executeJupiterSwap('req-1', makeUnsignedTxBase64(), {
    fetchImpl: stubFetch([{ status: 200, body: { status: 'FAILED', error: { description: 'landing failed' } } }]).fetchImpl,
  });
  assert(!res.ok && res.code === 'FAILED_LANDING', 'failed landing classified correctly');
  const store = newConversionStore();
  const rec = createRecord(store, { requestId: 'r-h', operatorWallet: OP_WALLET, inputLamports: 500_000_000, quotedOutRaw: 100n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 10 });
  markFailed(store, rec.requestId, res.message);
  let blocked = false;
  try { markFunded(store, rec.requestId, 'fundsig-1'); } catch (e) { blocked = e instanceof ConversionRecordError; }
  assert(blocked, 'funding is NOT allowed after a failed swap');
}

console.log('\n[FT9] Successful swap + verified receipt -> fund allowed (I)');
{
  validLiveEnv();
  const store = newConversionStore();
  createRecord(store, { requestId: 'r-i', operatorWallet: OP_WALLET, inputLamports: 500_000_000, quotedOutRaw: 100_000_000n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 10 });
  markSubmitted(store, 'r-i', 'swap-sig-1');
  const v = analyzeSwapTransaction(makeTxInfo({ nvdaDelta: '100000000' }), { taker: OP_WALLET });
  assert(v.ok && v.nvdaRawReceived === 100_000_000n && v.solDebited > 0n, 'on-chain swap verification passes (signer, SOL debit, exact NVDAx)');
  markConfirmed(store, 'r-i', v.nvdaRawReceived);
  const rec = getRecord(store, 'r-i');
  assert(rec !== null && rec.status === 'confirmed', 'conversion confirmed after independent verification');
  markFunded(store, 'r-i', 'fund-sig-1');
  assert(getRecord(store, 'r-i')?.status === 'funded', 'funding recorded after verified fund_spl_rewards');
}

console.log('\n[FT10] Duplicate conversion / swap signature rejected (J)');
{
  const store = newConversionStore();
  createRecord(store, { requestId: 'r-j1', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 1n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 });
  const dup = assertThrows(() => createRecord(store, { requestId: 'r-j1', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 1n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 }), 'duplicate requestId rejected');
  assert(dup.ok, 'duplicate conversion record refused');
  createRecord(store, { requestId: 'r-j2', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 1n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 });
  markSubmitted(store, 'r-j2', 'same-swap-sig');
  const replay = assertThrows(() => {
    createRecord(store, { requestId: 'r-j3', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 1n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 });
    markSubmitted(store, 'r-j3', 'same-swap-sig');
  }, 'same swap signature credited twice rejected');
  assert(replay.ok, 'swap-sig replay protection holds');
}


console.log('\n[FT11] Duplicate funding rejected (K)');
{
  const store = newConversionStore();
  createRecord(store, { requestId: 'r-k1', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 10n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 });
  markSubmitted(store, 'r-k1', 'swap-sig-k1');
  markConfirmed(store, 'r-k1', 10n);
  markFunded(store, 'r-k1', 'fund-sig-k1');
  const again = assertThrows(() => markFunded(store, 'r-k1', 'fund-sig-k1'), 'same conversion funded twice rejected');
  assert(again.ok, 'double funding of one conversion refused');
  createRecord(store, { requestId: 'r-k2', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 10n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 });
  markSubmitted(store, 'r-k2', 'swap-sig-k2');
  markConfirmed(store, 'r-k2', 10n);
  const reuse = assertThrows(() => markFunded(store, 'r-k2', 'fund-sig-k1'), 'funding signature reuse across conversions rejected');
  assert(reuse.ok, 'cross-conversion funding-sig replay refused');
}


console.log('\n[FT12] Token-2022 mint validation (L)');
{
  const wrong = analyzeSwapTransaction(makeTxInfo({ nvdaMint: 'FakeMint11111111111111111111111111111111111', nvdaDelta: '100000000' }), { taker: OP_WALLET });
  assert(!wrong.ok && (wrong.error ?? '').includes('NOT the exact pinned NVDAx'), 'lookalike mint receipt is refused');
  const zero = analyzeSwapTransaction(makeTxInfo({ nvdaDelta: '0' }), { taker: OP_WALLET });
  assert(!zero.ok, 'zero NVDAx receipt is refused');
  const accounts = deriveFundSplAccounts(SOLFLOW_PROGRAM_ID, OP_WALLET);
  assert(accounts.vault === NVDAX_VAULT_PINNED, 'derived spl_vault PDA equals the authoritative vault FjHv…');
  assert(accounts.tokenProgram === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'funding uses the Token-2022 program only');
  const badVault = assertThrows(() => deriveFundSplAccounts('FtyqC5rfgSfENhRJRcWXYAPW7RmJAsHqNQzTGxKs6uwL', OP_WALLET), 'foreign program (wrong vault PDA) refused');
  assert(badVault.ok, 'vault cross-check refuses non-authoritative PDAs');
  const built = buildFundSplTransaction(SOLFLOW_PROGRAM_ID, OP_WALLET, 123456789n);
  const tx = Transaction.from(Buffer.from(built.transactionBase64, 'base64'));
  assert(tx.instructions.length === 1 && tx.instructions[0].keys.length === 7, 'fund_spl_rewards instruction carries the exact 7-account FundSpl context');
  const disc = createHash('sha256').update('global:fund_spl_rewards').digest().subarray(0, 8);
  assert(tx.instructions[0].data.subarray(0, 8).equals(disc), 'anchor discriminator is correct');
  assert(tx.instructions[0].data.subarray(8).readBigUInt64LE() === 123456789n, 'amount is encoded as u64 LE');
  // Vault receipt verification: exact mint + exact amount at the vault token account.
  const vaultTx = {
    slot: 5,
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000, 1],
      postBalances: [999_000, 1],
      preTokenBalances: [{ accountIndex: 1, mint: NVDAX_MINT_PINNED, owner: OP_WALLET, uiTokenAmount: { amount: '0' } }],
      postTokenBalances: [{ accountIndex: 1, mint: NVDAX_MINT_PINNED, owner: OP_WALLET, uiTokenAmount: { amount: '123456789' } }],
    },
    transaction: { message: { accountKeys: [{ pubkey: OP_WALLET, signer: true, writable: true }, { pubkey: NVDAX_VAULT_PINNED, signer: false, writable: true }] } },
  } as unknown as TxInfo;
  const fv = analyzeFundingTransaction(vaultTx, { vaultAddress: NVDAX_VAULT_PINNED, expectedRaw: 123456789n });
  assert(fv.ok && fv.nvdaRawFunded === 123456789n, 'vault receipt verification passes (exact mint, exact verified amount)');
  const fvWrong = analyzeFundingTransaction(vaultTx, { vaultAddress: NVDAX_VAULT_PINNED, expectedRaw: 1n });
  assert(!fvWrong.ok, 'vault receipt amount mismatch is refused');
}


console.log('\n[FT13] Vault receipt + live prereq gate + state machine');
{
  validLiveEnv();
  const prereqs = jupiterLivePrereqs();
  assert(prereqs.ok, 'all live prerequisites satisfied in the live test env');
  setEnv('NEXT_PUBLIC_DEMO_MODE', 'true');
  const demoBlocked = jupiterLivePrereqs();
  assert(!demoBlocked.ok && demoBlocked.reasons[0].includes('DEMO_MODE'), 'demo mode blocks live execution first');
  validLiveEnv();
  const store = newConversionStore();
  createRecord(store, { requestId: 'r-m', operatorWallet: OP_WALLET, inputLamports: 1, quotedOutRaw: 5n, nvdaMint: NVDAX_MINT_PINNED, router: 'Jupiter', priceImpactBps: 0 });
  markAwaitingSignature(store, 'r-m');
  assert(getRecord(store, 'r-m')?.status === 'awaiting_signature', 'quoted -> awaiting_signature transition works');
  const skip = assertThrows(() => markFunded(store, 'r-m', 'fund-sig-x'), 'funding before on-chain verification rejected');
  assert(skip.ok, 'never funded until verified');
}

restoreEnv();

console.log('\n=== SUMMARY: ' + pass + ' passed, ' + fail + ' failed ===');
if (fail > 0) {
  console.log('FAILED: ' + failures.join(' | '));
  process.exit(1);
}

}
