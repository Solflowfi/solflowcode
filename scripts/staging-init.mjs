// SOLFLOW STAGING ($TST) mainnet initialization runner — OPERATOR TOOL.
//
// Dedicated STAGING program ONLY. Refuses the production program ID and
// refuses to run unless staging mode is explicitly enabled.
//
//   node --experimental-strip-types --env-file=.env.local scripts/staging-init.mjs
//   node --experimental-strip-types --env-file=.env.local scripts/staging-init.mjs --execute --step initialize --keypair .devnet/funder.json
//
// Steps (order matters): initialize, init_sol_asset, init_spl_asset,
// init_fee_source, init_flow_staking (TST = Token-2022: the mint's actual
// token program is verified on-chain and passed to the instruction).
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';

const PRODUCTION_ID = new PublicKey('DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ');
const TOKEN_CLASSIC = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const STAGING_ID = (process.env.NEXT_PUBLIC_STAGING_PROGRAM_ID ?? '').trim();
const TST_MINT = (process.env.NEXT_PUBLIC_FLOW_MINT ?? '').trim(); // staging staking mint
const CREATOR_PAYOUT = process.env.NEXT_PUBLIC_CREATOR_PAYOUT ?? null;
const TREASURY = process.env.NEXT_PUBLIC_TREASURY ?? null;
const NVDA_MINT = process.env.NEXT_PUBLIC_NVDA_MINT ?? null;

const disc = (n) => createHash('sha256').update(n).digest().subarray(0, 8);
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pub = (s) => new PublicKey(s);

