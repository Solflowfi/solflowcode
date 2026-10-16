// Token registry. SOL is native; the NVDAx mint MUST be provided by the
// operator via NEXT_PUBLIC_NVDA_MINT — the app never invents a mint address.

import { getEnv } from "./env";

export interface TokenConfig {
  symbol: string;
  name: string;
  mint: string | null;
  decimals: number;
  enabled: boolean;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Centralized token brand assets. Single source of truth for every token
 * icon rendered anywhere in SOLFLOW — components must never inline their
 * own gradient/placeholder artwork for a real token identity.
 *
 * - SOL:   official Solana mark (three-bar logo, official gradient).
 * - NVDAx: verified "NVIDIA xStock" logo served by the token issuer's
 *          metadata CDN (xstocks-metadata.backed.fi) for the exact mint
 *          configured via NEXT_PUBLIC_NVDA_MINT (source: Jupiter verified
 *          token metadata for that mint).
 * - FLOW:  no verified asset exists yet — deliberately no logo (neutral
 *          fallback only; never a placeholder that could be mistaken for
 *          a real token brand).
 */
export const TOKEN_ASSETS: Record<string, { logo: string; logoAlt: string }> = {
  SOL: { logo: "/images/sol-logo.svg", logoAlt: "SOL logo" },
  NVDAX: { logo: "/images/nvdax-logo.png", logoAlt: "NVDAx logo" },
};

export function getTokenAsset(symbol: string): { logo: string; logoAlt: string } | null {
  return TOKEN_ASSETS[symbol.toUpperCase()] ?? null;
}


export function getRewardTokens(): TokenConfig[] {
  const env = getEnv();
  return [
    {
      symbol: "SOL",
      name: "Solana",
      mint: SOL_MINT,
      decimals: 9,
      enabled: true,
    },
    {
      symbol: "NVDAx",
      name: "NVDAx Token",
      mint: env.nvdaMint,
      // Display default; the live path reads decimals from the on-chain mint.
      decimals: 6,
      enabled: env.nvdaMint !== null && env.nvdaMint.length > 0,
    },
  ];
}

export function getTokenBySymbol(symbol: string): TokenConfig | null {
  return getRewardTokens().find((t) => t.symbol === symbol.toUpperCase()) ?? null;
}