'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Home', icon: '⌂' },
  { href: '/earn', label: 'Earn', icon: '↑' },
  { href: '/rewards', label: 'Rewards', icon: '◆' },
  { href: '/activity', label: 'Activity', icon: '≡' },
  { href: '/app', label: 'Wallet', icon: '●' },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[rgba(5,6,10,0.95)] backdrop-blur-md md:hidden">
      <div className="grid grid-cols-5">
        {ITEMS.map((item) => (
          <Link
            key={item.href + item.label}
            href={item.href}
            className={`flex flex-col items-center gap-1 py-2 text-[10px] font-semibold no-underline ${
              pathname === item.href ? 'text-[var(--green)]' : 'text-[var(--muted)]'
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
