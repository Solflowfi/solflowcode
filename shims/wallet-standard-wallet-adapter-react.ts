// SOLFLOW shim for '@solana/wallet-standard-wallet-adapter-react'.
/* eslint-disable react-hooks/refs -- helper functions are copied verbatim from
   @solana/wallet-standard-wallet-adapter-react; ref access in useConstant/usePrevious
   is upstream behavior and must not diverge. */
//
// Next.js resolves this file INSTEAD of the original package via
// next.config.ts resolve aliases (Turbopack + webpack). Purpose:
// exclude wallets that must not be used as the Solana connection path
// (e.g. MetaMask, which registers itself as a Solana Wallet-Standard
// wallet from its browser extension). Everything else behaves exactly
// like the upstream hook.
//
// Wallets listed here are filtered BEFORE they reach WalletProvider, so
// they never appear in the wallet picker and can never be selected.

import type { Adapter, WalletName } from '@solana/wallet-adapter-base';
import { isWalletAdapterCompatibleWallet, StandardWalletAdapter } from '@solana/wallet-standard-wallet-adapter-base';
import { DEPRECATED_getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Wallets blocked from the Solana connection path (case-insensitive). */
const BLOCKED_WALLET_PATTERNS: RegExp[] = [/^metamask$/i];

function isBlockedWalletName(name: string): boolean {
    return BLOCKED_WALLET_PATTERNS.some((pattern) => pattern.test(name));
}

export function useStandardWalletAdapters(adapters: Adapter[]): Adapter[] {
    const warnings = useConstant(() => new Set<WalletName>());
    const { get, on } = useConstant(() => DEPRECATED_getWallets());
    const [standardAdapters, setStandardAdapters] = useState(() => wrapWalletsWithAdapters(get()));

    useEffect(() => {
        const listeners = [
            on('register', (...wallets) =>
                setStandardAdapters((standardAdapters) => [...standardAdapters, ...wrapWalletsWithAdapters(wallets)])
            ),
            on('unregister', (...wallets) =>
                setStandardAdapters((standardAdapters) =>
                    standardAdapters.filter((standardAdapter) => !wallets.includes(standardAdapter.wallet))
                )
            ),
        ];
        return () => listeners.forEach((off) => off());
    }, [on]);

    const prevStandardAdapters = usePrevious(standardAdapters);
    useEffect(() => {
        if (!prevStandardAdapters) return;

        const currentAdapters = new Set(standardAdapters);
        const removedAdapters = new Set(
            prevStandardAdapters.filter((previousAdapter) => !currentAdapters.has(previousAdapter))
        );
        removedAdapters.forEach((adapter) => adapter.destroy());
    }, [prevStandardAdapters, standardAdapters]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => () => standardAdapters.forEach((adapter) => adapter.destroy()), []);

    return useMemo(
        () => [
            ...standardAdapters,
            ...adapters.filter(({ name }) => {
                if (standardAdapters.some((standardAdapter) => standardAdapter.name === name)) {
                    if (!warnings.has(name)) {
                        warnings.add(name);
                        console.warn(
                            `${name} was registered as a Standard Wallet. The Wallet Adapter for ${name} can be removed from your app.`
                        );
                    }
                    return false;
                }
                return true;
            }),
        ],
        [standardAdapters, adapters, warnings]
    );
}

function useConstant<T>(fn: () => T): T {
    const ref = useRef<{ value: T }>(undefined);
    if (ref.current === undefined) {
        ref.current = { value: fn() };
    }
    return ref.current.value;
}

function usePrevious<T>(state: T): T | undefined {
    const ref = useRef<T>(state);
    useEffect(() => {
        ref.current = state;
    });
    return ref.current;
}

function wrapWalletsWithAdapters(wallets: readonly Wallet[]): readonly StandardWalletAdapter[] {
    return wallets
        .filter(isWalletAdapterCompatibleWallet)
        .filter((wallet) => !isBlockedWalletName(wallet.name))
        .map((wallet) => new StandardWalletAdapter({ wallet }));
}
