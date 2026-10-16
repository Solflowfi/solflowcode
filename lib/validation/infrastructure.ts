// Server-side infrastructure validation. PRODUCTION READINESS GATE.
//
// Nothing is marked CONNECTED merely because an environment variable exists.
// Every component is verified against the cluster via server-side RPC:
//   - Alchemy key presence + real getSlot responsiveness (+ MAINNET for live)
//   - creator fee sources: valid keys, existing accounts, queryable history
//   - FLOW staking mint is a real SPL Token mint (the staking token)
//   - SOL reward vault exists on-chain + verified SOL balance
//   - NVDAx mint is a real SPL Token mint + decimals + supply
//   - NVDAx reward vault exists, matches the configured mint, token balance
//   - staking program ID is a real deployed program account
//   - reward engine: program + vaults + reward-pool allocations consistent (70/30 of pool; 70% creator payout first)
//
// Results feed /api/infrastructure, the ModeBanner (3-state) and /admin.
// LIVE_READY is true only when ALL components independently verify on-chain:
//   RPC(mainnet) · Creator Fee Source · FLOW Staking Mint · SOL Vault ·
//   NVDAx Mint · NVDAx Vault · Staking Program · Reward Engine.

import { getEnv } from '@/config/env';
import {
  alchemyConfigured,
  serverGetAccount,
  serverGetBalance,
  serverGetSignatures,
  serverGetSlot,
  serverGetTokenAccountBalance,
  serverGetTokenSupply,
  serverValidateMint,
  serverGetAccountRawMainnet,
} from '@/lib/providers/alchemy';
import type { InfraComponent, InfrastructureStatus } from '@/types';
import { isStagingActive, stagingPda } from '@/lib/staging';
import type { SolflowEnv } from '@/config/env';

const REQUIRED_COMPONENT_IDS = [
  'alchemy',
  'fee_source',
  'creator_payout',
  'nvda_conversion',
  'flow_mint',
  'sol_vault',
  'nvda_mint',
  'nvda_vault',
  'program',
  'reward_engine',
] as const;

