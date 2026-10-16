// Solana RPC helpers. Live reads only - this module never fabricates data.

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { getEnv } from "@/config/env";

let cached: { url: string; conn: Connection } | null = null;

export function getConnection(): Connection {
  const env = getEnv();
  const url = env.rpcUrl || clusterApiUrl(env.network);
  if (!cached || cached.url !== url) {
    cached = { url, conn: new Connection(url, "confirmed") };
  }
  return cached.conn;
}

/** Native SOL balance in lamports. */
export async function getSolBalance(pubkey: PublicKey): Promise<number> {
  const conn = getConnection();
  return await conn.getBalance(pubkey);
}

export const LAMPORTS = 1_000_000_000;
