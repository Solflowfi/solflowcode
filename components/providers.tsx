'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { BackpackWalletAdapter } from '@solana/wallet-adapter-backpack';
import { clusterApiUrl } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';
import { getEnv } from '@/config/env';
import { WALLET_ERROR_EVENT, describeWalletError } from '@/lib/wallet/errors';
import { WalletErrorToast } from '@/components/wallet/WalletErrorToast';

export function Providers({ children }: { children: ReactNode }) {
  const env = getEnv();
  const endpoint = env.rpcUrl || clusterApiUrl(env.network);

  // Phantom + Solflare + Backpack. (Backpack also self-registers via the
  // Wallet Standard when the extension is installed; the explicit adapter
  // keeps it listed in the modal even before installation.)
  //
  // WALLET CONNECTION IS INDEPENDENT OF DEMO MODE: `env` is used ONLY for
  // the RPC endpoint. NEXT_PUBLIC_DEMO_MODE must never gate
  // WalletProvider/WalletModalProvider or adapter.connect() — demo mode
  // restricts simulated staking/rewards, never real wallet connections.
  // MetaMask is excluded from the Solana connection path via the shim in
  // shims/wallet-standard-wallet-adapter-react.ts (aliased in next.config.ts).
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter(), new BackpackWalletAdapter()],
    []
  );

  // autoConnect MUST be truthy: the stock WalletModal only calls select() on
  // click. With autoConnect={false} nothing ever invokes adapter.connect(),
  // so clicking Phantom/Solflare/Backpack silently does nothing (no popup,
  // no approval, no publicKey). With autoConnect on, selecting a wallet in
  // the modal triggers the real adapter.connect() -> wallet approval popup.
  // Surface real adapter errors instead of swallowing them (default behavior
  // is console.error only).
  const onWalletError = useCallback((error: unknown) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(WALLET_ERROR_EVENT, { detail: describeWalletError(error) }));
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={onWalletError}>
        <WalletModalProvider>
          {children}
          <WalletErrorToast />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

