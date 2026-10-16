// Alchemy Solana provider. SERVER-SIDE ONLY.
//
// SOLFLOW uses Alchemy as its Solana infrastructure provider. The API key
// lives in ALCHEMY_API_KEY and is never sent to the browser and never
// returned by any helper in this module. All helpers speak standard Solana
// JSON-RPC so the rest of SOLFLOW depends on this interface, not on
// Alchemy-specific implementation details.
//
// Endpoints (Alchemy):
//   Mainnet: https://solana-mainnet.g.alchemy.com/v2/<API_KEY>
//   Devnet:  https://solana-devnet.g.alchemy.com/v2/<API_KEY>
//   WS:      wss://solana-mainnet.g.alchemy.com/v2/<API_KEY>

function apiKey(): string | null {
  const k = process.env.ALCHEMY_API_KEY;
  return k && k.length > 0 ? k : null;
}

export function alchemyConfigured(): boolean {
  return apiKey() !== null;
}

/** Explicit RPC override (ALCHEMY_SOLANA_RPC_URL) if the operator set one. */
function customRpcUrl(): string | null {
  const u = process.env.ALCHEMY_SOLANA_RPC_URL;
  return u && u.length > 0 ? u : null;
}

/**
 * Resolve the server-side RPC endpoint. Order:
 *   1. Network-aware Alchemy endpoint for the configured network (devnet/testnet
 *      ALWAYS resolve to their own endpoint — a devnet address validated
 *      against a mainnet RPC would report a misleading "does not exist").
 *   2. mainnet-beta: ALCHEMY_SOLANA_RPC_URL override if set, else the Alchemy
 *      mainnet endpoint.
 * Returns null when neither is configured (caller reports NOT CONFIGURED).
 * The resolved URL contains the API key - never log or return it.
 */
export function resolveRpcUrl(): string | null {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  const key = apiKey();
  if (network !== 'mainnet-beta') {
    if (!key) return null;
    if (network === 'testnet') return 'https://solana-testnet.g.alchemy.com/v2/' + key;
    return 'https://solana-devnet.g.alchemy.com/v2/' + key;
  }
  const custom = customRpcUrl();
  if (custom) return custom;
  if (!key) return null;
  return 'https://solana-mainnet.g.alchemy.com/v2/' + key;
}

/** WebSocket endpoint for real-time monitoring (logs, programSubscribe). */
export function alchemyWsUrl(): string | null {
  const u = process.env.ALCHEMY_SOLANA_WS_URL;
  if (u && u.length > 0) return u;
  const key = apiKey();
  if (!key) return null;
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
  if (network === 'mainnet-beta') return 'wss://solana-mainnet.g.alchemy.com/v2/' + key;
  return 'wss://solana-devnet.g.alchemy.com/v2/' + key;
}

// ---------- standard Solana JSON-RPC over Alchemy ----------

/** Raw JSON-RPC call. Throws on transport or RPC error. */
export async function serverRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const url = resolveRpcUrl();
  if (!url) throw new Error('Alchemy not configured (ALCHEMY_API_KEY / ALCHEMY_SOLANA_RPC_URL missing).');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error('RPC ' + method + ' failed: HTTP ' + res.status);
  const json = (await res.json()) as { error?: { message?: string }; result?: T };
  if (json.error) throw new Error('RPC ' + method + ' error: ' + (json.error.message ?? 'unknown'));
  return json.result as T;
}

/** Current slot — used by infrastructure validation. */
export async function serverGetSlot(): Promise<number | null> {
  try {
    const slot = await serverRpc<number>('getSlot', []);
    return typeof slot === 'number' ? slot : null;
  } catch {
    return null;
  }
}

/** SOL balance in lamports. */
export async function serverGetBalance(address: string): Promise<number | null> {
  try {
    const r = await serverRpc<{ value?: number }>('getBalance', [address]);
    return r.value ?? null;
  } catch {
    return null;
  }
}

