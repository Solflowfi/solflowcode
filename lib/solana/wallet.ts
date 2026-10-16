// Wallet helpers. Private keys NEVER pass through this module — wallets sign
// locally; the app only reads public keys and submits signed transactions.

import type { PublicKey } from '@solana/web3.js';

export function walletAddress(pubkey: PublicKey | null): string | null {
  return pubkey ? pubkey.toBase58() : null;
}
