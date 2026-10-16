// fund_spl_rewards transaction builder + send/confirm — SERVER ONLY.
// NVDAx is a Token-2022 mint; funding goes through the SOLFLOW program's
// existing Token-2022 interfaces (FundSpl context) with the PINNED mint.
// No private keys exist here: the operator signs the unsigned transaction
// in their own wallet; this module only builds, relays and verifies.
import { createHash } from 'node:crypto';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

/** Associated Token Account derivation (standard PDA: [owner, tokenProgram, mint]). */
function deriveAta(mint: string, owner: string, tokenProgramId: string): string {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgramId).toBuffer(), new PublicKey(mint).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0].toBase58();
}
import { NVDAX_MINT_PINNED, NVDAX_VAULT_PINNED, SOLFLOW_PROGRAM_ID } from './jupiter.ts';
import { fetchTransactionInfo, type TxInfo, type VerifyDeps } from './jupiter-verify.ts';
import { mainnetRpcUrl } from '../providers/alchemy.ts';

export interface FundSplAccounts {
  globalState: string;
  rewardAsset: string;
  vault: string;
  funderAta: string;
  vaultAuthority: string;
  funder: string;
  tokenProgram: string;
}

/** Derive the program PDAs and cross-check the authoritative vault address. */
export function deriveFundSplAccounts(programId: string, funder: string): FundSplAccounts {
  const pid = new PublicKey(programId);
  const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global')], pid);
  const [rewardAsset] = PublicKey.findProgramAddressSync([Buffer.from('asset'), Buffer.from('NVDAX')], pid);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('spl_vault')], pid);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('vault_auth')], pid);
  if (vault.toBase58() !== NVDAX_VAULT_PINNED) {
    throw new Error('Derived spl_vault PDA ' + vault.toBase58() + ' does not match the authoritative NVDAx reward vault ' + NVDAX_VAULT_PINNED + ' — refusing to fund.');
  }
  const funderAta = deriveAta(NVDAX_MINT_PINNED, funder, TOKEN_2022_PROGRAM_ID.toBase58());
  return {
    globalState: globalState.toBase58(),
    rewardAsset: rewardAsset.toBase58(),
    vault: vault.toBase58(),
    funderAta,
    vaultAuthority: vaultAuthority.toBase58(),
    funder,
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
  };
}

function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(name).digest().subarray(0, 8);
}

export function bigIntToLeU64(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  let x = v;
  for (let i = 0; i < 8; i++) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

/**
 * Build the UNSIGNED fund_spl_rewards transaction. Raw Anchor instruction:
 * discriminator sha256("global:fund_spl_rewards")[0..8] + amount u64 LE.
 * Account order mirrors programs/solflow/src/lib.rs `pub struct FundSpl`:
 *   global_state (ro), reward_asset (mut), vault (mut), funder_ata (mut),
 *   vault_authority (ro), funder (signer, mut), token_program (ro)
 * The placeholder blockhash is refreshed client-side immediately before
 * signing so the transaction is valid at signature time.
 */
export function buildFundSplTransaction(programId: string, funder: string, amountRaw: bigint): { transactionBase64: string; accounts: FundSplAccounts } {
  if (amountRaw <= 0n) throw new Error('Funding amount must be positive.');
  const accounts = deriveFundSplAccounts(programId, funder);
  const data = Buffer.concat([anchorDiscriminator('global:fund_spl_rewards'), bigIntToLeU64(amountRaw)]);
  const ix = new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: new PublicKey(accounts.globalState), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(accounts.rewardAsset), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(accounts.vault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(accounts.funderAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(accounts.vaultAuthority), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(accounts.funder), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(accounts.tokenProgram), isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = new PublicKey(funder);
  tx.recentBlockhash = SystemProgram.programId.toBase58(); // placeholder, refreshed pre-sign
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { transactionBase64: Buffer.from(serialized).toString('base64'), accounts };
}

export interface FundSendResult {
  signature: string | null;
  tx: TxInfo | null;
  error?: string;
}

/** Send a signed funding transaction to mainnet RPC and wait for confirmation. */
export async function sendAndConfirmFunding(signedTransaction: string, deps?: VerifyDeps): Promise<FundSendResult> {
  const url = mainnetRpcUrl();
  if (!url) return { signature: null, tx: null, error: 'Mainnet RPC unavailable.' };
  const f = (deps && deps.fetchImpl) || fetch;
  let signature: string;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [signedTransaction, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }],
      }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (json.error || !json.result) {
      // Token-2022 transfer restrictions / issuer controls surface verbatim here.
      return { signature: null, tx: null, error: 'sendTransaction rejected: ' + (json.error?.message ?? 'unknown error') };
    }
    signature = json.result;
  } catch (e) {
    return { signature: null, tx: null, error: 'sendTransaction failed: ' + (e instanceof Error ? e.message : 'transport error') };
  }
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const tx = await fetchTransactionInfo(signature, deps);
    if (tx) return { signature, tx };
  }
  return { signature, tx: null, error: 'Transaction submitted (' + signature + ') but not yet visible on-chain. Funding is NOT credited — re-check later.' };
}

/** Default program id used by the funding routes. */
export function solflowProgramId(): string {
  return SOLFLOW_PROGRAM_ID;
}
