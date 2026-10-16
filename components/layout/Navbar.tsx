'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { shortAddress, solscanAccount } from '@/lib/format';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/app', label: 'Earn' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/fees', label: 'Fees' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/security', label: 'Security' },
];

export function Navbar() {
  const pathname = usePathname();
  const { setVisible } = useWalletModal();
  const { publicKey, connected, disconnect } = useWallet();
  const { connection } = useConnection();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  const addr = publicKey ? publicKey.toBase58() : null;

  async function handleCopy() {
    if (addr) await navigator.clipboard.writeText(addr);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[rgba(5,6,10,0.82)] backdrop-blur-md">
      <div className="container-page flex h-16 items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 no-underline">
            {/* Official SOLFLOW logo (approved artwork): public/images/solflow-logo.png */}
            <Image src="/images/solflow-logo-icon.png" alt="SOLFLOW logo" width={28} height={28} className="h-7 w-7" priority />
            <span className="display text-lg tracking-tight text-[var(--text)]">SOLFLOW</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-2 rounded-lg text-sm font-semibold no-underline transition-colors ${
                  pathname === l.href ? 'text-[var(--green)] bg-[rgba(20,241,149,0.08)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline badge">{connection.rpcEndpoint.includes('devnet') ? 'DEVNET' : 'MAINNET'}</span>
          {connected && addr ? (
            <div className="relative">
              <button className="btn btn-secondary btn-sm" onClick={() => setDropOpen((v) => !v)}>
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--green)] pulse-dot" />
                {shortAddress(addr)}
              </button>
              {dropOpen && (
                <div className="pop-in absolute right-0 mt-2 w-52 panel p-2 z-50">
                  <button className="w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--text)] hover:bg-white/5" onClick={() => { void handleCopy(); setDropOpen(false); }}>
                    Copy Address
                  </button>
                  <a className="block px-3 py-2 rounded-lg text-sm text-[var(--text)] hover:bg-white/5" href={solscanAccount(addr)} target="_blank" rel="noreferrer">
                    View on Solscan ↗
                  </a>
                  <button
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--red)] hover:bg-white/5"
                    onClick={() => {
                      void disconnect();
                      setDropOpen(false);
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setVisible(true)}>
              Connect Wallet
            </button>
          )}
          <button className="md:hidden btn btn-ghost btn-sm" onClick={() => setMenuOpen((v) => !v)} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[rgba(5,6,10,0.97)]">
          <div className="container-page py-3 flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="px-3 py-2 rounded-lg text-sm font-semibold text-[var(--muted)] no-underline" onClick={() => setMenuOpen(false)}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
