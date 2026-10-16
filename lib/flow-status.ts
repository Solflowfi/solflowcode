// $FLOW pre-launch status machine. CLIENT-SAFE (pure logic + web3.js PDA
// derivation only — no secrets, no server imports).
//
// States:
//   NOT_LAUNCHED  no mint configured (expected pre-launch state, NOT an error)
//   CONFIG_ERROR  something IS configured but is wrong (invalid key / wallet
//                 address used as a mint / not a mint on the target network)
//   CONFIGURED    a syntactically valid mint address is configured
//   VERIFIED      the mint exists on the target network and is a real mint
//   INITIALIZED   the program's init_flow_staking has registered the mint
//   LIVE          all live prerequisites pass (infrastructure liveReady)
//
// There is deliberately NO state that could ever show a fake FLOW mint or a
// fake staking vault: while no mint is configured, the vault is simply not
// derived and staking UI shows "Coming Soon".

import { PublicKey } from '@solana/web3.js';

export type FlowStatus =
  | 'NOT_LAUNCHED'
  | 'CONFIG_ERROR'
  | 'CONFIGURED'
  | 'VERIFIED'
  | 'INITIALIZED'
  | 'LIVE';

export const SOLFLOW_PROGRAM_ID = 'DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export interface FlowMintSyntax {
  status: 'NOT_LAUNCHED' | 'CONFIG_ERROR' | 'CONFIGURED';
  detail: string;
}

/**
 * Syntactic classification of the configured FLOW mint. This is the ONLY
 * decision that can be made without network access. Deliberately distinguishes
 * "not launched yet" (empty) from "configuration is broken" (invalid).
 */
export function classifyFlowMintSyntax(mint: string | null | undefined): FlowMintSyntax {
  const v = (mint ?? '').trim();
  if (v === '') {
    return {
      status: 'NOT_LAUNCHED',
      detail: '$FLOW is not launched yet. Staking will activate after the official $FLOW mint is configured by the operator.',
    };
  }
  let key: PublicKey;
  try {
    key = new PublicKey(v);
  } catch {
    return { status: 'CONFIG_ERROR', detail: 'NEXT_PUBLIC_FLOW_MINT is not a valid Solana public key — configuration is broken.' };
  }
  // A 32-byte value that decodes is not necessarily a mint, but some things
  // are definitively NOT mints: the system program / zero address.
  if (key.equals(PublicKey.default)) {
    return { status: 'CONFIG_ERROR', detail: 'NEXT_PUBLIC_FLOW_MINT is the zero address — configuration is broken.' };
  }
  return { status: 'CONFIGURED', detail: 'FLOW mint address configured (syntactically valid). On-chain verification pending.' };
}

/** Derive the FLOW staking vault PDA — only meaningful once a mint exists. */
export function flowVaultPda(mint: string, programId: string = SOLFLOW_PROGRAM_ID): string {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('flow_vault'), new PublicKey(mint).toBuffer()],
    new PublicKey(programId),
  )[0].toBase58();
}

export const FLOW_COMING_SOON = 'Coming Soon';
export const FLOW_COMING_SOON_DETAIL =
  'Staking will activate after the official $FLOW mint is configured and verified. There is no $FLOW token to stake yet.';
