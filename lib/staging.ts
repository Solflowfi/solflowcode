// MAINNET STAGING ($TST) helpers. CLIENT-SAFE.
//
// Staging is a SEPARATE deployment of the SOLFLOW program with its own
// keypair/ID, used to rehearse staking with a real mainnet test token ($TST)
// before $FLOW launches. Production configuration is never touched: when
// NEXT_PUBLIC_STAKING_TEST_MODE is false (or no staging program id is set),
// every helper here resolves to the production configuration.

import { PublicKey } from '@solana/web3.js';
import { getEnv } from '../config/env.ts';

export const STAGING_PROGRAM_ID = 's4VqR5ayvD3PALEiBFTdMBEdy6beN9YtNesG3BsBBFW';
export const PRODUCTION_PROGRAM_ID = 'DzWRKvCg5xZuaYSb1W2Dau4UUWPqGUohWWAxheMnuQyQ';

export const TOKEN_PROGRAM_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_PROGRAM_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * true when the app runs in MAINNET STAGING mode: demo mode is OFF, the
 * operator explicitly enabled NEXT_PUBLIC_STAKING_TEST_MODE AND configured the
 * dedicated staging program id. DEMO mode always wins (environment matrix A
 * takes precedence over B). Production ($FLOW) configuration is never implied.
 */
export function isStagingActive(): boolean {
  const env = getEnv();
  return !env.demoMode && env.stakingTestMode === true && !!env.stagingProgramId;
}

/**
 * The program the staking UI should talk to: the dedicated staging program in
 * staging mode, the production program otherwise. Staking stays LOCKED in
 * either case until the on-chain initialization prerequisites pass.
 */
export function activeStakingProgramId(): string | null {
  const env = getEnv();
  if (isStagingActive()) return env.stagingProgramId;
  return env.programId;
}

/** Staking token symbol: $TST in mainnet staging, $FLOW in production. */
export function stakingTokenSymbol(): string {
  return isStagingActive() ? 'TST' : 'FLOW';
}

/** The staking mint: the $TST test mint in staging, the $FLOW mint later. */
export function stakingMintAddress(): string | null {
  const env = getEnv();
  return env.flowMint; // generic STAKING_MINT: represents $TST in staging
}

/** Program-aware PDA derivation (seeds are the same; the program id differs). */
export function stagingPda(programId: string, ...seeds: Buffer[]): string {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(programId))[0].toBase58();
}

export function globalStatePdaOf(programId: string): string {
  return stagingPda(programId, Buffer.from('global'));
}
export function solVaultPdaOf(programId: string): string {
  return stagingPda(programId, Buffer.from('sol_vault'));
}
export function vaultAuthorityPdaOf(programId: string): string {
  return stagingPda(programId, Buffer.from('vault_auth'));
}
export function splVaultPdaOf(programId: string): string {
  return stagingPda(programId, Buffer.from('spl_vault'));
}
export function nvdaPendingPdaOf(programId: string): string {
  return stagingPda(programId, Buffer.from('nvda_pending'));
}
export function flowVaultPdaOf(programId: string, stakingMint: string): string {
  return stagingPda(programId, Buffer.from('flow_vault'), new PublicKey(stakingMint).toBuffer());
}
export function positionPdaOf(programId: string, user: string): string {
  return stagingPda(programId, Buffer.from('position'), new PublicKey(user).toBuffer());
}
