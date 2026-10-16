import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getEnv } from '@/config/env';
import {
  classifyFlowMintSyntax,
  flowVaultPda,
  SYSTEM_PROGRAM_ID,
  SOLFLOW_PROGRAM_ID,
  type FlowStatus,
} from '@/lib/flow-status';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt } from '@/lib/providers/alchemy';
import { isStagingActive } from '@/lib/staging';

export const dynamic = 'force-dynamic';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const GLOBAL_STATE_DISC = 8;
const STAKING_MINT_OFFSET = GLOBAL_STATE_DISC + 32 + 1 + 8 + 8; // disc + authority + paused + total_shares + total_fees_received
const TOTAL_FEES_OFFSET = GLOBAL_STATE_DISC + 32 + 1;

interface MintCheck {
  exists: boolean;
  isMint: boolean;
  walletAddress: boolean;
  tokenProgram: string | null;
  decimals: number | null;
  supply: string | null;
  initialized: boolean;
  totalFeesReceived: string | null;
}

/**
 * GET /api/flow-status — server-side $FLOW launch state.
 * Empty mint => NOT_LAUNCHED (a valid pre-launch state, never an error).
 * A configured mint is verified ON-CHAIN: exists, is a real mint (owned by a
 * token program — a SystemProgram-owned account is a WALLET and is refused),
 * decimals + supply read, and the program's init_flow_staking registration
 * checked via GlobalState. liveReady is NEVER true without a verified mint.
 */
export async function GET() {
  const env = getEnv();
  // Staging evaluates the STAGING program's GlobalState/vault — never production.
  const stagingActive = isStagingActive();
  const programId = stagingActive && env.stagingProgramId ? env.stagingProgramId : SOLFLOW_PROGRAM_ID;
  const syntax = classifyFlowMintSyntax(env.flowMint);
  const check: MintCheck = {
    exists: false,
    isMint: false,
    walletAddress: false,
    tokenProgram: null,
    decimals: null,
    supply: null,
    initialized: false,
    totalFeesReceived: null,
  };
  let status: FlowStatus = syntax.status === 'CONFIG_ERROR' ? 'CONFIG_ERROR' : syntax.status === 'NOT_LAUNCHED' ? 'NOT_LAUNCHED' : 'CONFIGURED';

  // On-chain verification target: FLOW is a MAINNET token — always verify
  // against mainnet when the configured network is not mainnet.
  const verifyUrl = mainnetRpcUrl() ?? (env.network === 'mainnet-beta' ? resolveRpcUrl() : null);
  let mintPda: string | null = null;

  if (syntax.status === 'CONFIGURED' && verifyUrl) {
    try {
      const mintKey = new PublicKey(env.flowMint as string);
      const r = await serverRpcAt<{ value: { owner: string; data: [string, string]; lamports: number } | null }>(
        verifyUrl,
        'getAccountInfo',
        [mintKey.toBase58(), { encoding: 'base64' }],
      );
      if (r.value) {
        check.exists = true;
        const owner = r.value.owner;
        check.tokenProgram = owner;
        if (owner === SYSTEM_PROGRAM_ID) {
          check.walletAddress = true;
          status = 'CONFIG_ERROR';
        } else if (owner === TOKEN_PROGRAM || owner === TOKEN_2022) {
          const data = Buffer.from(r.value.data[0], 'base64');
          if (data.length >= 82) {
            check.isMint = true;
            check.decimals = data[44];
            check.supply = BigInt('0x' + Buffer.from(data.slice(36, 44)).reverse().toString('hex')).toString();
            if (status === 'CONFIGURED') status = 'VERIFIED';
            mintPda = flowVaultPda(mintKey.toBase58(), programId);
          } else {
            status = 'CONFIG_ERROR';
          }
        } else {
          status = 'CONFIG_ERROR';
        }
      } else {
        // No account on mainnet: if the configured network IS mainnet this is
        // a broken config; otherwise the mint simply is not on mainnet yet.
        status = env.network === 'mainnet-beta' ? 'CONFIG_ERROR' : 'CONFIGURED';
      }
    } catch {
      // RPC failure: keep CONFIGURED (verification pending), never fake LIVE.
    }
  }

  // INITIALIZED: the program registered this exact mint (GlobalState.staking_mint).
  if (check.isMint) {
    const networkUrl = env.network === 'mainnet-beta' ? mainnetRpcUrl() ?? resolveRpcUrl() : resolveRpcUrl();
    const pdaGlobal = new PublicKey(programId);
    const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global')], pdaGlobal);
    if (networkUrl) {
      try {
        const r = await serverRpcAt<{ value: { data: [string, string] } | null }>(
          networkUrl,
          'getAccountInfo',
          [globalState.toBase58(), { encoding: 'base64' }],
        );
        if (r.value) {
          const data = Buffer.from(r.value.data[0], 'base64');
          if (data.length > STAKING_MINT_OFFSET + 32) {
            const stakingMint = new PublicKey(data.slice(STAKING_MINT_OFFSET, STAKING_MINT_OFFSET + 32)).toBase58();
            check.initialized = stakingMint === (env.flowMint as string);
            if (check.initialized && status === 'VERIFIED') status = 'INITIALIZED';
          }
          if (data.length > TOTAL_FEES_OFFSET + 8) {
            check.totalFeesReceived = data.readBigUInt64LE(TOTAL_FEES_OFFSET).toString();
          }
        }
      } catch {
        // GlobalState unavailable: INITIALIZED stays false (fail closed).
      }
    }
  }

  // LIVE is decided by the infrastructure validator (never here); this route
  // only reports the FLOW-specific state. INITIALIZED ≠ LIVE.
  return NextResponse.json({
    status,
    mint: env.flowMint,
    vaultPda: mintPda,
    network: env.network,
    program: programId,
    staging: stagingActive,
    check,
    liveReadyNote: stagingActive
      ? 'MAINNET STAGING: $TST staking runs on the dedicated staging program (' + programId + '). Rewards are not distributed in staging.'
      : 'Live staking stays LOCKED until the official $FLOW mint is configured, verified, initialized on-chain, and every live prerequisite passes.',
  });
}
