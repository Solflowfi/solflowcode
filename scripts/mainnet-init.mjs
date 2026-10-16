// SOLFLOW mainnet initialization runner — OPERATOR TOOL (never the web app).
//
// Prepares + (only with explicit flags) executes the on-chain initialization
// sequence on MAINNET. Fails clearly when the $FLOW mint is missing.
//
//   node scripts/mainnet-init.mjs                     # dry-run plan (no tx)
//   node scripts/mainnet-init.mjs --execute --step initialize --keypair <kp.json>
//
// Steps (order matters):
//   initialize        — pins creator_payout + treasury, creates vault PDAs
//   init_sol_asset    — 7000 bps SOL reward asset
//   init_spl_asset    — 3000 bps NVDAx reward asset (Token-2022, pinned mint)
//   init_fee_source   — whitelist the creator wallet (enabled=true)
//   init_flow_staking — requires NEXT_PUBLIC_FLOW_MINT (fails without it)
//
// NEVER run this without independently verifying every step. No private key
// is read unless --keypair is passed explicitly on the operator's machine.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID ?? 'DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ');
const CREATOR_PAYOUT = process.env.NEXT_PUBLIC_CREATOR_PAYOUT ?? null;
const TREASURY = process.env.NEXT_PUBLIC_TREASURY ?? null;
const NVDA_MINT = process.env.NEXT_PUBLIC_NVDA_MINT ?? null;
const FLOW_MINT = (process.env.NEXT_PUBLIC_FLOW_MINT ?? '').trim();
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const disc = (name) => createHash('sha256').update(name).digest().subarray(0, 8);
const u16le = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const pub = (s) => new PublicKey(s);

const GLOBAL = pda([Buffer.from('global')]);
const SOL_VAULT = pda([Buffer.from('sol_vault')]);
const VAULT_AUTH = pda([Buffer.from('vault_auth')]);
const NVDA_PENDING = pda([Buffer.from('nvda_pending')]);
const ASSET_SOL = pda([Buffer.from('asset'), Buffer.from('SOL')]);
const ASSET_NVDAX = pda([Buffer.from('asset'), Buffer.from('NVDAX')]);
const SPL_VAULT = pda([Buffer.from('spl_vault')]);

// Env sanity — fail closed BEFORE any network activity.
const problems = [];
if (!CREATOR_PAYOUT) problems.push('NEXT_PUBLIC_CREATOR_PAYOUT missing.');
if (!TREASURY) problems.push('NEXT_PUBLIC_TREASURY missing.');
if (!NVDA_MINT) problems.push('NEXT_PUBLIC_NVDA_MINT missing.');
if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'false') problems.push('NEXT_PUBLIC_DEMO_MODE must be false for mainnet initialization.');
if (process.env.NEXT_PUBLIC_SOLANA_NETWORK !== 'mainnet-beta') problems.push('NEXT_PUBLIC_SOLANA_NETWORK must be mainnet-beta for mainnet initialization.');
if (problems.length) {
  console.error('REFUSED — configuration problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const stepNeeds = {
  initialize: [],
  init_sol_asset: [],
  init_spl_asset: [],
  init_fee_source: [],
  init_flow_staking: ['NEXT_PUBLIC_FLOW_MINT'],
};

function buildInstruction(step, authority) {
  switch (step) {
    case 'initialize':
      return [new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: GLOBAL, isSigner: false, isWritable: true },
          { pubkey: SOL_VAULT, isSigner: false, isWritable: true },
          { pubkey: VAULT_AUTH, isSigner: false, isWritable: true },
          { pubkey: NVDA_PENDING, isSigner: false, isWritable: true },
          { pubkey: authority, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('global:initialize'), pub(CREATOR_PAYOUT).toBuffer(), pub(TREASURY).toBuffer()]),
      })];
    case 'init_sol_asset':
      return [new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: GLOBAL, isSigner: false, isWritable: false },
          { pubkey: ASSET_SOL, isSigner: false, isWritable: true },
          { pubkey: SOL_VAULT, isSigner: false, isWritable: true },
          { pubkey: authority, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('global:init_sol_asset'), u16le(7000)]),
      })];
    case 'init_spl_asset':
      return [new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: GLOBAL, isSigner: false, isWritable: false },
          { pubkey: ASSET_NVDAX, isSigner: false, isWritable: true },
          { pubkey: pub(NVDA_MINT), isSigner: false, isWritable: true },
          { pubkey: SPL_VAULT, isSigner: false, isWritable: true },
          { pubkey: VAULT_AUTH, isSigner: false, isWritable: false },
          { pubkey: authority, isSigner: true, isWritable: true },
          { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('global:init_spl_asset'), u16le(3000)]),
      })];
    case 'init_fee_source':
      return [new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: pda([Buffer.from('feesource'), pub(CREATOR_PAYOUT).toBuffer()]), isSigner: false, isWritable: true },
          { pubkey: pub(CREATOR_PAYOUT), isSigner: false, isWritable: false },
          { pubkey: authority, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('global:init_fee_source'), Buffer.from([1])]),
      })];
    case 'init_flow_staking': {
      if (!FLOW_MINT) {
        throw new Error('FLOW mint not configured — NEXT_PUBLIC_FLOW_MINT is empty. $FLOW must be launched and configured before init_flow_staking.');
      }
      const mint = pub(FLOW_MINT);
      const stakingVault = pda([Buffer.from('flow_vault'), mint.toBuffer()]);
      return [new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: GLOBAL, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: true },
          { pubkey: stakingVault, isSigner: false, isWritable: true },
          { pubkey: VAULT_AUTH, isSigner: false, isWritable: false },
          { pubkey: authority, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: disc('global:init_flow_staking'),
      })];
    }
    default:
      throw new Error('Unknown step: ' + step);
  }
}


