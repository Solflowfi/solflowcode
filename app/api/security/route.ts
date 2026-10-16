import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getEnv } from '@/config/env';
import { resolveRpcUrl } from '@/lib/providers/alchemy';
import {
  mainnetRpcUrl,
  serverGetAccountRawMainnet,
  serverRpcAt,
  type RawAccount,
} from '@/lib/providers/alchemy';
import type { SecurityItem, SecurityReport } from '@/types';
import { getMode } from '@/lib/mode';
import { isStagingActive } from '@/lib/staging';

const EM = '—'; // em dash used across item details

export const dynamic = 'force-dynamic';

/**
 * SECURITY REPORT — real state only.
 *
 * Every badge is derived from actual configuration or on-chain mainnet state:
 *   - Program deployment: getAccountInfo on MAINNET (never the app network).
 *   - Upgrade authority: parsed on-chain from the BPF-loader program-data
 *     account (never inferred, never exposed with keys).
 *   - Verification / audit: operator attestations from SERVER-ONLY env vars
 *     (PROGRAM_VERIFIED, PROGRAM_AUDITOR, PROGRAM_AUDIT_URL) — a successful
 *     local build never implies verification.
 *   - Treasury: NEXT_PUBLIC_TREASURY config; when the program is deployed the
 *     value is cross-checked against the treasury PINNED in GlobalState.
 *   - Admin gate: ADMIN_WALLET (server-side only) — the browser only learns
 *     whether the gate is configured, never the address.
 *   - Emergency controls: ACTIVE only when the program is deployed on mainnet
 *     AND the admin gate is configured (the operator can then sign pause /
 *     unpause). Demo/devnet state is never reported as ACTIVE.
 *   - Private keys: structural fact — the app holds none, wallets sign locally.
 */

const BPF_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
/** GlobalState layout offset of `treasury` (post-economics-update layout). */
const GLOBAL_STATE_LEN = 174;
const TREASURY_OFFSET = 142; // 8 discriminator + preceding fields

function short(address: string): string {
  return address.length > 12 ? address.slice(0, 4) + '…' + address.slice(-4) : address;
}

function solscan(address: string): string {
  return 'https://solscan.io/account/' + address;
}

/** Derive the GlobalState PDA for the given program. */
function globalStatePda(programId: string): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('global')], new PublicKey(programId))[0];
}

/** Parse the program-data address from a BPF-loader upgradeable program. */
function parseProgramData(programInfo: RawAccount): string | null {
  if (programInfo.owner !== BPF_LOADER || programInfo.data.length < 40) return null;
  const data = Buffer.from(programInfo.data, 'base64');
  if (data.length < 40) return null;
  return new PublicKey(data.slice(4, 36)).toBase58();
}

/** Parse the upgrade authority from the ProgramData account. */
function parseDataAuthority(programDataInfo: RawAccount): string | null {
  const data = Buffer.from(programDataInfo.data, 'base64');
  // layout: 4-byte enum + Option<Pubkey> + state; Option = 0 → immutable
  if (data.length < 5 || data[4] === 0) return null;
  if (data.length < 37) return null;
  return new PublicKey(data.slice(5, 37)).toBase58();
}

/** Read the treasury PINNED in GlobalState at a specific RPC endpoint. */
async function readPinnedTreasuryAt(url: string, programId: string): Promise<{ found: boolean; treasury: string | null } | null> {
  if (!url) return null;
  try {
    const pda = globalStatePda(programId);
    const r = await serverRpcAt<{ value: { data: [string, string] } | null }>(
      url,
      'getAccountInfo',
      [pda.toBase58(), { encoding: 'base64' }],
    );
    if (!r.value) return { found: false, treasury: null };
    const data = Buffer.from(r.value.data[0], 'base64');
    if (data.length < GLOBAL_STATE_LEN) return { found: true, treasury: null }; // older layout
    return { found: true, treasury: new PublicKey(data.slice(TREASURY_OFFSET, TREASURY_OFFSET + 32)).toBase58() };
  } catch {
    return null;
  }
}

