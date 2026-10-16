import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';
import { Navbar } from '@/components/layout/Navbar';
import { BottomNav } from '@/components/layout/BottomNav';
import { ModeBanner } from '@/components/layout/ModeBanner';

export const metadata: Metadata = {
  metadataBase: new URL('https://solflow-rose.vercel.app'),
  title: 'SOLFLOW — Creator Fees. Multi-Asset Rewards.',
  description:
    'SOLFLOW routes eligible creator-fee revenue into a transparent multi-reward system for Solana stakers. Stake into the flow. Earn SOL + NVDA.',
  icons: {
    icon: [
      { url: '/images/solflow-logo-32.png', type: 'image/png', sizes: '32x32' },
      { url: '/images/solflow-logo-16.png', type: 'image/png', sizes: '16x16' },
    ],
    shortcut: ['/images/solflow-logo-32.png'],
    apple: [{ url: '/images/solflow-logo-180.png' }],
  },
  openGraph: {
    title: 'SOLFLOW — Creator Fees. Multi-Asset Rewards.',
    description:
      'SOLFLOW routes eligible creator-fee revenue into a transparent multi-reward system for Solana stakers. Stake into the flow. Earn SOL + NVDA.',
    url: 'https://solflow-rose.vercel.app',
    siteName: 'SOLFLOW',
    images: [{ url: '/images/solflow-logo.png', width: 2048, height: 2132, alt: 'SOLFLOW logo' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SOLFLOW — Creator Fees. Multi-Asset Rewards.',
    description:
      'SOLFLOW routes eligible creator-fee revenue into a transparent multi-reward system for Solana stakers. Stake into the flow. Earn SOL + NVDA.',
    images: ['/images/solflow-logo.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#05060a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ModeBanner />
          <Navbar />
          <main className="min-h-[70vh] pb-24 md:pb-10">{children}</main>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
