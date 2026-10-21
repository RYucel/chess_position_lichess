import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'CandidateMaster — Aday hamle antrenörü',
  description:
    'Doğal satranç pozisyonlarında en güçlü iki adayı bul; hamle kaliteni centipawn kaybı ve Lichess doğruluk formülüyle ölç.',
  openGraph: {
    title: 'CandidateMaster',
    description:
      'Tuzak avı değil, konumsal karar antrenmanı. Lichess değerlendirmeleri ve tarayıcı içi Stockfish ile aday hamle kalitesi.',
    type: 'website',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body className="min-h-screen bg-ink-950 font-sans text-stone-100 antialiased">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(to_right,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:56px_56px] opacity-[0.28] [mask-image:radial-gradient(ellipse_at_top,black,transparent_78%)]"
        />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