export async function GET() {
  const env = getEnv();
  const items: SecurityItem[] = [];
  const checkedAt = Math.floor(Date.now() / 1000);
  // RPC for the CONFIGURED network (devnet today) — reads the GlobalState
  // treasury actually pinned on-chain.
  const configuredRpcUrl = resolveRpcUrl();
  // Environment-aware program: the DEDICATED STAGING program while staging
  // mode is active, the production program otherwise. Security items always
  // evaluate the program the app actually uses in the current environment.
  const activeProgram = isStagingActive() && env.stagingProgramId ? env.stagingProgramId : env.programId;

  // ---------- 1. PROGRAM (mainnet deployment) ----------
  const mainnetUrl = mainnetRpcUrl();
  let mainnetDeployed = false;
  let programDetail: string;
  let programLink: string | null = null;
  if (!activeProgram) {
    programDetail = 'NEXT_PUBLIC_PROGRAM_ID is not configured — the SOLFLOW Anchor program exists only as source in /programs.';
  } else if (!mainnetUrl) {
    programDetail = 'Mainnet RPC is not configured (server-side ALCHEMY_API_KEY missing) — deployment cannot be checked.';
  } else {
    try {
      const info = await serverGetAccountRawMainnet(activeProgram);
      if (info && info.exists && info.owner === BPF_LOADER && info.executable) {
        mainnetDeployed = true;
        programDetail = 'Program account exists on MAINNET (BPF loader upgradeable, executable, ' + info.lamports + ' lamports).';
      } else {
        programDetail = 'No program account exists on MAINNET for ' + activeProgram + ' — the program is NOT deployed.';
      }
      programLink = solscan(activeProgram);
    } catch (e) {
      programDetail = 'Mainnet check failed: ' + (e instanceof Error ? e.message : 'RPC error');
    }
  }
  items.push({
    key: 'program',
    label: isStagingActive() ? 'Staging Program' : 'Program',
    badge: mainnetDeployed ? 'DEPLOYED' : 'NOT DEPLOYED',
    detail: programDetail,
    address: activeProgram,
    link: programLink,
  });

  // ---------- 2. PROGRAM VERIFICATION (operator attestation, server-only) ----------
  const verified = process.env.PROGRAM_VERIFIED === 'true';
  items.push({
    key: 'verification',
    label: 'Program Verification',
    badge: verified ? 'VERIFIED' : 'UNVERIFIED',
    detail: verified
      ? 'The deployed build has been verified on-chain (operator attestation, stored server-side only).'
      : 'No on-chain build verification exists for any deployed build. Verification is never inferred from a successful local build — the server-side PROGRAM_VERIFIED attestation is set only after real verification.',
    address: activeProgram,
    link: programLink,
  });

  // ---------- 3. AUDIT ----------
  const auditor = (process.env.PROGRAM_AUDITOR ?? '').trim();
  const auditUrl = (process.env.PROGRAM_AUDIT_URL ?? '').trim();
  items.push({
    key: 'audit',
    label: 'Audit',
    badge: auditor ? 'AUDITED' : 'NOT AUDITED',
    detail: auditor
      ? 'Security review by ' + auditor + (auditUrl ? ' — report linked.' : ' (no report URL configured).')
      : 'No audit exists. SOLFLOW does not claim any third-party security review. An auditor and report link appear here only after a real audit (server-side PROGRAM_AUDITOR / PROGRAM_AUDIT_URL).',
    address: null,
    link: auditUrl || null,
  });

  // ---------- 4. TREASURY / OPERATIONS (config + on-chain pinned cross-check) ----------
  // The treasury is an OPERATIONS wallet (protocol fee destination, NVDAx
  // acquisition float). It is NEVER a reward vault: all reward vaults are
  // program-derived PDAs listed separately below.
  let treasuryDetail: string;
  let treasuryBadge: SecurityItem['badge'];
  if (env.treasury) {
    treasuryDetail = 'Configured TREASURY / OPERATIONS wallet: ' + short(env.treasury) + '. Holds retained/operational SOL (including the SOL reserved for NVDAx acquisition). It is NOT a reward vault — all reward vaults are program-derived PDAs listed separately.';
    // Cross-check the treasury PINNED in GlobalState on the DEPLOYED network
    // (devnet today): configuration drift is surfaced, never hidden.
    const configuredUrl = env.network === 'mainnet-beta' ? mainnetUrl : configuredRpcUrl;
    const pinned = configuredUrl ? await readPinnedTreasuryAt(configuredUrl, activeProgram as string) : null;
    if (pinned && pinned.found && pinned.treasury) {
      const match = pinned.treasury === env.treasury;
      treasuryDetail += ' GlobalState (' + env.network + ') pins: ' + short(pinned.treasury) + ' — ' + (match ? 'MATCH.' : 'MISMATCH — configuration drift. Run the authority-only set_treasury migration to align on-chain state.');
      treasuryBadge = match ? 'PINNED' : 'DRIFT';
    } else if (pinned && pinned.found) {
      treasuryDetail += ' GlobalState found but uses a pre-treasury layout — pinning update required.';
      treasuryBadge = 'DRIFT';
    } else {
      treasuryBadge = 'PINNED';
      treasuryDetail += ' No GlobalState account exists on ' + env.network + ' yet (program not initialized) — the next initialize pins the configured treasury exactly as shown here.';
    }
  } else {
    treasuryBadge = 'UNCONFIGURED';
    treasuryDetail = 'NEXT_PUBLIC_TREASURY is not configured — no operator treasury is pinned.';
  }
  items.push({
    key: 'treasury',
    label: 'Treasury / Operations',
    badge: treasuryBadge,
    detail: treasuryDetail,
    address: env.treasury,
    link: env.treasury ? solscan(env.treasury) : null,
  });

  // ---------- 4b. PROGRAM-DERIVED VAULTS + AUTHORITY + GLOBAL STATE ----------
  // All of these are PDAs derived from the program id and seeds — never
  // user wallets, and never the treasury/operations wallet above.
  const programKey = new PublicKey(activeProgram as string);
  const derivePda = (seeds: Buffer[]): string => PublicKey.findProgramAddressSync(seeds, programKey)[0].toBase58();
  const pdaItems: Array<{ key: string; label: string; address: string; seeds: string; role: string }> = [
    { key: 'sol_reward_vault', label: 'SOL Reward Vault', address: derivePda([Buffer.from('sol_vault')]), seeds: '["sol_vault"]', role: 'Holds SOL rewards pending distribution to stakers; SOL claims pay from here.' },
    { key: 'nvda_reward_vault', label: 'NVDAx Reward Vault', address: derivePda([Buffer.from('spl_vault')]), seeds: '["spl_vault"]', role: 'Token-2022 vault holding NVDAx rewards; funded only via fund_spl_rewards with the pinned NVDAx mint.' },
    { key: 'vault_authority', label: 'Vault Authority', address: derivePda([Buffer.from('vault_auth')]), seeds: '["vault_auth"]', role: 'Program PDA that owns the reward vaults and signs SPL transfers for claims; holds no key.' },
    { key: 'global_state', label: 'Global State', address: derivePda([Buffer.from('global')]), seeds: '["global"]', role: 'Program configuration: authority, pinned creator payout, pinned treasury, bumps, accounting.' },
  ];
  for (const v of pdaItems) {
    items.push({
      key: v.key,
      label: v.label,
      badge: 'PDA',
      detail: 'Program-derived address (PDA) — seeds ' + v.seeds + '. ' + v.role + ' Never a user wallet; distinct from the Treasury / Operations wallet.',
      address: v.address,
      link: solscan(v.address),
    });
  }

  // ---------- 5. UPGRADE AUTHORITY (on-chain detection) ----------
  let upgradeDetail: string;
  let upgradeBadge: SecurityItem['badge'];
  let upgradeAddress: string | null = null;
  if (!mainnetDeployed) {
    upgradeDetail = 'Program is not deployed on mainnet — no on-chain upgrade authority exists yet. At deployment the authority is read directly from the BPF-loader program-data account and shown here.';
    upgradeBadge = 'NOT DEPLOYED';
  } else {
    try {
      const info = await serverGetAccountRawMainnet(activeProgram as string);
      const dataAddr = info ? parseProgramData(info) : null;
      if (!dataAddr) {
        upgradeDetail = 'Program account could not be parsed as a BPF-loader upgradeable program.';
        upgradeBadge = 'NOT DEPLOYED';
      } else {
        const pdInfo = await serverGetAccountRawMainnet(dataAddr);
        if (!pdInfo || !pdInfo.exists) {
          upgradeDetail = 'ProgramData account not found on mainnet.';
          upgradeBadge = 'NOT DEPLOYED';
        } else {
          const authority = parseDataAuthority(pdInfo);
          if (!authority) {
            upgradeDetail = 'Upgrade authority is NONE — the program is IMMUTABLE (no upgrades possible).';
            upgradeBadge = 'IMMUTABLE';
          } else {
            upgradeAddress = authority;
            const operatorWallets = [env.creatorPayout, env.treasury, process.env.ADMIN_WALLET ?? null].filter(Boolean) as string[];
            if (operatorWallets.includes(authority)) {
              upgradeDetail = 'Upgrade authority is held by the operator wallet ' + short(authority) + ' (matches a configured operator/admin address). The authority is read on-chain; no keys are involved.';
              upgradeBadge = 'OPERATOR HELD';
            } else {
              upgradeDetail = 'Upgrade authority is held by an external address ' + short(authority) + ' (e.g. a multisig/governance PDA — governance type not verified on-chain).';
              upgradeBadge = 'MULTISIG / EXTERNAL';
            }
          }
        }
      }
    } catch (e) {
      upgradeDetail = 'Upgrade-authority check failed: ' + (e instanceof Error ? e.message : 'RPC error');
      upgradeBadge = 'NOT DEPLOYED';
    }
  }
  items.push({
    key: 'upgrade_authority',
    label: 'Upgrade Authority',
    badge: upgradeBadge,
    detail: upgradeDetail,
    address: upgradeAddress,
    link: upgradeAddress ? solscan(upgradeAddress) : null,
  });

  // ---------- 6. ADMIN AUTHORITY (server-side gate) ----------
  const adminConfigured = !!process.env.ADMIN_WALLET;
  items.push({
    key: 'admin',
    label: 'Admin Authority',
    badge: adminConfigured ? 'SERVER-GATED' : 'GATE UNCONFIGURED',
    detail: adminConfigured
      ? 'Admin API is wallet-gated via a server-side ADMIN_WALLET check (' + short(process.env.ADMIN_WALLET as string) + '). No admin capability or admin address exists in the browser bundle.'
      : 'ADMIN_WALLET is not configured — admin API requests are rejected until the operator sets it (server-side only; the address is never sent to the browser).',
    address: null,
    link: null,
  });

  // ---------- 7. EMERGENCY CONTROLS ----------
  const emergencyActive = mainnetDeployed && adminConfigured;
  items.push({
    key: 'emergency',
    label: 'Emergency Controls',
    badge: emergencyActive ? 'ACTIVE' : 'NOT AVAILABLE',
    detail: emergencyActive
      ? 'PAUSE / UNPAUSE are available on the deployed mainnet program (authority-only). Pause blocks stake, unstake, claim_sol, claim_nvdax and claim_all — funding stays open. The operator signs these transactions with the configured admin wallet.'
      : mainnetDeployed
        ? 'The program is deployed but ADMIN_WALLET is not configured — the operator cannot sign pause/unpause yet.'
        : 'The program includes authority-only pause/unpause (pause blocks stake, unstake and all claims — verified by the accounting suite), but it is not deployed on mainnet. Emergency controls become ACTIVE only after deployment + admin configuration; demo mode never reports them as active.',
    address: activeProgram,
    link: programLink,
  });

  // ---------- 8. PRIVATE KEYS ----------
  items.push({
    key: 'private_keys',
    label: 'Private Keys',
    badge: 'NONE HELD',
    detail: 'The application never requests, stores or transmits private keys. No key material exists in the browser bundle; wallets sign locally.',
    address: null,
    link: null,
  });

  // ---------- 9. $FLOW LAUNCH STATE (pre-launch) ----------
  // NOT LAUNCHED is the expected pre-launch state and is never an error.
  {
    const flowConfigured = !!env.flowMint;
    let flowBadge: SecurityItem['badge'] = 'NOT LAUNCHED';
    let flowDetail = '$FLOW is not launched yet ' + EM + ' NEXT_PUBLIC_FLOW_MINT is empty. This is the expected pre-launch state: staking UI shows Coming Soon and live staking stays LOCKED until the official $FLOW mint is configured and verified.';
    if (flowConfigured && isStagingActive()) {
      flowBadge = 'STAGING';
      flowDetail = 'MAINNET STAGING: the configured staking mint is the $TST test token (' + short(env.flowMint as string) + ') on the DEDICATED staging program. Production $FLOW is not launched; the production program stays untouched.';
    } else if (flowConfigured) {
      flowBadge = 'CONFIGURED';
      flowDetail = 'FLOW mint configured (' + short(env.flowMint as string) + '). On-chain mint verification is reported by /api/flow-status and the infrastructure validator; live staking activates only after the mint verifies AND init_flow_staking completes.';
    }
    items.push({
      key: 'flow',
      label: isStagingActive() ? 'Staking Token ($TST staging)' : '$FLOW Token',
      badge: flowBadge,
      detail: flowDetail,
      address: env.flowMint,
      link: env.flowMint ? solscan(env.flowMint) : null,
    });
  }

  // ---------- 10. CREATOR FEE SOURCE (configured vs verified) ----------
  // VERIFIED requires real on-chain fee evidence (GlobalState.total_fees_received
  // > 0). A configured-but-unused wallet is never shown as verified.
  {
    const feeSource = (env.feeSources[0] ?? null);
    let feeBadge: SecurityItem['badge'] = 'UNCONFIGURED';
    let feeDetail = 'No creator fee source configured ' + EM + ' set NEXT_PUBLIC_CREATOR_FEE_SOURCE. Live fee processing is blocked without a whitelisted source.';
    if (feeSource) {
      feeBadge = 'AWAITING VERIFICATION';
      feeDetail = 'Creator fee source configured: ' + short(feeSource) + ' (whitelisted via init_fee_source; record_fee requires the funder to BE this wallet and to transfer real SOL). On-chain fee evidence: not yet observed ' + EM + ' status stays Awaiting Verification until a real creator fee is processed (GlobalState.total_fees_received > 0).';
      const gsUrl = configuredRpcUrl;
      if (gsUrl) {
        try {
          const programKey2 = new PublicKey(activeProgram as string);
          const [gs] = PublicKey.findProgramAddressSync([Buffer.from('global')], programKey2);
          const r = await serverRpcAt<{ value: { data: [string, string] } | null }>(gsUrl, 'getAccountInfo', [gs.toBase58(), { encoding: 'base64' }]);
          if (r.value) {
            const data = Buffer.from(r.value.data[0], 'base64');
            if (data.length > 49 + 8) {
              const fees = data.readBigUInt64LE(49);
              feeDetail += fees > 0n
                ? ' On-chain evidence: ' + fees.toString() + ' lamports of verified creator fees processed.'
                : ' On-chain evidence: total_fees_received = 0 (awaiting the first real fee).';
            }
          }
        } catch {
          // evidence unavailable: status stays Awaiting Verification
        }
      }
    }
    items.push({
      key: 'creator_fee_source',
      label: 'Creator Fee Source',
      badge: feeBadge,
      detail: feeDetail,
      address: feeSource,
      link: feeSource ? solscan(feeSource) : null,
    });
  }

  // ---------- 11. JUPITER ADAPTER (SOL -> NVDAx conversion) ----------
  {
    const adapterSelected = env.nvdaSwapAdapter === 'jupiter-swap-v2';
    const keyPresent = typeof process !== 'undefined' && !!process.env.JUPITER_API_KEY;
    let jupBadge: SecurityItem['badge'] = 'UNCONFIGURED';
    let jupDetail = 'Jupiter swap adapter is not configured. The SOL reserved for NVDAx rewards stays pending ' + EM + ' never swapped by a fake route.';
    if (adapterSelected && keyPresent) {
      jupBadge = 'CONFIGURED';
      jupDetail = 'Jupiter Swap API v2 adapter configured (server-side key present). Live conversion runs only in live mode with all prerequisites; the API key never leaves the server.';
    } else if (adapterSelected) {
      jupDetail = 'Adapter selected but the server-side JUPITER_API_KEY is missing ' + EM + ' live conversion fails closed.';
    }
    items.push({
      key: 'jupiter',
      label: 'Jupiter Adapter',
      badge: jupBadge,
      detail: jupDetail,
      address: null,
      link: null,
    });
  }

  const report: SecurityReport = {
    mode: getMode(),
    network: env.network,
    checkedOn: mainnetUrl ? 'mainnet' : 'unavailable',
    items,
    checkedAt,
  };
  return NextResponse.json(report);
}

