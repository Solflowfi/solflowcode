import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getEnv } from '@/config/env';
import { isAuthorizedOperator } from '@/lib/server/jupiter';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt, serverGetAccountRawMainnet } from '@/lib/providers/alchemy';
import { classifyFlowMintSyntax, flowVaultPda, SOLFLOW_PROGRAM_ID } from '@/lib/flow-status';
import { isStagingActive, stagingPda } from '@/lib/staging';

export const dynamic = 'force-dynamic';

const BPF_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
// GlobalState layout offsets (8-byte Anchor discriminator first).
const OFF_TOTAL_FEES = 8 + 32 + 1; // after disc + authority + paused
const OFF_STAKING_MINT = OFF_TOTAL_FEES + 8;

export interface ReadinessItem {
  key: string;
  label: string;
  state: 'OK' | 'FAIL' | 'WAITING';
  detail: string;
}

/**
 * GET /api/readiness?wallet=... — OPERATOR-ONLY mainnet readiness checklist.
 * Every item is computed from real configuration + on-chain state; nothing is
 * faked. Live Staking is LOCKED until every required gate passes.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (!isAuthorizedOperator(searchParams.get('wallet'))) {
    return NextResponse.json({ authorized: false, error: 'Not authorized. Operator only.' }, { status: 403 });
  }
  const env = getEnv();

  // ---------- MAINNET STAGING: readiness evaluates ONLY the staging program.
  // Production program/vault prerequisites never apply while staging is active.
  if (isStagingActive()) {
    const stagingProgram = env.stagingProgramId as string;
    const items: ReadinessItem[] = [];
    const rpcUrl = mainnetRpcUrl() ?? resolveRpcUrl();
    const p = (seed: string, extra?: Uint8Array) =>
      stagingPda(stagingProgram, Buffer.from(seed), ...(extra ? [Buffer.from(extra)] : []));
    const { PublicKey } = await import('@solana/web3.js');
    const tstMint = env.flowMint ?? '';
    const mintBytes = tstMint ? new PublicKey(tstMint).toBytes() : null;

    const exists = async (addr: string): Promise<boolean> => {
      try {
        const r = await serverRpcAt<{ value: unknown } | null>(rpcUrl ?? 'https://api.mainnet-beta.solana.com', 'getAccountInfo', [addr, { encoding: 'base64' }]);
        return !!r && !!r.value;
      } catch {
        return false;
      }
    };

    let programDeployed = false;
    try {
      const info = await serverGetAccountRawMainnet(stagingProgram);
      programDeployed = !!info && info.exists && info.owner === BPF_LOADER && info.executable;
    } catch {
      programDeployed = false;
    }
    items.push({
      key: 'program',
      label: 'Staging Program (mainnet deployment)',
      state: programDeployed ? 'OK' : 'FAIL',
      detail: programDeployed
        ? 'Dedicated MAINNET STAGING program is deployed and executable (production program is never used in staging).'
        : 'MAINNET STAGING — Staging program is not deployed on Mainnet yet. Deploy ' + stagingProgram + ' with the staging keypair.',
    });

    let mintOk = false;
    if (tstMint && rpcUrl) {
      try {
        const r = await serverRpcAt<{ value: { owner: string; data: [string, string] } | null }>(rpcUrl, 'getAccountInfo', [tstMint, { encoding: 'base64' }]);
        if (r.value) {
          const owner = r.value.owner;
          const data = Buffer.from(r.value.data[0], 'base64');
          mintOk = (owner === TOKEN_PROGRAM || owner === TOKEN_2022) && data.length >= 82;
        }
      } catch {
        mintOk = false;
      }
    }
    items.push({
      key: 'flow_mint',
      label: 'TST Staking Mint (staging)',
      state: mintOk ? 'OK' : 'FAIL',
      detail: mintOk ? 'TST staking mint verified on mainnet (token-program owned mint layout).' : 'TST staking mint not configured or not a valid mint on mainnet.',
    });

    const gsOk = await exists(p('global'));
    items.push({
      key: 'global_state',
      label: 'Staging GlobalState',
      state: gsOk ? 'OK' : 'WAITING',
      detail: gsOk ? 'Staging GlobalState exists (initialize ran).' : 'Staging GlobalState PDA does not exist yet — run initialize. Derived: ' + p('global') + '.',
    });

    const stakingVaultOk = !!(mintBytes && (await exists(p('flow_vault', mintBytes))));
    items.push({
      key: 'flow_init',
      label: 'TST Staking Vault (init_flow_staking)',
      state: stakingVaultOk ? 'OK' : 'WAITING',
      detail: stakingVaultOk
        ? 'TST staking vault exists at the derived staging PDA.'
        : 'Waiting: init_flow_staking creates the vault at ' + (mintBytes ? p('flow_vault', mintBytes) : 'mint not configured') + '.',
    });

    const solVaultOk = await exists(p('sol_vault'));
    items.push({
      key: 'sol_vault',
      label: 'Staging SOL Vault',
      state: solVaultOk ? 'OK' : 'WAITING',
      detail: solVaultOk ? 'Staging SOL reward vault exists (derived PDA).' : 'Staging SOL vault PDA does not exist yet — created by initialize. Derived: ' + p('sol_vault') + '.',
    });

    const splVaultOk = await exists(p('spl_vault'));
    items.push({
      key: 'nvda_vault',
      label: 'Staging NVDAx Vault (optional)',
      state: splVaultOk ? 'OK' : 'WAITING',
      detail: splVaultOk ? 'Staging NVDAx vault exists (derived PDA).' : 'Staging NVDAx vault PDA does not exist yet (init_spl_asset — optional in staging; rewards are not distributed in staging). Derived: ' + p('spl_vault') + '.',
    });

    const stagingReady = programDeployed && mintOk && gsOk && stakingVaultOk && solVaultOk;
    items.push({
      key: 'live_staking',
      label: 'Staging Staking ($TST)',
      state: stagingReady ? 'OK' : 'WAITING',
      detail: stagingReady
        ? 'All staging prerequisites pass — $TST staking is READY on the dedicated staging program.'
        : 'MAINNET STAGING — STAKING NOT READY. Staging program is not deployed on Mainnet yet.'
          + (!programDeployed ? '' : !mintOk ? ' TST mint verification failed.' : !gsOk ? ' initialize has not run.' : !stakingVaultOk ? ' init_flow_staking has not run.' : ' SOL vault missing.'),
    });

    return NextResponse.json({
      authorized: true,
      network: env.network,
      demoMode: env.demoMode,
      staging: true,
      stakingProgram: stagingProgram,
      mint: tstMint || null,
      items,
    });
  }

  const items: ReadinessItem[] = [];
  const networkUrl = env.network === 'mainnet-beta' ? mainnetRpcUrl() ?? resolveRpcUrl() : resolveRpcUrl();

  // GlobalState evidence (on the deployed network, when it exists).
  let gsData: Buffer | null = null;
  if (networkUrl && env.programId) {
    try {
      const [gs] = PublicKey.findProgramAddressSync([Buffer.from('global')], new PublicKey(env.programId));
      const r = await serverRpcAt<{ value: { data: [string, string] } | null }>(networkUrl, 'getAccountInfo', [gs.toBase58(), { encoding: 'base64' }]);
      if (r.value) gsData = Buffer.from(r.value.data[0], 'base64');
    } catch {
      gsData = null;
    }
  }

  // Program (deployed on mainnet?)
  let programDeployed = false;
  try {
    const info = env.programId ? await serverGetAccountRawMainnet(env.programId) : null;
    programDeployed = !!info && info.exists && info.owner === BPF_LOADER && info.executable;
  } catch {
    programDeployed = false;
  }
  items.push({
    key: 'program',
    label: 'Program (mainnet deployment)',
    state: programDeployed ? 'OK' : 'FAIL',
    detail: programDeployed ? 'SOLFLOW program is deployed and executable on mainnet.' : 'The SOLFLOW program is not deployed on mainnet yet. Deploy the audited build with the Anchor mainnet configuration before initialization.',
  });

  // Treasury
  const treasuryOk = !!env.treasury;
  let treasuryPinned: string | null = null;
  if (gsData && gsData.length > 142 + 32) treasuryPinned = new PublicKey(gsData.slice(142, 174)).toBase58();
  const treasuryMatch = treasuryOk && (!treasuryPinned || treasuryPinned === env.treasury);
  items.push({
    key: 'treasury',
    label: 'Treasury',
    state: treasuryMatch ? 'OK' : treasuryOk ? 'WAITING' : 'FAIL',
    detail: treasuryOk
      ? 'Treasury/Operations wallet configured.' + (treasuryPinned ? (treasuryMatch ? ' Matches GlobalState.' : ' GlobalState pins a different treasury — run set_treasury.') : ' GlobalState not initialized yet — initialize pins this treasury.')
      : 'NEXT_PUBLIC_TREASURY is not configured.',
  });

  // Creator fee source + verification
  const feeSource = env.feeSources[0] ?? null;
  items.push({
    key: 'creator_fee_source',
    label: 'Creator Fee Source',
    state: feeSource ? 'OK' : 'FAIL',
    detail: feeSource ? 'Configured. Must be whitelisted on-chain via init_fee_source.' : 'NEXT_PUBLIC_CREATOR_FEE_SOURCE is not configured.',
  });
  let feesReceived = '0';
  if (gsData && gsData.length > OFF_TOTAL_FEES + 8) {
    feesReceived = gsData.readBigUInt64LE(OFF_TOTAL_FEES).toString();
  }
  items.push({
    key: 'creator_fee_verification',
    label: 'Creator Fee Verification',
    state: feesReceived !== '0' ? 'OK' : 'WAITING',
    detail: feesReceived !== '0'
      ? 'On-chain evidence: GlobalState.total_fees_received = ' + feesReceived + ' lamports processed.'
      : 'Awaiting the first real creator fee. Status stays CONFIGURED / AWAITING VERIFICATION until record_fee processes a real on-chain fee.',
  });

  // FLOW mint + verification + initialization
  const flowSyntax = classifyFlowMintSyntax(env.flowMint);
  let flowVerified = false;
  const flowVerifyUrl = env.network === 'mainnet-beta' ? mainnetRpcUrl() : networkUrl;
  if (flowSyntax.status === 'CONFIGURED' && flowVerifyUrl) {
    try {
      const r = await serverRpcAt<{ value: { owner: string; data: [string, string] } | null }>(flowVerifyUrl, 'getAccountInfo', [env.flowMint as string, { encoding: 'base64' }]);
      if (r.value) {
        const owner = r.value.owner;
        if (owner === TOKEN_PROGRAM || owner === TOKEN_2022) {
          const data = Buffer.from(r.value.data[0], 'base64');
          flowVerified = data.length >= 82;
        }
      }
    } catch {
      flowVerified = false;
    }
  }
  items.push({
    key: 'flow_mint',
    label: 'FLOW Mint',
    state: env.flowMint ? (flowSyntax.status === 'CONFIG_ERROR' ? 'FAIL' : 'OK') : 'WAITING',
    detail: env.flowMint
      ? (flowSyntax.status === 'CONFIG_ERROR' ? 'CONFIGURATION BROKEN — ' + flowSyntax.detail : 'Configured: ' + env.flowMint)
      : 'Not launched. Waiting for the official $FLOW mint address. No placeholder is used.',
  });
  items.push({
    key: 'flow_verification',
    label: 'FLOW Mint Verification',
    state: flowVerified ? 'OK' : 'WAITING',
    detail: flowVerified
      ? 'On-chain mint verified (exists, owned by a token program, 82-byte Mint layout).'
      : env.flowMint
        ? 'Verification pending — the configured address must exist as a real token mint on the target network.'
        : 'Waiting for the official $FLOW mint.',
  });
  let stakingMintOnChain: string | null = null;
  if (gsData && gsData.length > OFF_STAKING_MINT + 32) {
    stakingMintOnChain = new PublicKey(gsData.slice(OFF_STAKING_MINT, OFF_STAKING_MINT + 32)).toBase58();
  }
  const flowInitialized = !!env.flowMint && stakingMintOnChain === env.flowMint;
  items.push({
    key: 'flow_init',
    label: 'FLOW Staking Initialization',
    state: flowInitialized ? 'OK' : 'WAITING',
    detail: flowInitialized
      ? 'init_flow_staking has registered the configured mint (GlobalState.staking_mint matches).'
      : 'Waiting: init_flow_staking requires the deployed program, the real $FLOW mint and the authority. Staking vault PDA (derived only when the mint exists): ' + (env.flowMint ? flowVaultPda(env.flowMint, SOLFLOW_PROGRAM_ID) : 'not derived until FLOW mint is configured') + '.',
  });

  // NVDAx
  const nvdaOk = !!env.nvdaMint;
  items.push({
    key: 'nvda_mint',
    label: 'NVDAx Mint',
    state: nvdaOk ? 'OK' : 'FAIL',
    detail: nvdaOk ? 'Configured (Token-2022, pinned in the program).' : 'NEXT_PUBLIC_NVDA_MINT is not configured.',
  });
  items.push({
    key: 'nvda_funding',
    label: 'NVDAx Reward Funding',
    state: 'WAITING',
    detail: 'Waiting for the first verified SOL to NVDAx conversion + fund_spl_rewards. The NVDAx reward vault (FjHvKANR…) fills only with real converted tokens.',
  });

  // Jupiter
  const jupSelected = env.nvdaSwapAdapter === 'jupiter-swap-v2';
  const jupKey = typeof process !== 'undefined' && !!process.env.JUPITER_API_KEY;
  items.push({
    key: 'jupiter_adapter',
    label: 'Jupiter Adapter',
    state: jupSelected ? 'OK' : 'FAIL',
    detail: jupSelected ? 'jupiter-swap-v2 selected.' : 'NEXT_PUBLIC_NVDA_SWAP_ADAPTER must be jupiter-swap-v2.',
  });
  items.push({
    key: 'jupiter_api',
    label: 'Jupiter API',
    state: jupKey ? 'OK' : 'FAIL',
    detail: jupKey ? 'Server-side JUPITER_API_KEY present (never exposed to the browser).' : 'JUPITER_API_KEY missing (server-side only) — live conversion fails closed: "Jupiter swap adapter is not configured."',
  });

  // Mainnet RPC + security review
  items.push({
    key: 'mainnet_rpc',
    label: 'Mainnet RPC',
    state: mainnetRpcUrl() ? 'OK' : 'FAIL',
    detail: mainnetRpcUrl() ? 'Alchemy mainnet RPC configured (server-side).' : 'ALCHEMY_API_KEY missing — mainnet verification unavailable.',
  });
  const audited = process.env.PROGRAM_AUDITED === 'true' || !!process.env.PROGRAM_AUDITOR;
  items.push({
    key: 'security_review',
    label: 'Security Review',
    state: audited ? 'OK' : 'FAIL',
    detail: audited ? 'An audit/verification attestation is configured (server-side).' : 'No audit yet. Do not route real funds without an independent security review (set PROGRAM_AUDITOR / PROGRAM_AUDITED server-side after a real review).',
  });

  // Live staking gate: LOCKED until everything required passes
  const requiredKeys = ['program', 'treasury', 'creator_fee_source', 'flow_mint', 'flow_verification', 'flow_init', 'nvda_mint', 'jupiter_adapter', 'jupiter_api', 'mainnet_rpc', 'security_review'];
  const allOk = requiredKeys.every((k) => items.find((i) => i.key === k)?.state === 'OK');
  const demoOff = !env.demoMode;
  items.push({
    key: 'live_staking',
    label: 'Live Staking',
    state: allOk && demoOff ? 'OK' : 'WAITING',
    detail: allOk
      ? demoOff
        ? 'All gates pass and demo mode is off — live staking can be activated.'
        : 'All gates pass — switch NEXT_PUBLIC_DEMO_MODE=false to leave demo mode (explicit operator action).'
      : 'LOCKED until all required gates pass' + (demoOff ? '.' : ' and NEXT_PUBLIC_DEMO_MODE=false.') + (env.flowMint ? '' : ' Current blocker: FLOW mint not configured.'),
  });

  return NextResponse.json({ authorized: true, network: env.network, demoMode: env.demoMode, items });
}