const problems = [];
if (!STAGING_ID) problems.push('NEXT_PUBLIC_STAGING_PROGRAM_ID missing.');
if (STAGING_ID && STAGING_ID === PRODUCTION_ID.toBase58()) problems.push('REFUSED: staging id equals the production program id.');
if (process.env.NEXT_PUBLIC_STAKING_TEST_MODE !== 'true') problems.push('NEXT_PUBLIC_STAKING_TEST_MODE must be true.');
if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'false') problems.push('NEXT_PUBLIC_DEMO_MODE must be false.');
if (process.env.NEXT_PUBLIC_SOLANA_NETWORK !== 'mainnet-beta') problems.push('NEXT_PUBLIC_SOLANA_NETWORK must be mainnet-beta.');
if (!TST_MINT) problems.push('NEXT_PUBLIC_FLOW_MINT (TST mint) missing.');
if (!CREATOR_PAYOUT) problems.push('NEXT_PUBLIC_CREATOR_PAYOUT missing.');
if (!TREASURY) problems.push('NEXT_PUBLIC_TREASURY missing.');
if (!NVDA_MINT) problems.push('NEXT_PUBLIC_NVDA_MINT missing.');
if (problems.length) {
  console.error('REFUSED — configuration problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const PROGRAM_ID = pub(STAGING_ID);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const GLOBAL = pda([Buffer.from('global')]);
const SOL_VAULT = pda([Buffer.from('sol_vault')]);
const VAULT_AUTH = pda([Buffer.from('vault_auth')]);
const NVDA_PENDING = pda([Buffer.from('nvda_pending')]);
const ASSET_SOL = pda([Buffer.from('asset'), Buffer.from('SOL')]);
const ASSET_NVDAX = pda([Buffer.from('asset'), Buffer.from('NVDAX')]);
const SPL_VAULT = pda([Buffer.from('spl_vault')]);
const TST_VAULT = pda([Buffer.from('flow_vault'), pub(TST_MINT).toBuffer()]);

const rpc = process.env.ALCHEMY_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const conn = new Connection(rpc, 'confirmed');

// Fail closed: the staging program must be deployed on MAINNET before init.
async function assertDeployed() {
  const info = await conn.getAccountInfo(PROGRAM_ID);
  if (!info) throw new Error('Staging program not found on mainnet — deploy it first (solana program deploy).');
  if (!info.executable || info.owner.toBase58() !== 'BPFLoaderUpgradeab1e11111111111111111111111') {
    throw new Error('Staging program account exists but is not an executable BPF program.');
  }
  return info;
}

function ix(step, authority, tokenProgram) {
  const base = { programId: PROGRAM_ID };
  if (step === 'initialize') return { ...base, keys: [
    { pubkey: GLOBAL, isSigner: false, isWritable: true }, { pubkey: SOL_VAULT, isSigner: false, isWritable: true },
    { pubkey: VAULT_AUTH, isSigner: false, isWritable: true }, { pubkey: NVDA_PENDING, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('global:initialize'), pub(CREATOR_PAYOUT).toBuffer(), pub(TREASURY).toBuffer()]) };
  if (step === 'init_sol_asset') return { ...base, keys: [
    { pubkey: GLOBAL, isSigner: false, isWritable: false }, { pubkey: ASSET_SOL, isSigner: false, isWritable: true },
    { pubkey: SOL_VAULT, isSigner: false, isWritable: true }, { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('global:init_sol_asset'), u16le(7000)]) };
  if (step === 'init_spl_asset') return { ...base, keys: [
    { pubkey: GLOBAL, isSigner: false, isWritable: false }, { pubkey: ASSET_NVDAX, isSigner: false, isWritable: true },
    { pubkey: pub(NVDA_MINT), isSigner: false, isWritable: true }, { pubkey: SPL_VAULT, isSigner: false, isWritable: true },
    { pubkey: VAULT_AUTH, isSigner: false, isWritable: false }, { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: TOKEN_2022, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('global:init_spl_asset'), u16le(3000)]) };
  if (step === 'init_fee_source') return { ...base, keys: [
    { pubkey: pda([Buffer.from('feesource'), pub(CREATOR_PAYOUT).toBuffer()]), isSigner: false, isWritable: true },
    { pubkey: pub(CREATOR_PAYOUT), isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('global:init_fee_source'), Buffer.from([1])]) };
  if (step === 'init_flow_staking') return { ...base, keys: [
    { pubkey: GLOBAL, isSigner: false, isWritable: true }, { pubkey: pub(TST_MINT), isSigner: false, isWritable: true },
    { pubkey: TST_VAULT, isSigner: false, isWritable: true }, { pubkey: VAULT_AUTH, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: true, isWritable: true }, { pubkey: tokenProgram, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: disc('global:init_flow_staking') };
  throw new Error('Unknown step: ' + step);
}

const STEPS = ['initialize', 'init_sol_asset', 'init_spl_asset', 'init_fee_source', 'init_flow_staking'];
console.log('SOLFLOW STAGING ($TST) initialization plan');
console.log('  staging program:  ', PROGRAM_ID.toBase58());
console.log('  production (NO):  ', PRODUCTION_ID.toBase58());
console.log('  global_state PDA: ', GLOBAL.toBase58());
console.log('  sol_vault PDA:    ', SOL_VAULT.toBase58());
console.log('  vault_auth PDA:   ', VAULT_AUTH.toBase58());
console.log('  nvda_pending PDA: ', NVDA_PENDING.toBase58());
console.log('  spl_vault PDA:    ', SPL_VAULT.toBase58());
console.log('  TST staking vault:', TST_VAULT.toBase58());
console.log('  creator payout:   ', CREATOR_PAYOUT);
console.log('  treasury:         ', TREASURY);
console.log('  TST mint:         ', TST_MINT);

let tp = TOKEN_CLASSIC;
try {
  const mi = await conn.getAccountInfo(pub(TST_MINT));
  if (!mi) throw new Error('TST mint account does not exist on mainnet.');
  tp = mi.owner;
  console.log('  TST token program:', tp.toBase58(), tp.equals(TOKEN_2022) ? '(Token-2022)' : tp.equals(TOKEN_CLASSIC) ? '(classic SPL)' : '(UNEXPECTED OWNER - refusing)');
  if (!tp.equals(TOKEN_2022) && !tp.equals(TOKEN_CLASSIC)) process.exit(1);
} catch (e) {
  console.error('TST mint verification failed:', e instanceof Error ? e.message : e);
  process.exit(1);
}

let deployedInfo = null;
try { deployedInfo = await assertDeployed(); } catch (e) {
  console.log('  [deploy-check] ' + (e instanceof Error ? e.message : e));
}
console.log('  [deploy-check] staging program ' + (deployedInfo ? 'DEPLOYED (executable, ' + deployedInfo.data.length + ' bytes program data)' : 'NOT DEPLOYED yet'));

for (const step of STEPS) {
  try {
    ix(step, pub(CREATOR_PAYOUT), tp);
    console.log('  [' + step + '] ready');
  } catch (e) {
    console.log('  [' + step + '] ERROR - ' + (e instanceof Error ? e.message : String(e)));
  }
}

const execIdx = process.argv.indexOf('--execute');
if (execIdx < 0) {
  console.log('\nDRY RUN ONLY - no transactions sent.');
  console.log('Execute one step at a time (order matters):');
  console.log('  node --experimental-strip-types --env-file=.env.local scripts/staging-init.mjs --execute --step <step> --keypair .devnet/funder.json');
  process.exit(0);
}

if (!deployedInfo) { console.error('REFUSED - staging program is not deployed on mainnet.'); process.exit(1); }
const stepArg = process.argv[process.argv.indexOf('--step') + 1];
const kpArg = process.argv.indexOf('--keypair');
if (!STEPS.includes(stepArg) || kpArg < 0 || !process.argv[kpArg + 1]) {
  console.error('REFUSED - --execute requires --step <name> and --keypair <staging-authority-keypair.json>.');
  process.exit(1);
}
const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(process.argv[kpArg + 1], 'utf8'))));
if (!kp.publicKey.equals(pub(CREATOR_PAYOUT))) {
  console.log('NOTE: authority ' + kp.publicKey.toBase58() + ' differs from NEXT_PUBLIC_CREATOR_PAYOUT - initialize pins GlobalState.authority to the SIGNER.');
}
const balance = await conn.getBalance(kp.publicKey);
if (balance < 50_000_000) {
  console.error('REFUSED - authority ' + kp.publicKey.toBase58() + ' has ' + balance / 1e9 + ' SOL on mainnet; fund it first (>0.05 SOL for init; ~4.3+ SOL for the program deploy).');
  process.exit(1);
}
const tx = new Transaction();
tx.add(new TransactionInstruction(ix(stepArg, kp.publicKey, tp)));
tx.feePayer = kp.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
tx.sign(kp);
const sig = await conn.sendTransaction(tx, [kp]);
console.log('submitted:', sig);
const conf = await conn.confirmTransaction(sig, 'confirmed');
if (conf.value.err) { console.error('FAILED:', JSON.stringify(conf.value.err)); process.exit(1); }
appendFileSync('.devnet/staging_init_log.txt', new Date().toISOString() + ' step=' + stepArg + ' sig=' + sig + '\n');
console.log('CONFIRMED - step ' + stepArg + ' complete.');


