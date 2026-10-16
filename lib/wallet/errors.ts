// SOLFLOW wallet error surfacing.
// Real wallet-adapter errors must never be swallowed silently: WalletProvider
// dispatches this DOM event and <WalletErrorToast/> renders the message.

export const WALLET_ERROR_EVENT = 'solflow:wallet-error';

/** Human-readable, secret-free description of a wallet-adapter error. */
export function describeWalletError(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case 'WalletNotReadyError':
        return 'Wallet not ready. Unlock (or install) Phantom/Solflare/Backpack, then try again.';
      case 'WalletTimeoutError':
        return 'Wallet connection timed out. Please try again.';
      case 'WalletDisconnectionError':
        return `Wallet disconnect failed: ${error.message}`;
      case 'WalletNotConnectedError':
        return 'Wallet is not connected. Connect it first.';
      case 'WalletNotSelectedError':
        return 'No wallet selected. Pick Phantom, Solflare or Backpack.';
      default:
        break;
    }
    if (/reject|denied|declined/i.test(error.message)) {
      return 'Connection request was rejected in the wallet. Approve it and try again.';
    }
    return `Wallet connection failed: ${error.message}`;
  }
  return 'Wallet connection failed. Please try again.';
}