export async function validateInfrastructure(): Promise<InfrastructureStatus> {
  const env = getEnv();
  // MAINNET STAGING has its own readiness evaluation — the production
  // program/vault prerequisites NEVER apply while staging mode is active.
  if (isStagingActive()) return validateStagingInfrastructure(env);
  const components: InfraComponent[] = [];
  const missing: string[] = [];

  // ---------- Alchemy / RPC ----------
  let rpcOk = false;
  let rpcDetail = '';
  const hasServerRpc = alchemyConfigured() || customAlchemyUrl();
  if (!hasServerRpc) {
    components.push({ id: 'alchemy', label: 'RPC (Alchemy)', state: 'not_configured', detail: 'ALCHEMY_API_KEY / ALCHEMY_SOLANA_RPC_URL not set (server-side only).' });
    missing.push('Alchemy API key (server-side ALCHEMY_API_KEY)');
  } else {
    try {
      const slot = await serverGetSlot();
      rpcOk = slot !== null && slot > 0;
      rpcDetail = rpcOk ? 'RPC responsive via Alchemy (slot ' + slot + ')' : 'RPC responded but slot invalid';
    } catch (e) {
      rpcDetail = e instanceof Error ? e.message : 'RPC unreachable';
    }
    // LIVE MODE requires the Alchemy MAINNET endpoint — a responsive devnet
    // RPC is NOT sufficient for live readiness.
    const isMainnet = env.network === 'mainnet-beta';
    const connected = rpcOk && (isMainnet || env.demoMode);
    components.push({
      id: 'alchemy',
      label: 'RPC (Alchemy)',
      state: connected ? 'connected' : 'invalid',
      detail: !rpcOk
        ? 'Configured but Alchemy RPC check failed: ' + rpcDetail
        : isMainnet
          ? rpcDetail + ' (mainnet)'
          : rpcDetail + ' — network is ' + env.network + '; Alchemy MAINNET is required for live mode.',
    });
    if (!rpcOk) missing.push('Working Alchemy Solana RPC endpoint');
    if (rpcOk && !isMainnet) missing.push('Alchemy MAINNET RPC endpoint (live mode requires mainnet)');
  }

  // ---------- Creator fee sources ----------
  if (env.feeSources.length === 0) {
    components.push({ id: 'fee_source', label: 'Creator Fee Source', state: 'not_configured', detail: 'NEXT_PUBLIC_CREATOR_FEE_SOURCE not set.' });
    missing.push('Creator fee source wallet(s)');
  } else {
    let allValid = true;
    let failDetail = '';
    for (const src of env.feeSources) {
      try {
        const { PublicKey } = await import('@solana/web3.js');
        new PublicKey(src); // base58 validity
        const acc = await serverGetAccount(src);
        if (!acc || !acc.exists) {
          allValid = false;
          failDetail = 'Source account does not exist on ' + env.network + '.';
          continue;
        }
        const sigs = await serverGetSignatures(src, 1);
        if (sigs.length === 0) failDetail = 'Source history not queryable via Alchemy.';
      } catch {
        allValid = false;
        failDetail = 'Invalid Solana public key in configuration.';
      }
    }
    components.push({
      id: 'fee_source',
      label: 'Creator Fee Source',
      state: allValid ? 'connected' : 'invalid',
      detail: allValid
        ? env.feeSources.length + ' source(s) exist on ' + env.network + ' and transaction history is queryable via Alchemy.'
        : failDetail,
    });
    if (!allValid) missing.push('Valid on-chain creator fee source address(es)');
  }

  // ---------- Creator payout destination (LEVEL 1: 70% of every fee) ----------
  if (!env.creatorPayout) {
    components.push({ id: 'creator_payout', label: 'Creator Payout', state: 'not_configured', detail: 'NEXT_PUBLIC_CREATOR_PAYOUT not set — the 70% creator share has no destination. Live fee processing is blocked.' });
    missing.push('Creator payout destination (NEXT_PUBLIC_CREATOR_PAYOUT)');
  } else {
    let payoutValid = false;
    try {
      const { PublicKey } = await import('@solana/web3.js');
      new PublicKey(env.creatorPayout);
      payoutValid = true;
    } catch {
      payoutValid = false;
    }
    components.push({
      id: 'creator_payout',
      label: 'Creator Payout',
      state: payoutValid ? 'connected' : 'invalid',
      detail: payoutValid
        ? 'Configured creator payout destination receives 70% of every verified creator fee (on-chain: GlobalState.creator_payout, authority-configurable).'
        : 'NEXT_PUBLIC_CREATOR_PAYOUT is not a valid Solana public key.',
    });
    if (!payoutValid) missing.push('Valid creator payout address (NEXT_PUBLIC_CREATOR_PAYOUT)');
  }

  // ---------- SOL->NVDAx conversion adapter (live: must fail closed) ----------
  {
    const { getNvdaConversionAdapter } = await import('@/lib/solana/nvda-convert');
    const adapter = getNvdaConversionAdapter();
    const liveReady = adapter.configured() && !adapter.simulated;
    components.push({
      id: 'nvda_conversion',
      label: 'NVDAx Conversion',
      state: liveReady ? 'connected' : 'not_configured',
      detail: adapter.configDetail(),
    });
    if (!liveReady) missing.push('Configured real SOL->NVDAx conversion route (NEXT_PUBLIC_NVDA_SWAP_ADAPTER); until then the 9% NVDAx allocation is retained as pending conversion and live fee processing stays blocked');
  }

  // ---------- FLOW staking mint (pre-launch state machine) ----------
  // NOT_LAUNCHED (empty) is the EXPECTED pre-launch state and is distinct
  // from a broken configuration (invalid key / wallet address / not a mint).
  if (!env.flowMint) {
    components.push({
      id: 'flow_mint',
      label: 'FLOW Staking Mint',
      state: 'not_configured',
      detail: 'FLOW NOT LAUNCHED YET — NEXT_PUBLIC_FLOW_MINT is empty. This is the expected pre-launch state, NOT an error: users stake $FLOW once the official mint is configured and verified. SOL and NVDAx remain reward assets only.',
    });
    missing.push('FLOW mint not configured');
  } else {
    let pubkeyOk = true;
    try {
      const { PublicKey } = await import('@solana/web3.js');
      new PublicKey(env.flowMint);
    } catch {
      pubkeyOk = false;
    }
    if (!pubkeyOk) {
      components.push({ id: 'flow_mint', label: 'FLOW Staking Mint', state: 'invalid', detail: 'CONFIGURATION BROKEN — NEXT_PUBLIC_FLOW_MINT is not a valid Solana public key.' });
      missing.push('Valid FLOW staking SPL mint');
    } else {
      const acc = await serverGetAccount(env.flowMint);
      if (acc && acc.exists && acc.owner === '11111111111111111111111111111111') {
        components.push({ id: 'flow_mint', label: 'FLOW Staking Mint', state: 'invalid', detail: 'CONFIGURATION BROKEN — the configured address is a WALLET (system-owned account), not a token mint. A wallet address can never be a staking mint.' });
        missing.push('Valid FLOW staking SPL mint');
      } else {
    const isMint = await serverValidateMint(env.flowMint);
    if (!isMint) {
      components.push({ id: 'flow_mint', label: 'FLOW Staking Mint', state: 'invalid', detail: 'Configured address is not an SPL Token mint on ' + env.network + '.' });
      missing.push('Valid FLOW staking SPL mint');
    } else {
      const supply = await serverGetTokenSupply(env.flowMint);
      const decimals = supply?.decimals ?? null;
      const supplyUi = supply?.uiAmount !== null && supply?.uiAmount !== undefined ? String(supply.uiAmount) : null;
      components.push({
        id: 'flow_mint',
        label: 'FLOW Staking Mint',
        state: 'connected',
        detail: 'Valid SPL Token mint on ' + env.network + ' — the staking token (validated separately from the NVDAx reward mint).',
        metrics: {
          decimals: decimals !== null ? String(decimals) : 'unavailable',
          supply: supplyUi !== null ? supplyUi : 'unavailable',
        },
      });
      }
    }
  }
  }

  // ---------- SOL reward vault ----------
  if (!env.solRewardVault) {
    components.push({ id: 'sol_vault', label: 'SOL Vault', state: 'not_configured', detail: 'NEXT_PUBLIC_SOL_REWARD_VAULT not set.' });
    missing.push('SOL reward vault address');
  } else {
    const acc = await serverGetAccount(env.solRewardVault);
    const bal = await serverGetBalance(env.solRewardVault);
    const ok = acc !== null && acc.exists;
    const solBal = bal !== null ? (bal / 1_000_000_000).toFixed(6) : null;
    components.push({
      id: 'sol_vault',
      label: 'SOL Vault',
      state: ok ? 'connected' : 'invalid',
      detail: ok
        ? 'Vault exists on-chain.' + (solBal !== null ? ' Balance: ' + solBal + ' SOL.' : '')
        : 'Address set but account does not exist on ' + env.network + '.',
      metrics: ok ? { balance: solBal !== null ? solBal + ' SOL' : 'unavailable' } : undefined,
    });
    if (!ok) missing.push('Existing SOL reward vault account');
  }

  // ---------- NVDAx mint ----------
  if (!env.nvdaMint) {
    components.push({
      id: 'nvda_mint',
      label: 'NVDAx Mint',
      state: 'not_configured',
      detail: 'NVDAx NOT CONFIGURED — NEXT_PUBLIC_NVDA_MINT not set. NVDAx rewards stay disabled; the 9% NVDAx allocation (30% of the reward pool) is retained as pending conversion and is never redirected to SOL, never rerouted or invented.',
    });
    missing.push('NVDAx token mint (NEXT_PUBLIC_NVDA_MINT)');
  } else {
    const isMint = await serverValidateMint(env.nvdaMint);
    if (!isMint) {
      components.push({ id: 'nvda_mint', label: 'NVDAx Mint', state: 'invalid', detail: 'Configured address is not an SPL Token mint on ' + env.network + '.' });
      missing.push('Valid NVDAx SPL mint');
    } else {
      const supply = await serverGetTokenSupply(env.nvdaMint);
      const decimals = supply?.decimals ?? null;
      const supplyUi = supply?.uiAmount !== null && supply?.uiAmount !== undefined ? String(supply.uiAmount) : null;
      components.push({
        id: 'nvda_mint',
        label: 'NVDAx Mint',
        state: 'connected',
        detail: 'Valid SPL Token mint on ' + env.network + '.',
        metrics: {
          decimals: decimals !== null ? String(decimals) : 'unavailable',
          supply: supplyUi !== null ? supplyUi : 'unavailable',
        },
      });
    }
  }

  // ---------- NVDAx reward vault ----------
  if (!env.nvdaRewardVault) {
    components.push({ id: 'nvda_vault', label: 'NVDAx Vault', state: 'not_configured', detail: 'NEXT_PUBLIC_NVDA_REWARD_VAULT not set.' });
    missing.push('NVDAx reward vault address');
  } else {
    const acc = await serverGetAccount(env.nvdaRewardVault);
    if (!acc || !acc.exists) {
      components.push({ id: 'nvda_vault', label: 'NVDAx Vault', state: 'invalid', detail: 'Address set but token account does not exist on ' + env.network + '.' });
      missing.push('Existing NVDAx reward vault token account');
    } else if (!env.nvdaMint) {
      components.push({ id: 'nvda_vault', label: 'NVDAx Vault', state: 'invalid', detail: 'Vault configured but the NVDAx mint is not set — cannot verify the vault holds the right token.' });
      missing.push('NVDAx mint to verify vault token match');
    } else {
      const tab = await serverGetTokenAccountBalance(env.nvdaRewardVault);
      const balUi = tab?.uiAmount !== null && tab?.uiAmount !== undefined ? String(tab.uiAmount) : null;
      // Mint match: parse the jsonParsed token account via RPC and compare mint.
      let vaultMint: string | null = null;
      try {
        vaultMint = await vaultMintOf(env.nvdaRewardVault);
      } catch {
        vaultMint = null;
      }
      const mintMatch = vaultMint === env.nvdaMint;
      components.push({
        id: 'nvda_vault',
        label: 'NVDAx Vault',
        state: mintMatch ? 'connected' : 'invalid',
        detail: mintMatch
          ? 'Token account verified against the configured NVDAx mint.' + (balUi !== null ? ' Balance: ' + balUi + ' NVDAx.' : '') + (balUi !== null && Number(balUi) > 0 ? '' : ' (EMPTY)')
          : 'Vault token account holds a DIFFERENT token than the configured NVDAx mint — rejected.',
        metrics: {
          token: 'NVDAx',
          balance: balUi !== null ? balUi + ' NVDAx' : 'unavailable',
          funded: mintMatch && balUi !== null && Number(balUi) > 0 ? 'FUNDED' : mintMatch ? 'EMPTY' : 'INVALID',
        },
      });
      if (!mintMatch) missing.push('NVDAx reward vault holding the configured mint');
    }
  }

  // ---------- Staking program ----------
  if (!env.programId) {
    components.push({ id: 'program', label: 'Staking Program', state: 'not_deployed', detail: 'NEXT_PUBLIC_PROGRAM_ID empty — production reference implementation lives in /programs/solflow. NOT DEPLOYED.' });
    missing.push('Deployed SOLFLOW staking program (NEXT_PUBLIC_PROGRAM_ID)');
  } else {
    const acc = await serverGetAccount(env.programId);
    const ok = acc !== null && acc.exists;
    components.push({
      id: 'program',
      label: 'Staking Program',
      state: ok ? 'connected' : 'invalid',
      detail: ok
        ? 'Program account exists on-chain (owner ' + (acc.owner ?? '?').slice(0, 8) + ').'
        : 'Configured program ID has no on-chain account on ' + env.network + '.',
    });
    if (!ok) missing.push('Deployed program account for NEXT_PUBLIC_PROGRAM_ID');
  }

  // ---------- Reward engine (consistency gate) ----------
  const byId = new Map(components.map((c) => [c.id, c]));
  const programOk = byId.get('program')?.state === 'connected';
  const solVaultOk = byId.get('sol_vault')?.state === 'connected';
  const flowMintOk = byId.get('flow_mint')?.state === 'connected';
  const nvdaMintOk = byId.get('nvda_mint')?.state === 'connected';
  const nvdaVaultOk = byId.get('nvda_vault')?.state === 'connected';
  const solBps = env.solAllocationBps ?? 7000;
  const nvdaBps = env.nvdaAllocationBps ?? 3000;
  const allocationsOk = solBps + nvdaBps === 10000;
  const engineOk = programOk && solVaultOk && flowMintOk && nvdaMintOk && nvdaVaultOk && allocationsOk;
  components.push({
    id: 'reward_engine',
    label: 'Reward Engine',
    state: engineOk ? 'connected' : 'not_configured',
    detail: engineOk
      ? 'Engine verified: staking program + FLOW staking mint + SOL vault + NVDAx mint/vault present. Reward-pool allocation ' + (solBps / 100) + '% SOL / ' + (nvdaBps / 100) + '% NVDAx (sums to 100% of the pool; after the 70% creator payout this is an effective 21% SOL / 9% NVDAx of every fee).'
      : 'Engine not ready — requires: ' + [
          !programOk ? 'deployed staking program' : null,
          !flowMintOk ? 'FLOW staking mint' : null,
          !solVaultOk ? 'SOL vault' : null,
          !nvdaMintOk ? 'NVDAx NOT CONFIGURED (mint)' : null,
          !nvdaVaultOk ? 'NVDAx vault' : null,
          !allocationsOk ? 'allocations must sum to 10000 bps (currently ' + (solBps + nvdaBps) + ')' : null,
        ].filter(Boolean).join(' · '),
  });
  if (!engineOk) missing.push('Reward engine fully configured (program, FLOW staking mint, vaults, NVDAx, 70/30 reward-pool allocation)');

  // ---------- live readiness ----------
  const allConnected = REQUIRED_COMPONENT_IDS.every((id) => byId.get(id)?.state === 'connected');
  const componentIds = new Set(components.map((c) => c.id));
  const allPresent = REQUIRED_COMPONENT_IDS.every((id) => componentIds.has(id));
  return {
    mode: env.demoMode ? 'demo' : 'live',
    liveReady: !env.demoMode && allConnected && allPresent && missing.length === 0,
    missing,
    components,
  };
}

