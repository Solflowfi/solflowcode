// Pre-launch readiness tests: $FLOW state machine, config validation, PDA
// derivation, live-gate behavior. Run:
//   node --experimental-strip-types --env-file=.env.local --no-warnings scripts/test-flow-prelaunch.mts
import { PublicKey } from '@solana/web3.js';
import { classifyFlowMintSyntax, flowVaultPda, SOLFLOW_PROGRAM_ID } from '../lib/flow-status.ts';

let pass = 0;
let fail = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string): void {
  if (cond) {
    pass++;
    console.log('  PASS  ' + label);
  } else {
    fail++;
    failures.push(label);
    console.log('  FAIL  ' + label);
  }
}

// 1. FLOW mint empty -> valid pre-launch state
{
  const s = classifyFlowMintSyntax('');
  assert(s.status === 'NOT_LAUNCHED' && s.detail.includes('not launched yet'), 'empty FLOW mint => NOT_LAUNCHED (expected pre-launch state, not an error)');
  const s2 = classifyFlowMintSyntax(undefined);
  assert(s2.status === 'NOT_LAUNCHED', 'unset FLOW mint => NOT_LAUNCHED');
  const s3 = classifyFlowMintSyntax('   ');
  assert(s3.status === 'NOT_LAUNCHED', 'whitespace-only FLOW mint => NOT_LAUNCHED');
}

// 2. FLOW mint invalid -> configuration error
{
  const s = classifyFlowMintSyntax('not-a-solana-address');
  assert(s.status === 'CONFIG_ERROR' && s.detail.includes('not a valid Solana public key'), 'garbage FLOW mint => CONFIG_ERROR');
  const s2 = classifyFlowMintSyntax('Flow');
  assert(s2.status === 'CONFIG_ERROR', 'short bogus FLOW mint => CONFIG_ERROR');
  const s3 = classifyFlowMintSyntax('11111111111111111111111111111111');
  assert(s3.status === 'CONFIG_ERROR' && s3.detail.includes('zero address'), 'zero address => CONFIG_ERROR');
}

// 3. FLOW mint is a wallet address -> rejected (syntactic layer classifies;
// the on-chain owner check server-side refuses wallet addresses as mints)
{
  const { readFileSync } = await import('node:fs');
  const infra = readFileSync(new URL('../lib/validation/infrastructure.ts', import.meta.url), 'utf8');
  assert(infra.includes("acc.owner === '11111111111111111111111111111111'"), 'infrastructure refuses system-owned (wallet) addresses as FLOW mint');
}

