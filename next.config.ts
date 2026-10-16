import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // SOLFLOW wallet policy: route the Wallet-Standard adapter hook through a
  // shim that filters blocked wallets (MetaMask) out of the Solana
  // connection path. Applied to both bundlers so dev + build agree.
  turbopack: {
    resolveAlias: {
      // Relative path: Turbopack does not support absolute Windows paths here.
      '@solana/wallet-standard-wallet-adapter-react': './shims/wallet-standard-wallet-adapter-react.ts',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@solana/wallet-standard-wallet-adapter-react': path.resolve(
        './shims/wallet-standard-wallet-adapter-react.ts'
      ),
    };
    return config;
  },
};

export default nextConfig;