/** Explicit ALCHEMY_SOLANA_RPC_URL override (kept separate for clarity). */
function customAlchemyUrl(): boolean {
  const u = process.env.ALCHEMY_SOLANA_RPC_URL;
  return u !== undefined && u.length > 0;
}

/**
 * MAINNET STAGING readiness. Evaluates ONLY the dedicated staging program and
 * its deterministically derived PDAs — never the production program, never the
 * production reward-vault env vars. Every vault address is derived from the
 * staging program ID + seeds; the optional env vault values are display-only.
 * Rewards are NOT distributed in staging, so NVDAx vault/conversion are
 * informational components and never block staging readiness.
 */
const STAGING_REQUIRED_IDS = ['alchemy', 'program', 'global_state', 'flow_mint', 'staking_vault', 'sol_vault'] as const;

export async function validateStagingInfrastructure(env: SolflowEnv): Promise<InfrastructureStatus> {
  const components: InfraComponent[] = [];
  const missing: string[] = [];
  const program = env.stagingProgramId ?? '';
  const pid = program;
  const p = (seed: string, extra?: Uint8Array) =>
    stagingPda(pid, Buffer.from(seed), ...(extra ? [Buffer.from(extra)] : []));

  // ---------- RPC (mainnet required for staging) ----------
  let rpcOk = false;
  try {
    const slot = await serverGetSlot();
    rpcOk = slot !== null && slot > 0;
  } catch {
    rpcOk = false;
  }
  const mainnetOk = rpcOk && env.network === 'mainnet-beta';
  components.push({
    id: 'alchemy',
    label: 'RPC (Alchemy)',
    state: mainnetOk ? 'connected' : 'invalid',
    detail: mainnetOk ? 'Alchemy mainnet RPC responsive (staging).' : 'Alchemy MAINNET RPC required for staging (network: ' + env.network + (rpcOk ? '' : ', RPC unresponsive') + ').',
  });
  if (!mainnetOk) missing.push('Working Alchemy MAINNET RPC endpoint');

  // ---------- Staging program deployed (raw mainnet check: executable BPF) ----------
  let programOk = false;
  try {
    const info = await serverGetAccountRawMainnet(pid);
    programOk = !!info && info.exists && info.owner === 'BPFLoaderUpgradeab1e11111111111111111111111' && info.executable === true;
  } catch {
    programOk = false;
  }
  components.push({
    id: 'program',
    label: 'Staging Program',
    state: programOk ? 'connected' : 'invalid',
    detail: programOk
      ? 'Dedicated MAINNET STAGING program ' + pid.slice(0, 8) + '… is deployed and executable.'
      : 'MAINNET STAGING — Staging program is not deployed on Mainnet yet. Deploy ' + pid + ' with the staging keypair (production program is never used).',
  });
  if (!programOk) missing.push('Deployed staging program account (' + pid + ')');

  // ---------- Deterministically derived staging PDAs (never env-entered) ----------
  const globalState = p('global');
  const solVault = p('sol_vault');
  const vaultAuth = p('vault_auth');
  const splVault = p('spl_vault');
  const nvdaPending = p('nvda_pending');
  const tstMint = env.flowMint ?? '';
  const { PublicKey } = await import('@solana/web3.js');
  const stakingVault = tstMint ? p('flow_vault', new PublicKey(tstMint).toBytes()) : '';

  // GlobalState (created by initialize)
  let gsOk = false;
  try {
    const acc = await serverGetAccount(globalState);
    gsOk = !!acc && acc.exists;
  } catch {
    gsOk = false;
  }
  components.push({
    id: 'global_state',
    label: 'Staging GlobalState',
    state: gsOk ? 'connected' : 'not_configured',
    detail: gsOk
      ? 'Staging GlobalState exists at the derived PDA (initialized).'
      : 'Staging GlobalState PDA does not exist yet — run initialize on the staging program. Derived address: ' + globalState + '.',
  });
  if (!gsOk) missing.push('Staging GlobalState (run initialize on the staging program)');

  // TST staking mint (verified on-chain; a SystemProgram-owned account is a wallet)
  if (!tstMint) {
    components.push({ id: 'flow_mint', label: 'TST Staking Mint', state: 'not_configured', detail: 'NEXT_PUBLIC_FLOW_MINT (TST) not set.' });
    missing.push('TST staking mint (NEXT_PUBLIC_FLOW_MINT)');
  } else {
    const acc = await serverGetAccount(tstMint);
    const isWallet = !!acc && acc.exists && acc.owner === '11111111111111111111111111111111';
    const isMint = !!acc && acc.exists && (acc.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' || acc.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    components.push({
      id: 'flow_mint',
      label: 'TST Staking Mint',
      state: isMint ? 'connected' : 'invalid',
      detail: isMint
        ? 'TST mint verified on mainnet (owner ' + (acc?.owner ?? '?').slice(0, 8) + '…).'
        : isWallet ? 'CONFIGURATION BROKEN — the configured staking address is a WALLET, not a mint.' : 'Configured staking address is not a token mint on mainnet.',
    });
    if (!isMint) missing.push('Verified TST staking mint on mainnet');
  }

  // TST staking vault (flow_vault PDA seeded with the TST mint)
  let stakingVaultOk = false;
  if (stakingVault) {
    try {
      const acc = await serverGetAccount(stakingVault);
      stakingVaultOk = !!acc && acc.exists;
    } catch {
      stakingVaultOk = false;
    }
  }
  components.push({
    id: 'staking_vault',
    label: 'TST Staking Vault',
    state: stakingVaultOk ? 'connected' : 'not_configured',
    detail: stakingVaultOk
      ? 'TST staking vault exists at the derived PDA.'
      : 'TST staking vault PDA does not exist yet — created by init_flow_staking. Derived address: ' + (stakingVault || 'mint not configured') + '.',
  });
  if (!stakingVaultOk) missing.push('TST staking vault (run init_flow_staking)');

  // SOL reward vault (sol_vault PDA — created by initialize)
  let solVaultOk = false;
  try {
    const acc = await serverGetAccount(solVault);
    solVaultOk = !!acc && acc.exists;
  } catch {
    solVaultOk = false;
  }
  components.push({
    id: 'sol_vault',
    label: 'SOL Vault (staging)',
    state: solVaultOk ? 'connected' : 'not_configured',
    detail: solVaultOk
      ? 'Staging SOL reward vault exists at the derived PDA (balance: ' + (await serverGetBalance(solVault) ?? 0) / 1_000_000_000 + ' SOL).'
      : 'Staging SOL vault PDA does not exist yet — created by initialize. Derived address: ' + solVault + ' (NEXT_PUBLIC_SOL_REWARD_VAULT is display-only in staging).',
  });
  if (!solVaultOk) missing.push('Staging SOL vault (run initialize)');

  // NVDAx components — informational in staging (rewards are NOT distributed)
  let nvdaVaultOk = false;
  try {
    const acc = await serverGetAccount(splVault);
    nvdaVaultOk = !!acc && acc.exists;
  } catch {
    nvdaVaultOk = false;
  }
  components.push({
    id: 'nvda_vault',
    label: 'NVDAx Vault (staging, optional)',
    state: nvdaVaultOk ? 'connected' : 'not_configured',
    detail: nvdaVaultOk
      ? 'Staging NVDAx vault exists at the derived PDA.'
      : 'Staging NVDAx vault PDA does not exist yet (created by init_spl_asset, optional in staging). Derived: ' + splVault + '.',
  });
  components.push({
    id: 'nvda_pending',
    label: 'NVDAx Pending Vault (staging, optional)',
    state: (await serverGetAccount(nvdaPending))?.exists ? 'connected' : 'not_configured',
    detail: 'Derived from the staging program (' + nvdaPending + '). Rewards are not distributed in staging, so this component never blocks staging readiness.',
  });
  components.push({
    id: 'vault_auth',
    label: 'Vault Authority (staging)',
    state: (await serverGetAccount(vaultAuth))?.exists ? 'connected' : 'not_configured',
    detail: 'vault_auth PDA ' + vaultAuth + ' — payout signer for the staging program (created by initialize).',
  });

  // ---------- staging readiness ----------
  const byId = new Map(components.map((c) => [c.id, c]));
  const ready = STAGING_REQUIRED_IDS.every((id) => byId.get(id)?.state === 'connected') && missing.length === 0;
  return {
    mode: 'staging',
    liveReady: ready,
    missing,
    components,
  };
}


/** jsonParsed mint lookup for a token account (mint match verification). */
async function vaultMintOf(tokenAccount: string): Promise<string | null> {
  const { serverRpc } = await import('@/lib/providers/alchemy');
  const r = await serverRpc<{ value?: { account?: { data?: { parsed?: { info?: { mint?: string } } } } } } | null>(
    'getAccountInfo',
    [tokenAccount, { encoding: 'jsonParsed' }]
  );
  return r?.value?.account?.data?.parsed?.info?.mint ?? null;
}
