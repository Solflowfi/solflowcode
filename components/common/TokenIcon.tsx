'use client';

import { useState } from 'react';
import Image from 'next/image';
import { getTokenAsset } from '@/config/tokens';

const FALLBACK_STYLE: React.CSSProperties = {
  background: 'rgba(148, 163, 184, 0.10)',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  color: 'rgba(226, 232, 240, 0.65)',
};

/**
 * Consistent token logo renderer for every token identity in SOLFLOW.
 * - Real logo rendered with object-contain (centered, aspect preserved,
 *   never stretched or cropped), sharp at any size (source assets are
 *   vector/PNG >= 96px).
 * - On load failure (or when no verified asset exists for a symbol) it
 *   falls back to a NEUTRAL monogram block — never the old misleading
 *   token-colored gradient placeholder.
 * - The icon box is the single shared container style across SOLFLOW.
 */
export function TokenIcon({
  symbol,
  size = 36,
  decorative = false,
  className = '',
}: {
  symbol: string;
  /** Rendered box size in px (square). Defaults to the 36px (h-9 w-9) card icon. */
  size?: number;
  /** Repeated/decorative instances set this to keep alt text out of the a11y tree. */
  decorative?: boolean;
  className?: string;
}) {
  const asset = getTokenAsset(symbol);
  const [failed, setFailed] = useState(false);
  const monogram = symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '·';
  const box = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${className}`;
  const boxStyle: React.CSSProperties = { width: size, height: size, ...FALLBACK_STYLE };

  if (!asset || failed) {
    return (
      <span
        className={box}
        style={boxStyle}
        aria-hidden={decorative || undefined}
        {...(!decorative && { role: 'img', 'aria-label': `${symbol} icon` })}
      >
        <span className="text-[11px] font-bold tracking-wide">{monogram}</span>
      </span>
    );
  }

  return (
    <span
      className={box}
      style={{ width: size, height: size, background: 'rgba(148, 163, 184, 0.06)' }}
    >
      <Image
        src={asset.logo}
        alt={decorative ? '' : asset.logoAlt}
        aria-hidden={decorative || undefined}
        width={96}
        height={96}
        onError={() => setFailed(true)}
        className="h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}
