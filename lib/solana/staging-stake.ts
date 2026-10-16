// $TST mainnet staging: RAW staking transaction builders. CLIENT-SAFE.
//
// Builds Anchor instructions for the dedicated STAGING program without any
// anchor client dependency (8-byte sha256 discriminators + typed args).
// Signing happens in the user's wallet (Phantom); no server keys involved.
//
// Instruction account orders mirror programs/solflow-staging/src/lib.rs.
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';

export const TOKEN_PROGRAM_CLASSIC = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_PROGRAM_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const disc = (name: string): Buffer => createHash('sha256').update(name).digest().subarray(0, 8);
const u64le = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  let x = n;
  for (let i = 0; i < 8; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
};

export function pda(programId: string, ...seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, new PublicKey(programId))[0];
}

/** Associated Token Account derivation for either token program. */
export function deriveAta(mint: string, owner: string, tokenProgram: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'),
  )[0];
}

/** The token program that owns a mint (classic SPL or Token-2022), via RPC. */
export async function mintTokenProgram(connection: Connection, mint: string): Promise<string | null> {
  try {
    const info = await connection.getAccountInfo(new PublicKey(mint));
    if (!info) return null;
    return info.owner.toBase58();
  } catch {
    return null;
  }
}

export interface StagingStakeAccounts {
  globalState: PublicKey;
  userPosition: PublicKey;
  stakingMint: PublicKey;
  stakingVault: PublicKey;
  userAta: PublicKey;
  vaultAuthority: PublicKey;
  tokenProgram: string;
}

export function deriveStakeAccounts(programId: string, user: string, stakingMint: string, tokenProgram: string): StagingStakeAccounts {
  const mintKey = new PublicKey(stakingMint);
  const userKey = new PublicKey(user);
  return {
    globalState: pda(programId, Buffer.from('global')),
    userPosition: pda(programId, Buffer.from('position'), userKey.toBuffer()),
    stakingMint: mintKey,
    stakingVault: pda(programId, Buffer.from('flow_vault'), mintKey.toBuffer()),
    userAta: deriveAta(stakingMint, user, tokenProgram),
    vaultAuthority: pda(programId, Buffer.from('vault_auth')),
    tokenProgram,
  };
}

const RPC = 'https://api.mainnet-beta.solana.com';
const conn = () => new Connection(RPC, 'confirmed');

/** open_position + stake in ONE transaction; open_position is included only
 *  when the user's position PDA does not exist yet (first-time staker). */
export async function buildStakeTransaction(
  programId: string,
  user: string,
  stakingMint: string,
  amountRaw: bigint,
): Promise<{ transaction: Transaction; needsPosition: boolean; accounts: StagingStakeAccounts }> {
  if (amountRaw <= 0n) throw new Error('Stake amount must be positive.');
  const pid = new PublicKey(programId);
  const userKey = new PublicKey(user);
  const tokenProgram = await mintTokenProgram(conn(), stakingMint);
  if (!tokenProgram) {
    throw new Error('Cannot determine the staking mint token program (RPC failure or the mint does not exist on this network).');
  }
  const a = deriveStakeAccounts(programId, user, stakingMint, tokenProgram);
  const tx = new Transaction();
  const positionInfo = await conn().getAccountInfo(a.userPosition);
  const needsPosition = positionInfo === null;
  if (needsPosition) {
    tx.add(new TransactionInstruction({
      programId: pid,
      keys: [
        { pubkey: a.userPosition, isSigner: false, isWritable: true },
        { pubkey: pda(programId, Buffer.from('debt'), userKey.toBuffer(), Buffer.from('SOL')), isSigner: false, isWritable: true },
        { pubkey: pda(programId, Buffer.from('debt'), userKey.toBuffer(), Buffer.from('NVDAX')), isSigner: false, isWritable: true },
        { pubkey: userKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc('global:open_position'),
    }));
  }
  tx.add(new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: a.globalState, isSigner: false, isWritable: true },
      { pubkey: a.userPosition, isSigner: false, isWritable: true },
      { pubkey: a.stakingMint, isSigner: false, isWritable: false },
      { pubkey: a.stakingVault, isSigner: false, isWritable: true },
      { pubkey: a.userAta, isSigner: false, isWritable: true },
      { pubkey: userKey, isSigner: true, isWritable: true },
      { pubkey: a.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(tokenProgram), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('global:stake'), u64le(amountRaw)]),
  }));
  return { transaction: tx, needsPosition, accounts: a };
}

/** unstake: returns the staked $TST from the vault PDA to the user's ATA
 *  (vault_auth PDA signs the payout CPI - no authority key involved). */
export async function buildUnstakeTransaction(
  programId: string,
  user: string,
  stakingMint: string,
  amountRaw: bigint,
): Promise<{ transaction: Transaction; accounts: StagingStakeAccounts }> {
  if (amountRaw <= 0n) throw new Error('Unstake amount must be positive.');
  const userKey = new PublicKey(user);
  const tokenProgram = await mintTokenProgram(conn(), stakingMint);
  if (!tokenProgram) {
    throw new Error('Cannot determine the staking mint token program.');
  }
  const a = deriveStakeAccounts(programId, user, stakingMint, tokenProgram);
  const tx = new Transaction();
  tx.add(new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: a.globalState, isSigner: false, isWritable: true },
      { pubkey: a.userPosition, isSigner: false, isWritable: true },
      { pubkey: a.stakingMint, isSigner: false, isWritable: false },
      { pubkey: a.stakingVault, isSigner: false, isWritable: true },
      { pubkey: a.userAta, isSigner: false, isWritable: true },
      { pubkey: userKey, isSigner: true, isWritable: true },
      { pubkey: a.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(tokenProgram), isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('global:unstake'), u64le(amountRaw)]),
  }));
  return { transaction: tx, accounts: a };
}
