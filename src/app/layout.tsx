import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import { ClientBootstrap } from '@/components/ClientBootstrap';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  applicationName: 'CandidateMaster',
  title: 'CandidateMaster — Aday hamle antrenörü',
  description:
    'Doğal satranç pozisyonlarında en güçlü iki adayı bul; hamle kaliteni centipawn kaybı ve Lichess doğruluk formülüyle ölç.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black',
    title: 'CandidateMaster',
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'CandidateMaster',
    description:
      'Tuzak avı değil, konumsal karar antrenmanı. Lichess değerlendirmeleri ve tarayıcı içi Stockfish ile aday hamle kalitesi.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#080a09',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-ink-950 font-sans text-stone-100 antialiased">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.28] [mask-image:radial-gradient(ellipse_at_top,black,transparent_78%)]"
        />
        <ClientBootstrap />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