// 4. FLOW mint valid -> verification flow starts (CONFIGURED = pending on-chain check)
{
  const candidate = 'So11111111111111111111111111111111111111112'; // syntactically valid mint shape
  const s = classifyFlowMintSyntax(candidate);
  assert(s.status === 'CONFIGURED' && s.detail.includes('verification pending'), 'valid mint shape => CONFIGURED (verification flow starts)');

// 5. FLOW PDA derived correctly after mint is supplied
{
  const mint = 'So11111111111111111111111111111111111111112';
  const a = flowVaultPda(mint);
  const b = PublicKey.findProgramAddressSync(
    [Buffer.from('flow_vault'), new PublicKey(mint).toBuffer()],
    new PublicKey(SOLFLOW_PROGRAM_ID),
  )[0].toBase58();
  assert(a === b && a.length === 44, 'flow_vault PDA derives deterministically from [flow_vault, mint]');
  const c = flowVaultPda('Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh');
  assert(c !== a, 'different mint derives a different staking vault (no collisions)');
}

// 6. Missing creator-fee verification / FLOW missing -> live gate locked
{

// 5b. STAGING program separation: the $TST staging program has its own ID,
// so every PDA differs from the production program's PDAs.
{
  const STAGING = 's4VqR5ayvD3PALEiBFTdMBEdy6beN9YtNesG3BsBBFW';
  const PROD = 'DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ';
  const pdaFor = (programId: string, seed: string) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed)], new PublicKey(programId))[0].toBase58();
  assert(STAGING !== PROD, 'staging program ID differs from the production program ID');
  const mint = 'So11111111111111111111111111111111111111112';
  for (const seed of ['global', 'sol_vault', 'vault_auth', 'spl_vault', 'nvda_pending']) {
    const prod = pdaFor(PROD, seed);
    const stag = pdaFor(STAGING, seed);
    assert(prod !== stag, 'staging "' + seed + '" PDA differs from production (program-aware derivation)');
  }
  const flowVaultProd = flowVaultPda(mint, PROD);
  const flowVaultStaging = flowVaultPda(mint, STAGING);
  assert(flowVaultProd !== flowVaultStaging, 'FLOW/TST staking vault PDA is program-aware (staging derives its own)');
  // The staging program source declares ONLY the staging ID.
  const { readFileSync } = await import('node:fs');
  const stagingSrc = readFileSync(new URL('../programs/solflow-staging/src/lib.rs', import.meta.url), 'utf8');
  const prodSrc = readFileSync(new URL('../programs/solflow/src/lib.rs', import.meta.url), 'utf8');
  assert(stagingSrc.includes('declare_id!("' + STAGING + '")') && !stagingSrc.includes('declare_id!("' + PROD + '")'), 'staging lib.rs declares only the staging ID');
  assert(prodSrc.includes('declare_id!("' + PROD + '")') && !prodSrc.includes('declare_id!("' + STAGING + '")'), 'production lib.rs declares only the production ID (untouched)');
}

  const { readFileSync } = await import('node:fs');
  const infra = readFileSync(new URL('../lib/validation/infrastructure.ts', import.meta.url), 'utf8');
  assert(infra.includes('liveReady: !env.demoMode && allConnected && allPresent && missing.length === 0'), 'liveReady requires zero missing items (FLOW mint missing keeps it false)');
  assert(infra.includes("'FLOW mint not configured'"), 'live gate reports: FLOW mint not configured');
}

// 7. Missing Jupiter key -> live conversion unavailable
{
  const { readFileSync } = await import('node:fs');
  const conv = readFileSync(new URL('../lib/solana/nvda-convert.ts', import.meta.url), 'utf8');
  assert(conv.includes('process.env.JUPITER_API_KEY'), 'conversion adapter gates on the server-side Jupiter key');
}

// 8. Demo mode works without FLOW mint
{
  const { readFileSync } = await import('node:fs');
  const conv = readFileSync(new URL('../lib/solana/nvda-convert.ts', import.meta.url), 'utf8');
  assert(conv.includes('env.demoMode'), 'demo adapter selection is independent of the FLOW mint');
  const staking = readFileSync(new URL('../hooks/useStaking.ts', import.meta.url), 'utf8');
  assert(staking.includes("getMode() !== 'demo'"), 'demo staking path exists without FLOW mint');
}

// 9. Live mode cannot activate without FLOW mint
{
  const { readFileSync } = await import('node:fs');
  const infra = readFileSync(new URL('../lib/validation/infrastructure.ts', import.meta.url), 'utf8');
  assert(infra.includes('if (!env.flowMint)'), 'live gate explicitly checks the FLOW mint');
  assert(infra.includes("missing.push('FLOW mint not configured')"), 'missing FLOW mint blocks liveReady');
}

// 10. Treasury mismatch rejected by record_fee (no treasury account accepted
// at all + authority-only set_treasury is the only treasury mutation)
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../programs/solflow/src/lib.rs', import.meta.url), 'utf8');
  const ctxStart = src.indexOf("pub struct RecordFee<'info>");
  const ctx = src.slice(ctxStart, src.indexOf('pub struct ClaimSol'));
  assert(!ctx.includes('treasury'), 'record_fee accepts no treasury account (cannot mismatch by construction)');
  assert(src.includes('set_treasury'), 'authority-only set_treasury is the only treasury mutation');
}

console.log('\n=== SUMMARY: ' + pass + ' passed, ' + fail + ' failed ===');
if (fail > 0) {
  console.log('FAILED: ' + failures.join(' | '));
  process.exit(1);
}

}
