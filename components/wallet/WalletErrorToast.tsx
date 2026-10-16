'use client';

import { useEffect, useRef, useState } from 'react';
import { WALLET_ERROR_EVENT } from '@/lib/wallet/errors';

const AUTO_DISMISS_MS = 8000;

/**
 * Renders real wallet-adapter connection errors (WalletNotReadyError,
 * WalletConnectionError, WalletTimeoutError, user rejection, ...).
 * Errors are dispatched by the WalletProvider onError handler as
 * `solflow:wallet-error` CustomEvents; only human-readable strings travel
 * through the event — never keys, seeds or other secrets.
 */
export function WalletErrorToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    function onWalletError(event: Event) {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string' && detail.length > 0) {
        setMessage(detail);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setMessage(null), AUTO_DISMISS_MS);
      }
    }
    window.addEventListener(WALLET_ERROR_EVENT, onWalletError);
    return () => {
      window.removeEventListener(WALLET_ERROR_EVENT, onWalletError);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!message) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:bottom-6"
    >
      <div className="panel max-w-md border-[rgba(255,120,84,0.45)] p-4 text-sm text-[var(--amber)] shadow-xl">
        <p className="font-semibold">{message}</p>
        <button
          type="button"
          className="mt-2 text-xs text-[var(--muted)] underline hover:opacity-80"
          onClick={() => setMessage(null)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
