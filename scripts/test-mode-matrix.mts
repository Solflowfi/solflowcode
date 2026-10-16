// Environment-matrix test: DEMO / MAINNET STAGING / MAINNET PRODUCTION.
// Verifies the explicit mode resolution, active program/mint selection and
// PDA separation between the staging and production programs.
// Run: node --experimental-strip-types --env-file=.env.local scripts/test-mode-matrix.mts
import { PublicKey } from '@solana/web3.js';

let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log('  PASS ' + name); }
  else { failures.push(name + (detail ? ' | ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

const PROD = 'DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ';
const STAGING = 's4VqR5ayvD3PALEiBFTdMBEdy6beN9YtNesG3BsBBFW';
const TST = 'GQ9a7RibC11DxEYVaBZDtQ7TRjmLGhxa83o5TL7apump';

const { getMode } = await import('../lib/mode.ts');
const { getEnv } = await import('../config/env.ts');
const { globalStatePdaOf, solVaultPdaOf, vaultAuthorityPdaOf, splVaultPdaOf, nvdaPendingPdaOf, flowVaultPdaOf, positionPdaOf, isStagingActive, activeStakingProgramId, stakingMintAddress, stakingTokenSymbol } = await import('../lib/staging.ts');
const infraSrc = (await import('node:fs')).readFileSync('lib/validation/infrastructure.ts', 'utf8');
const fs = (await import('node:fs'));

// ---------- [1] Current env (.env.local): MAINNET STAGING ----------
console.log('\n[1] MAINNET STAGING mode (current .env.local)');
{
  const saved = process.env.NEXT_PUBLIC_DEMO_MODE;
  process.env.NEXT_PUBLIC_DEMO_MODE = 'false';
  check('mode resolves to "staging"', getMode() === 'staging', 'got ' + getMode());
  check('isStagingActive() true', isStagingActive() === true);
  check('active program = staging program', activeStakingProgramId() === STAGING, String(activeStakingProgramId()));
  check('active program is NOT the production program', activeStakingProgramId() !== PROD);
  check('staking mint = TST mint', stakingMintAddress() === TST, String(stakingMintAddress()));
  check('token symbol = TST', stakingTokenSymbol() === 'TST');
  check('staging program id in env is unchanged', getEnv().stagingProgramId === STAGING);
  check('production program id in env is unchanged', getEnv().programId === PROD);
  process.env.NEXT_PUBLIC_DEMO_MODE = saved;
}

// ---------- [2] DEMO mode ----------
console.log('\n[2] DEMO mode');
{
  process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
  check('mode resolves to "demo"', getMode() === 'demo', 'got ' + getMode());
  check('staging NOT active in demo', isStagingActive() === false);
  process.env.NEXT_PUBLIC_DEMO_MODE = 'false';
}

// ---------- [3] MAINNET PRODUCTION mode ----------
console.log('\n[3] MAINNET PRODUCTION mode');
{
  const savedStaging = process.env.NEXT_PUBLIC_STAGING_PROGRAM_ID;
  const savedTest = process.env.NEXT_PUBLIC_STAKING_TEST_MODE;
  const savedMint = process.env.NEXT_PUBLIC_FLOW_MINT;
  process.env.NEXT_PUBLIC_STAGING_PROGRAM_ID = '';
  process.env.NEXT_PUBLIC_STAKING_TEST_MODE = 'false';
  process.env.NEXT_PUBLIC_FLOW_MINT = '';
  check('mode resolves to "live" (production)', getMode() === 'live', 'got ' + getMode());
  check('production program is the active program', activeStakingProgramId() === PROD, String(activeStakingProgramId()));
  check('production mint NOT configured pre-launch', stakingMintAddress() === null, String(stakingMintAddress()));
  check('token symbol = FLOW in production', stakingTokenSymbol() === 'FLOW');
  // staging flag ON but no staging program id -> still production (fail closed)
  process.env.NEXT_PUBLIC_STAKING_TEST_MODE = 'true';
  process.env.NEXT_PUBLIC_STAGING_PROGRAM_ID = '';
  check('staging flag without staging program id stays production', getMode() === 'live', 'got ' + getMode());
  process.env.NEXT_PUBLIC_STAGING_PROGRAM_ID = savedStaging;
  process.env.NEXT_PUBLIC_STAKING_TEST_MODE = savedTest;
  process.env.NEXT_PUBLIC_FLOW_MINT = savedMint;
}

// ---------- [4] PDA separation ----------
console.log('\n[4] PDA separation (staging vs production)');
{
  const prodSeeds: Record<string, Buffer[]> = {
    global_state: [Buffer.from('global')],
    sol_vault: [Buffer.from('sol_vault')],
    vault_auth: [Buffer.from('vault_auth')],
    spl_vault: [Buffer.from('spl_vault')],
    nvda_pending: [Buffer.from('nvda_pending')],
    'flow_vault(TST)': [Buffer.from('flow_vault'), new PublicKey(TST).toBuffer()],
    position: [Buffer.from('position'), new PublicKey(PROD).toBuffer()],
  };
  const pairs: Array<[string, string, () => string]> = [
    ['global_state', 'global_state', () => globalStatePdaOf(STAGING)],
    ['sol_vault', 'sol_vault', () => solVaultPdaOf(STAGING)],
    ['vault_auth', 'vault_auth', () => vaultAuthorityPdaOf(STAGING)],
    ['spl_vault', 'spl_vault', () => splVaultPdaOf(STAGING)],
    ['nvda_pending', 'nvda_pending', () => nvdaPendingPdaOf(STAGING)],
    ['flow_vault(TST)', 'flow_vault(TST)', () => flowVaultPdaOf(STAGING, TST)],
    ['position', 'position', () => positionPdaOf(STAGING, PROD)],
  ];
  for (const [name, seedKey, stagingFn] of pairs) {
    const s = stagingFn();
    const pProd = PublicKey.findProgramAddressSync(prodSeeds[seedKey], new PublicKey(PROD))[0].toBase58();
    check(name + ': staging PDA != production PDA', s !== pProd, s + ' vs ' + pProd);
  }
  check('staging flow_vault derives with the TST mint seed',
    flowVaultPdaOf(STAGING, TST) === PublicKey.findProgramAddressSync([Buffer.from('flow_vault'), new PublicKey(TST).toBuffer()], new PublicKey(STAGING))[0].toBase58());
}

// ---------- [5] Staging readiness never checks the production program ----------
console.log('\n[5] Staging/production readiness isolation (source checks)');
{
  const stagingFn = infraSrc.slice(infraSrc.indexOf('export async function validateStagingInfrastructure'));
  check('staging validator exists', stagingFn.length > 200);
  check('staging validator never reads env.programId (production id)',
    !stagingFn.includes('env.programId'), 'staging branch must only use env.stagingProgramId');
  check('staging validator references the staging program', stagingFn.includes('env.stagingProgramId'));
  check('staging validator derives vaults from the staging program', stagingFn.includes('stagingPda(pid'));
  check('staging validator does NOT require the env reward vaults',
    !stagingFn.includes('env.solRewardVault') && !stagingFn.includes('env.nvdaRewardVault'));
  const prodFn = infraSrc.slice(infraSrc.indexOf('export async function validateInfrastructure'), infraSrc.indexOf('export async function validateStagingInfrastructure'));
  check('production validator never references the staging config',
    !prodFn.includes('stagingProgramId'), 'production branch must not use staging config');
  check('production validator dispatches staging BEFORE any production check',
    prodFn.includes('if (isStagingActive()) return validateStagingInfrastructure(env)'));
}

// ---------- [6] Mode banner + route labels (source checks) ----------
console.log('\n[6] Banner / route labels');
{
  const banner = fs.readFileSync('components/layout/ModeBanner.tsx', 'utf8');
  check('banner never says plain LIVE MODE', !banner.includes('LIVE MODE —'));
  check('banner shows MAINNET STAGING', banner.includes('MAINNET STAGING'));
  check('banner shows STAKING TOKEN: $TST', banner.includes('STAKING TOKEN: $TST'));
  check('banner shows not-deployed staging error', banner.includes('Staging program is not deployed on Mainnet yet'));
  check('banner keeps MAINNET PRODUCTION label', banner.includes('MAINNET PRODUCTION'));
  const readiness = fs.readFileSync('app/api/readiness/route.ts', 'utf8');
  check('readiness route has a staging branch returning before production checks',
    readiness.includes('if (isStagingActive())') && readiness.includes('staging: true'));
  const flowRoute = fs.readFileSync('app/api/flow-status/route.ts', 'utf8');
  check('flow-status uses the staging program when staging is active',
    flowRoute.includes('stagingActive && env.stagingProgramId ? env.stagingProgramId : SOLFLOW_PROGRAM_ID'));
}

console.log('\n=== SUMMARY: ' + pass + ' passed, ' + failures.length + ' failed ===');
if (failures.length) {
  console.log('FAILED: ' + failures.join(' | '));
  process.exit(1);
}


