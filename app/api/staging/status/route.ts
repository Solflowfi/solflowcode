import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getEnv } from '@/config/env';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt, serverGetAccountRawMainnet } from '@/lib/providers/alchemy';
import {
  isStagingActive,
  STAGING_PROGRAM_ID,
  PRODUCTION_PROGRAM_ID,
  globalStatePdaOf,
  solVaultPdaOf,
  vaultAuthorityPdaOf,
  splVaultPdaOf,
  nvdaPendingPdaOf,
  flowVaultPdaOf,
  TOKEN_PROGRAM_CLASSIC,
  TOKEN_PROGRAM_2022,
} from '@/lib/staging';

export const dynamic = 'force-dynamic';

const OFF_STAKING_MINT = 8 + 32 + 1 + 8 + 8; // disc + authority + paused + total_shares + total_fees_received

interface MintCheck {
  exists: boolean;
  tokenProgram: string | null;
  tokenProgramKind: 'classic' | 'token-2022' | 'other' | null;
  isMint: boolean;
  walletAddress: boolean;
  decimals: number | null;
  supplyRaw: string | null;
  mintAuthorityRenounced: boolean;
  freezeAuthorityNone: boolean;
}

export async function GET() {
  const env = getEnv();
  const stagingActive = isStagingActive();
  const stagingProgram = env.stagingProgramId ?? STAGING_PROGRAM_ID;
  const rpc = mainnetRpcUrl() ?? resolveRpcUrl();
  const mint = env.flowMint; // generic STAKING_MINT: $TST in staging

  const mintCheck: MintCheck = {
    exists: false, tokenProgram: null, tokenProgramKind: null, isMint: false,
    walletAddress: false, decimals: null, supplyRaw: null,
    mintAuthorityRenounced: false, freezeAuthorityNone: false,
  };
  let verificationError: string | null = null;

  if (mint && rpc) {
    try {
      const r = await serverRpcAt<{ value: { owner: string; data: [string, string] } | null }>(
        rpc, 'getAccountInfo', [mint, { encoding: 'base64' }],
      );
      if (!r.value) {
        verificationError = 'Mint account does not exist on mainnet.';
      } else {
        mintCheck.exists = true;
        mintCheck.tokenProgram = r.value.owner;
        mintCheck.tokenProgramKind =
          r.value.owner === TOKEN_PROGRAM_CLASSIC ? 'classic' :
          r.value.owner === TOKEN_PROGRAM_2022 ? 'token-2022' : 'other';
        const data = Buffer.from(r.value.data[0], 'base64');
        if (data.length < 82) {
          verificationError = 'Account is not a token mint (layout too short).';
          if (r.value.owner === '11111111111111111111111111111111') mintCheck.walletAddress = true;
        } else {
          mintCheck.isMint = true;
          mintCheck.decimals = data[44];
          mintCheck.supplyRaw = BigInt('0x' + Buffer.from(data.slice(36, 44)).reverse().toString('hex')).toString();
          mintCheck.mintAuthorityRenounced = data.readUInt32LE(0) === 0;
          mintCheck.freezeAuthorityNone = data.readUInt32LE(46) === 0;
        }
      }
    } catch (e) {
      verificationError = 'RPC verification failed: ' + String(e instanceof Error ? e.message : e).slice(0, 120);
    }
  }

  // Staging program deployment + initialization state (mainnet).
  let stagingProgramDeployed = false;
  let stagingInitialized = false;
  let stagingStakingMint: string | null = null;
  if (rpc) {
    try {
      const info = await serverGetAccountRawMainnet(stagingProgram);
      stagingProgramDeployed = !!info && info.exists && info.executable &&
        info.owner === 'BPFLoaderUpgradeab1e11111111111111111111111';
      const [gs] = PublicKey.findProgramAddressSync([Buffer.from('global')], new PublicKey(stagingProgram));
      const g = await serverRpcAt<{ value: { data: [string, string] } | null }>(
        rpc, 'getAccountInfo', [gs.toBase58(), { encoding: 'base64' }],
      );
      if (g.value) {
        const data = Buffer.from(g.value.data[0], 'base64');
        if (data.length > OFF_STAKING_MINT + 32) {
          stagingInitialized = true;
          stagingStakingMint = new PublicKey(data.slice(OFF_STAKING_MINT, OFF_STAKING_MINT + 32)).toBase58();
        }
      }
    } catch {
      stagingProgramDeployed = false;
    }
  }

  const verified = mintCheck.isMint && !verificationError;
  const pdas = stagingProgram
    ? {
        globalState: globalStatePdaOf(stagingProgram),
        solVault: solVaultPdaOf(stagingProgram),
        vaultAuthority: vaultAuthorityPdaOf(stagingProgram),
        splVault: splVaultPdaOf(stagingProgram),
        nvdaPending: nvdaPendingPdaOf(stagingProgram),
        stakingVault: mint ? flowVaultPdaOf(stagingProgram, mint) : null,
      }
    : null;

  // Staking readiness: staging mode explicitly on, mint verified, staging
  // program deployed + initialized with THIS mint. Fail closed otherwise.
  const stakingReady = stagingActive && verified &&
    mintCheck.tokenProgramKind !== null && stagingProgramDeployed && stagingInitialized &&
    stagingStakingMint === mint;

  return NextResponse.json({
    ok: true,
    stagingActive,
    network: env.network,
    demoMode: env.demoMode,
    stakingTestMode: env.stakingTestMode,
    stagingProgram,
    productionProgram: PRODUCTION_PROGRAM_ID,
    mint: mint ?? null,
    verification: { ...mintCheck, error: verificationError, verified },
    pdas,
    deployment: { stagingProgramDeployed, stagingInitialized, stagingStakingMint },
    stakingReady,
    stakingBlockedReason: stakingReady ? null : (
      !stagingActive ? 'Staging mode is not enabled (NEXT_PUBLIC_STAKING_TEST_MODE=false).'
      : !mint ? 'Staging $TST mint not configured.'
      : verificationError ? ('TST mint verification failed: ' + verificationError)
      : !stagingProgramDeployed ? 'Staging program is not deployed on mainnet yet (operator action required).'
      : !stagingInitialized ? 'Staging program is not initialized on mainnet yet (operator: initialize + init_flow_staking).'
      : stagingStakingMint !== mint ? 'init_flow_staking registered a different mint than the configured staging mint.'
      : 'Unknown blocker.'),
  });
}
