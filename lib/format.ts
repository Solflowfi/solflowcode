// Formatting helpers. All blockchain amounts are handled in raw units (big ints
// as strings) and converted to UI decimals only at the presentation boundary.

export function formatTokenAmount(
  value: number | string | null | undefined,
  decimals = 4,
  opts?: { compact?: boolean; placeholder?: string }
): string {
  const placeholder = opts?.placeholder ?? "—";
  if (value === null || value === undefined || value === "") return placeholder;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return placeholder;
  if (opts?.compact) {
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 10_000) return (n / 1e3).toFixed(1) + "K";
  }
  return n.toLocaleString("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "$—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  });
}

export function shortAddress(addr: string | null | undefined, chars = 4): string {
  if (!addr) return "—";
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

export function shortSig(sig: string | null | undefined): string {
  if (!sig) return "—";
  return `${sig.slice(0, 8)}…${sig.slice(-8)}`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Math.floor(Date.now() / 1000 - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

import { getEnv } from "@/config/env";

export function solscanAccount(address: string | null | undefined): string {
  if (!address) return "#";
  return `https://solscan.io/account/${address}${clusterQuery()}`;
}

export function solscanTx(signature: string | null | undefined): string {
  if (!signature) return "#";
  return `https://solscan.io/tx/${signature}${clusterQuery()}`;
}

function clusterQuery(): string {
  const network = getEnv().network;
  return network === "mainnet-beta" ? "" : `?cluster=${network}`;
}
