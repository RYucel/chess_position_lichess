'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Swords } from 'lucide-react';
import { cn } from '@/lib/cn';
import { InstallButton, ProfileMenu } from '@/components/ProfileMenu';

const links = [
  { href: '/', label: 'Antrenman' },
  { href: '/stats', label: 'İstatistikler' },
  { href: '/#method', label: 'Yöntem' },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-2.5 rounded-lg focus-ring sm:gap-3">
          <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300">
            <Swords className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
          </span>
          <span className="hidden font-display text-[17px] font-semibold tracking-[-0.02em] text-stone-100 sm:inline">
            Candidate<span className="text-emerald-300">Master</span>
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-0.5 rounded-full border border-white/[0.07] bg-white/[0.025] p-0.5 sm:gap-1 sm:p-1">
          {links.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'rounded-full px-2.5 py-1.5 text-[11px] font-medium transition sm:px-3.5 sm:text-xs',
                  link.href === '/#method' && 'hidden sm:inline-flex',
                  active
                    ? 'bg-white/[0.09] text-stone-100 shadow-sm'
                    : 'text-stone-400 hover:text-stone-100',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5">
          <InstallButton />
          <ProfileMenu />
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-white/[0.07] px-3 py-1.5 text-[10px] font-medium tracking-wide text-stone-500 xl:flex">
          <Activity className="h-3 w-3 text-emerald-400" />
          Lichess verisi · Stockfish 19
        </div>
      </div>
    </header>
  );
}