export interface TokenBalanceResult {
  amount: string;
  decimals: number | null;
  uiAmount: number | null;
}

/** SPL token balance for owner + mint via getTokenAccountsByOwner. */
export async function serverGetTokenBalance(owner: string, mint: string): Promise<TokenBalanceResult | null> {
  try {
    const r = await serverRpc<{ value?: Array<{ amount?: string; decimals?: number; uiAmount?: number | null }> }>(
      'getTokenAccountsByOwner',
      [owner, { mint }, { encoding: 'jsonParsed' }]
    );
    const accounts = r.value ?? [];
    if (accounts.length === 0) return null;
    const info = accounts[0];
    return { amount: info.amount ?? '0', decimals: info.decimals ?? null, uiAmount: info.uiAmount ?? null };
  } catch {
    return null;
  }
}

/** Single token account balance via getTokenAccountBalance. */
export async function serverGetTokenAccountBalance(account: string): Promise<TokenBalanceResult | null> {
  try {
    const r = await serverRpc<{ value?: { amount?: string; decimals?: number; uiAmount?: number | null } }>(
      'getTokenAccountBalance',
      [account]
    );
    const v = r.value;
    if (!v) return null;
    return { amount: v.amount ?? '0', decimals: v.decimals ?? null, uiAmount: v.uiAmount ?? null };
  } catch {
    return null;
  }
}

/** Token total supply via getTokenSupply. */
export async function serverGetTokenSupply(mint: string): Promise<TokenBalanceResult | null> {
  try {
    const r = await serverRpc<{ value?: { amount?: string; decimals?: number; uiAmount?: number | null } }>(
      'getTokenSupply',
      [mint]
    );
    const v = r.value;
    if (!v) return null;
    return { amount: v.amount ?? '0', decimals: v.decimals ?? null, uiAmount: v.uiAmount ?? null };
  } catch {
    return null;
  }
}

/** Account existence + owner program + lamports via getAccountInfo. */
export async function serverGetAccount(address: string): Promise<{ exists: boolean; owner: string | null; lamports: number | null } | null> {
  try {
    const r = await serverRpc<{ value?: { owner?: string; lamports?: number } | null }>('getAccountInfo', [address, { encoding: 'base64' }]);
    const v = r.value;
    if (!v) return { exists: false, owner: null, lamports: null };
    return { exists: true, owner: v.owner ?? null, lamports: v.lamports ?? null };
  } catch {
    return null;
  }
}

/** Program account query via getProgramAccounts. */
export async function serverGetProgramAccounts(
  programId: string,
  filters?: unknown[]
): Promise<Array<{ pubkey: string; account: { owner: string; lamports: number } }> | null> {
  try {
    const r = await serverRpc<Array<{ pubkey: string; account: { owner: string; lamports: number } }>>('getProgramAccounts', [
      programId,
      { encoding: 'base64', ...(filters && filters.length > 0 ? { filters } : {}) },
    ]);
    return Array.isArray(r) ? r : [];
  } catch {
    return null;
  }
}

/** Address activity via getSignaturesForAddress. */
export async function serverGetSignatures(address: string, limit = 20): Promise<Array<{ signature: string; slot: number; err: unknown }>> {
  try {
    const r = await serverRpc<Array<{ signature: { signature: string; slot: number; err: unknown } }>>('getSignaturesForAddress', [address, { limit }]);
    return (r ?? []).map((s) => ({ signature: s.signature.signature, slot: s.signature.slot, err: s.signature.err }));
  } catch {
    return [];
  }
}

