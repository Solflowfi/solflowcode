// Treasury migration: build the authority-signed set_treasury transaction.
//
// The SOLFLOW program pins the treasury in GlobalState (initialize / set_treasury).
// The deployed DEVNET program currently pins GPsL…4DRS as treasury, while the
// configured operations treasury is now 8VAg…dCGv. This script builds the
// UNSIGNED set_treasury transaction for the authority to sign.
//
// USAGE (operator, on a machine that holds the authority key — never the web app):
//   node scripts/set-treasury-devnet.mjs                      # print info + unsigned tx
//   node scripts/set-treasury-devnet.mjs --keypair <path>     # sign + submit via CLI keypair
//
// SECURITY: this script NEVER reads a private key unless the operator
// explicitly passes --keypair on their own machine. The web app never signs
// treasury changes.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PROGRAM_ID = new PublicKey('DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ');
const NEW_TREASURY = new PublicKey(process.env.NEXT_PUBLIC_TREASURY ?? '8VAgZxVDaKW9hoGYnyQDKpkgGXmMXEZWUwVmCWHVdCGv');
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  || process.env.ALCHEMY_SOLANA_DEVNET_RPC_URL
  || 'https://solana-devnet.g.alchemy.com/v2/' + (process.env.ALCHEMY_API_KEY ?? '');

const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global')], PROGRAM_ID);
const discriminator = createHash('sha256').update('global:set_treasury').digest().subarray(0, 8);

const keypairArg = process.argv.indexOf('--keypair');
const keypairPath = keypairArg >= 0 ? process.argv[keypairArg + 1] : null;

const tx = new Transaction().add(new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: globalState, isSigner: false, isWritable: true },
    { pubkey: Keypair.generate().publicKey, isSigner: true, isWritable: true }, // placeholder authority
  ],
  data: Buffer.concat([discriminator, NEW_TREASURY.toBuffer()]),
}));
tx.recentBlockhash = SystemProgram.programId.toBase58(); // placeholder (unsigned preview)

console.log('Treasury migration (DEVNET, authority-only set_treasury)');
console.log('  program:        ', PROGRAM_ID.toBase58());
console.log('  global_state:   ', globalState.toBase58());
console.log('  new treasury:   ', NEW_TREASURY.toBase58());
console.log('  rpc:            ', RPC ? '(configured)' : '(MISSING — set ALCHEMY_API_KEY)');

if (!keypairPath) {
  // Replace the placeholder authority with the real one for preview purposes.
  console.log('\nUnsigned preview tx (base64, authority = placeholder):');
  console.log(Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64'));
  console.log('\nTo execute: the AUTHORITY (GlobalState.authority) must sign. Run with:');
  console.log('  node scripts/set-treasury-devnet.mjs --keypair <authority-keypair.json>');
  console.log('Only run this from a machine you control. The web app never holds keys.');
  process.exit(0);
}

// Signed execution path (operator machine only).
const kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const conn = new Connection(RPC, 'confirmed');
const authInfo = await conn.getAccountInfo(kp.publicKey);
if (!authInfo) {
  console.error('Authority keypair is not the funded devnet authority (account not found).');
  process.exit(1);
}
tx.instructions[0].keys[1].pubkey = kp.publicKey;
tx.feePayer = kp.publicKey;
tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
tx.sign(kp);
const sig = await conn.sendTransaction(tx, [kp]);
console.log('submitted:', sig);
const conf = await conn.confirmTransaction(sig, 'confirmed');
console.log(conf.value.err ? 'FAILED: ' + JSON.stringify(conf.value.err) : 'CONFIRMED — GlobalState.treasury is now ' + NEW_TREASURY.toBase58());
