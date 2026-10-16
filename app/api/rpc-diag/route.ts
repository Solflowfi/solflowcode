import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { mainnetRpcUrl, resolveRpcUrl, serverRpcAt } from '@/lib/providers/alchemy';
import { getEnv } from '@/config/env';

export const dynamic = 'force-dynamic';

/** Well-known valid mainnet account (System Program) for a health check. */
const KNOWN_ADDRESS = '11111111111111111111111111111111';

interface Probe {
  provider: string;
  network: string;
  endpointHost: string | null;
  reachable: boolean;
  httpStatus: number | null;
  getBalanceOk: boolean;
  knownAccountOk: boolean;
  sanitizedError: string | null;
}

function host(u: string | null): string | null {
  try {
    return u ? new URL(u).host : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/rpc-diag?wallet=<optional pubkey>
 *
 * Safe RPC diagnostic: reports the provider, network, endpoint HOSTNAME ONLY
 * (never the URL or API key), reachability, HTTP status, getBalance results
 * for a known-good mainnet account and (optionally) the queried wallet, with
 * sanitized errors. Nothing here can leak key material.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = (searchParams.get('wallet') ?? '').trim();
  const env = getEnv();
  const probes: Probe[] = [];

  const targets: Array<{ provider: string; url: string | null }> = [
    { provider: 'alchemy-mainnet (mainnetRpcUrl)', url: mainnetRpcUrl() },
    { provider: 'alchemy-mainnet (resolveRpcUrl)', url: resolveRpcUrl() },
  ];

  for (const t of targets) {
    const probe: Probe = {
      provider: t.provider,
      network: env.network,
      endpointHost: host(t.url),
      reachable: false,
      httpStatus: null,
      getBalanceOk: false,
      knownAccountOk: false,
      sanitizedError: null,
    };
    if (!t.url) {
      probe.sanitizedError = 'endpoint not configured';
      probes.push(probe);
      continue;
    }
    try {
      // Known-good account health check.
      try {
        await serverRpcAt(t.url, 'getAccountInfo', [KNOWN_ADDRESS, { encoding: 'base64' }]);
        probe.knownAccountOk = true;
        probe.reachable = true;
        probe.httpStatus = 200;
      } catch (e) {
        probe.sanitizedError = 'known-account lookup failed: ' + String(e instanceof Error ? e.message : e).slice(0, 140);
        probe.httpStatus = String(e).includes('HTTP 403') ? 403 : null;
        probes.push(probe);
        continue;
      }
      // Balance health check.
      try {
        await serverRpcAt(t.url, 'getBalance', [KNOWN_ADDRESS]);
        probe.getBalanceOk = true;
      } catch (e) {
        probe.sanitizedError = 'getBalance(known) failed: ' + String(e instanceof Error ? e.message : e).slice(0, 140);
      }
      // Optional wallet-specific check.
      if (wallet) {
        try {
          const pk = new PublicKey(wallet);
          const r = await serverRpcAt<{ value: number }>(t.url, 'getBalance', [pk.toBase58()]);
          (probe as Probe & { walletBalanceLamports?: number }).walletBalanceLamports =
            typeof r?.value === 'number' ? r.value : 0;
        } catch (e) {
          probe.sanitizedError =
            (probe.sanitizedError ? probe.sanitizedError + ' | ' : '') +
            'getBalance(wallet) failed: ' + String(e instanceof Error ? e.message : e).slice(0, 140);
        }
      }
    } catch (e) {
      probe.sanitizedError = String(e instanceof Error ? e.message : e).slice(0, 160);
    }
    probes.push(probe);
  }

  // Browser-facing public endpoint reachability (the one that 403s in browsers).
  const publicHost = 'api.mainnet-beta.solana.com';
  let publicEndpoint: Record<string, unknown> = {
    provider: 'solana-public (api.mainnet-beta.solana.com)',
    endpointHost: publicHost,
    note: 'Used only as the browser wallet-adapter endpoint. This endpoint frequently rejects browser-originated JSON-RPC with HTTP 403 (provider abuse protection) — balance reads must use the server path instead.',
  };
  try {
    const res = await fetch('https://' + publicHost, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    publicEndpoint = { ...publicEndpoint, httpStatus: res.status, reachable: res.ok };
  } catch (e) {
    publicEndpoint = { ...publicEndpoint, reachable: false, sanitizedError: String(e instanceof Error ? e.message : e).slice(0, 140) };
  }

  return NextResponse.json({
    ok: true,
    network: env.network,
    demoMode: env.demoMode,
    probes,
    publicEndpoint,
    note: 'Endpoint URLs and API keys are intentionally omitted. Hostnames only.',
  });
}