/** Full transaction via getTransaction (standard Solana RPC, works over Alchemy). */
export async function serverGetTransaction(signature: string): Promise<{
  slot: number | null;
  err: unknown;
  accountKeys: string[];
  meta: {
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: Array<Record<string, unknown>>;
    postTokenBalances: Array<Record<string, unknown>>;
  } | null;
  blockTime: number | null;
} | null> {
  try {
    const r = await serverRpc<{
      slot?: number;
      transaction?: { message?: { accountKeys?: Array<{ pubkey?: string } | string> } };
      meta?: {
        err: unknown;
        preBalances: number[];
        postBalances: number[];
        preTokenBalances: Array<Record<string, unknown>>;
        postTokenBalances: Array<Record<string, unknown>>;
      } | null;
      blockTime?: number | null;
    } | null>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    if (!r) return null;
    const keys = (r.transaction?.message?.accountKeys ?? [])
      .map((k) => (typeof k === 'string' ? k : k.pubkey ?? null))
      .filter((k): k is string => typeof k === 'string');
    return {
      slot: r.slot ?? null,
      err: r.meta?.err ?? null,
      accountKeys: keys,
      meta: r.meta
        ? {
            preBalances: r.meta.preBalances ?? [],
            postBalances: r.meta.postBalances ?? [],
            preTokenBalances: r.meta.preTokenBalances ?? [],
            postTokenBalances: r.meta.postTokenBalances ?? [],
          }
        : null,
      blockTime: r.blockTime ?? null,
    };
  } catch {
    return null;
  }
}

/** Mint validity: account exists and is owned by an SPL Token program. */
export async function serverValidateMint(mint: string): Promise<boolean> {
  const info = await serverGetAccount(mint);
  if (!info || !info.exists) return false;
  return (
    info.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
    info.owner === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
  );
}

/** Program validity: account exists and is executable (a deployed program). */
export async function serverValidateProgram(programId: string): Promise<boolean> {
  const info = await serverGetAccount(programId);
  return info !== null && info.exists && info.owner === 'BPFLoaderUpgradeab1e11111111111111111111111';
}

// ---------- MAINNET-targeted helpers (Security tab) ----------

/**
 * Explicit MAINNET JSON-RPC URL. Security checks must reflect mainnet state
 * regardless of the app's configured network, so this always resolves to the
 * Alchemy mainnet endpoint (the ALCHEMY_SOLANA_RPC_URL override is honoured
 * only when the configured network itself is mainnet, so a devnet override
 * can never masquerade as mainnet). Returns null when unavailable. The URL
 * contains the API key — never log or return it.
 */
export function mainnetRpcUrl(): string | null {
  const key = apiKey();
  if (!key) return null;
  const custom = process.env.ALCHEMY_SOLANA_RPC_URL;
  if (custom && custom.length > 0 && process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta') {
    return custom;
  }
  return 'https://solana-mainnet.g.alchemy.com/v2/' + key;
}

/** JSON-RPC against an explicit endpoint. Throws on transport or RPC error. */
export async function serverRpcAt<T = unknown>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error('RPC ' + method + ' failed: HTTP ' + res.status);
  const json = (await res.json()) as { error?: { message?: string }; result?: T };
  if (json.error) throw new Error('RPC ' + method + ' error: ' + (json.error.message ?? 'unknown'));
  return json.result as T;
}

export interface RawAccount {
  exists: boolean;
  owner: string;
  lamports: number;
  /** base64-encoded account data ('' when the account does not exist). */
  data: string;
  executable: boolean;
}

/** getAccountInfo returning raw base64 data (for program/authority parsing). */
export async function serverGetAccountRawMainnet(address: string): Promise<RawAccount | null> {
  const url = mainnetRpcUrl();
  if (!url) return null;
  const r = await serverRpcAt<{ value: { owner: string; lamports: number; data: [string, string]; executable: boolean } | null }>(
    url,
    'getAccountInfo',
    [address, { encoding: 'base64' }],
  );
  if (!r.value) return null;
  return {
    exists: true,
    owner: r.value.owner,
    lamports: r.value.lamports,
    data: Array.isArray(r.value.data) ? r.value.data[0] : '',
    executable: r.value.executable,
  };
}