const STEPS = ['initialize', 'init_sol_asset', 'init_spl_asset', 'init_fee_source', 'init_flow_staking'];
console.log('SOLFLOW mainnet initialization plan');
console.log('  program:         ', PROGRAM_ID.toBase58());
console.log('  global_state PDA:', GLOBAL.toBase58());
console.log('  sol_vault PDA:   ', SOL_VAULT.toBase58());
console.log('  vault_auth PDA:  ', VAULT_AUTH.toBase58());
console.log('  nvda_pending PDA:', NVDA_PENDING.toBase58());
console.log('  spl_vault PDA:   ', SPL_VAULT.toBase58());
console.log('  creator payout:  ', CREATOR_PAYOUT);
console.log('  treasury:        ', TREASURY);
console.log('  NVDAx mint:      ', NVDA_MINT);
console.log('  FLOW mint:       ', FLOW_MINT || '(NOT CONFIGURED — $FLOW not launched)');

for (const step of STEPS) {
  const missing = missingFor(step);
  if (missing.length) {
    console.log('  [' + step + '] BLOCKED — missing: ' + missing.join(', '));
    continue;
  }
  try {
    buildInstruction(step, pub(CREATOR_PAYOUT));
    console.log('  [' + step + '] ready (run with --execute --step ' + step + ' --keypair <authority-keypair.json>)');
  } catch (e) {
    console.log('  [' + step + '] ERROR — ' + (e instanceof Error ? e.message : String(e)));
  }
}

const executeIdx = process.argv.indexOf('--execute');
if (executeIdx < 0) {
  console.log('\nDRY RUN ONLY — no transactions sent. Pass --execute --step <name> --keypair <authority-keypair.json> to execute one step.');
  process.exit(0);
}

const stepArg = process.argv[process.argv.indexOf('--step') + 1];
const kpArg = process.argv.indexOf('--keypair');
if (!stepArg || kpArg < 0 || !process.argv[kpArg + 1]) {
  console.error('REFUSED — --execute requires --step <name> and --keypair <authority-keypair.json>.');
  process.exit(1);
}
if (missingFor(stepArg).length) {
  console.error('REFUSED — ' + stepArg + ' is missing prerequisites: ' + missingFor(stepArg).join(', '));
  process.exit(1);
}
const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(process.argv[kpArg + 1], 'utf8'))));
const rpc = process.env.ALCHEMY_SOLANA_RPC_URL || 'https://solana-mainnet.g.alchemy.com/v2/' + (process.env.ALCHEMY_API_KEY ?? '');
const conn = new Connection(rpc, 'confirmed');
const tx = new Transaction();
for (const ix of buildInstruction(stepArg, kp.publicKey)) tx.add(ix);
tx.feePayer = kp.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
tx.sign(kp);
const sig = await conn.sendTransaction(tx, [kp]);
console.log('submitted:', sig);
const conf = await conn.confirmTransaction(sig, 'confirmed');
if (conf.value.err) {
  console.error('FAILED:', JSON.stringify(conf.value.err));
  process.exit(1);
}
console.log('CONFIRMED — step ' + stepArg + ' complete. Re-run the dry-run plan to confirm the next step.');

const missingFor = (step) => (stepNeeds[step] ?? []).filter((k) => !(process.env[k] ?? '').trim());
