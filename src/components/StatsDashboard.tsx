'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Gauge,
  Layers,
  Target,
  Trash2,
  TrendingDown,
  Trophy,
} from 'lucide-react';
import { CLASSIFICATION_META, PHASE_LABELS, mean, top2HitRate } from '@/lib/accuracy';
import { cn } from '@/lib/cn';
import { pointsForAttempt, summarizeProgress } from '@/lib/scoring';
import { clearAttempts, loadAttempts, type AttemptRecord } from '@/lib/storage';
import type { Classification } from '@/lib/types';

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function KpiCard({
  label,
  value,
  suffix,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  suffix?: string;
  detail: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-display text-3xl font-semibold tracking-tight text-stone-50">{value}</span>
        {suffix && <span className="text-sm text-stone-500">{suffix}</span>}
      </div>
      <p className="mt-1 text-[10px] leading-4 text-stone-500">{detail}</p>
    </div>
  );
}

function AccuracyTrend({ attempts }: { attempts: AttemptRecord[] }) {
  const values = [...attempts]
    .slice(0, 22)
    .reverse()
    .map((attempt) => Math.max(0, Math.min(100, attempt.accuracy)));
  const width = 620;
  const height = 168;
  const padX = 12;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const x = (index: number) => padX + (values.length <= 1 ? innerW / 2 : (index / (values.length - 1)) * innerW);
  const y = (value: number) => padY + innerH - (value / 100) * innerH;
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const area = values.length
    ? `M ${x(0)} ${padY + innerH} L ${values.map((value, index) => `${x(index)} ${y(value)}`).join(' L ')} L ${x(values.length - 1)} ${padY + innerH} Z`
    : '';

  return (
    <div className="panel p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="eyebrow">Doğruluk trendi</div>
          <h3 className="mt-1 font-display text-lg font-semibold text-stone-100">Son turlar</h3>
        </div>
        <span className="chip">
          <Activity className="h-3 w-3 text-emerald-300" />
          {values.length} tur
        </span>
      </div>

      {values.length < 2 ? (
        <div className="mt-4 flex h-[168px] items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-xs text-stone-600">
          Eğri için en az iki tur gerekiyor.
        </div>
      ) : (
        <div className="mt-3 overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-[168px] w-full" role="img" aria-label="Doğruluk trend grafiği">
            <defs>
              <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 25, 50, 75, 100].map((tick) => (
              <g key={tick}>
                <line
                  x1={padX}
                  x2={width - padX}
                  y1={y(tick)}
                  y2={y(tick)}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                <text
                  x={padX}
                  y={y(tick) - 4}
                  fill="rgba(255,255,255,0.28)"
                  fontSize="8"
                  fontFamily="monospace"
                >
                  {tick}
                </text>
              </g>
            ))}
            {area && <path d={area} fill="url(#trendArea)" />}
            <polyline
              points={points}
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {values.map((value, index) => (
              <circle
                key={index}
                cx={x(index)}
                cy={y(value)}
                r={index === values.length - 1 ? 4 : 2.4}
                fill={index === values.length - 1 ? '#6ee7b7' : '#0c0f0d'}
                stroke="#34d399"
                strokeWidth="1.5"
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

export function StatsDashboard() {
  const [attempts, setAttempts] = useState<AttemptRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setAttempts(loadAttempts());
      setHydrated(true);
    };
    refresh();
    window.addEventListener('candidate-master:attempts-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('candidate-master:attempts-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const progress = useMemo(() => summarizeProgress(attempts), [attempts]);

  const stats = useMemo(() => {
    const accuracy = mean(attempts.map((attempt) => attempt.accuracy));
    const cpl = mean(attempts.map((attempt) => attempt.cpl));
    const hitRate = top2HitRate(attempts);
    const best = attempts.reduce<AttemptRecord | null>(
      (current, attempt) => (!current || attempt.accuracy > current.accuracy ? attempt : current),
      null,
    );
    const distribution = (Object.keys(CLASSIFICATION_META) as Classification[]).map(
      (classification) => ({
        classification,
        count: attempts.filter((attempt) => attempt.classification === classification).length,
      }),
    );
    return { accuracy, cpl, hitRate, best, distribution };
  }, [attempts]);

  if (!hydrated) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="h-8 w-48 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-4 h-4 w-96 max-w-full animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-2xl bg-white/[0.035]" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow flex items-center gap-2">
            <span className="h-px w-7 bg-emerald-400/60" />
            İlerleme
          </div>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.03em] text-stone-50">
            Sayıların anlattığı hikâye.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-stone-400">
            Top-2 isabetin, ortalama centipawn kaybın, evre bazlı puanların ve seviye
            ilerlemen. Tüm veriler yalnızca bu tarayıcıda saklanır.
          </p>
        </div>
        <Link href="/" className="btn-secondary w-fit text-xs">
          <ArrowLeft className="h-3.5 w-3.5" /> Antrenmana dön
        </Link>
      </div>

      {attempts.length === 0 ? (
        <div className="panel mt-8 flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300">
            <BarChart3 className="h-6 w-6" />
          </span>
          <h2 className="mt-4 font-display text-xl font-semibold text-stone-100">
            Henüz ölçülecek bir tur yok.
          </h2>
          <p className="mt-2 max-w-md text-xs leading-6 text-stone-500">
            İlk pozisyonunu aç, iki aday seç ve karşılaştır. Sonuç bu sayfada doğruluk,
            CPL, Top-2 isabeti ve zorluk ağırlıklı puan olarak birikecek.
          </p>
          <Link href="/" className="btn-primary mt-5 text-xs">
            İlk turu başlat
          </Link>
        </div>
      ) : (
        <div className="mt-7 space-y-4">
          <section className="panel p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/[0.08] text-amber-300">
                  <Trophy className="h-5 w-5" />
                </span>
                <div>
                  <div className="eyebrow">Gelişim</div>
                  <h2 className="mt-0.5 font-display text-xl font-semibold text-stone-50">
                    Seviye {progress.level.level}
                  </h2>
                  <p className="mt-0.5 text-[10px] text-stone-500">
                    {progress.points} puan · sonraki seviyeye {progress.level.toNext} puan
                  </p>
                </div>
              </div>
              <div className="w-full sm:w-64">
                <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-stone-600">
                  <span>Seviye {progress.level.level}</span>
                  <span>{Math.round(progress.level.progress * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
                    style={{ width: `${progress.level.progress * 100}%` }}
                  />
                </div>
                <div className="mt-1 text-right font-mono text-[9px] text-stone-600">
                  {progress.level.start} → {progress.level.next}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {progress.byPhase.map((item) => (
                <div
                  key={item.phase}
                  className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-stone-200">
                      {PHASE_LABELS[item.phase]}
                    </span>
                    <span className="font-mono text-[9px] text-stone-500">
                      Sv. {item.level.level}
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="font-display text-lg font-semibold text-stone-50">
                      {item.points}
                    </span>
                    <span className="font-mono text-[9px] text-stone-600">puan</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                      style={{ width: `${item.level.progress * 100}%` }}
                    />
                  </div>
                  <div className="mt-1.5 font-mono text-[8.5px] text-stone-600">
                    {item.attempts} tur · {item.accuracy.toFixed(1)}% doğruluk
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Çözülen tur"
              value={String(attempts.length)}
              detail={`${attempts.filter((attempt) => attempt.mode === 'dual').length} çift aday · ${attempts.filter((attempt) => attempt.mode === 'single').length} tek hamle`}
              icon={Layers}
              tone="border-sky-400/20 bg-sky-400/[0.06] text-sky-300"
            />
            <KpiCard
              label="Ortalama doğruluk"
              value={stats.accuracy.toFixed(1)}
              suffix="%"
              detail="Lichess Win% kaybından türetilmiş hamle doğruluğu"
              icon={Target}
              tone="border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
            />
            <KpiCard
              label="Ortalama CPL"
              value={Math.round(stats.cpl).toString()}
              suffix="cp"
              detail="Seçilen adayların PV1'e göre ortalama kaybı"
              icon={TrendingDown}
              tone="border-orange-400/20 bg-orange-400/[0.06] text-orange-300"
            />
            <KpiCard
              label="Top-2 isabet"
              value={stats.hitRate.toFixed(0)}
              suffix="%"
              detail="Sırasız Top-2 kümesini tam yakalama oranı"
              icon={Trophy}
              tone="border-violet-400/20 bg-violet-400/[0.06] text-violet-300"
            />
          </section>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <AccuracyTrend attempts={attempts} />

            <div className="panel p-4 sm:p-5">
              <div className="eyebrow">Baskın sonuç</div>
              <h3 className="mt-1 font-display text-lg font-semibold text-stone-100">
                Hamle sınıfları
              </h3>
              <div className="mt-4 space-y-2.5">
                {stats.distribution.map((item) => {
                  const meta = CLASSIFICATION_META[item.classification];
                  const width = attempts.length ? (item.count / attempts.length) * 100 : 0;
                  return (
                    <div key={item.classification}>
                      <div className="mb-1 flex items-center justify-between text-[10px]">
                        <span className="inline-flex items-center gap-1.5 text-stone-400">
                          <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                          {meta.short}
                        </span>
                        <span className="font-mono text-stone-600">{item.count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className={cn('h-full rounded-full', meta.dot)}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {stats.best && (
                <div className="mt-5 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
                  <div className="eyebrow">En iyi tur</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="font-display text-sm font-semibold text-stone-100">
                      {stats.best.accuracy.toFixed(1)}% doğruluk
                    </span>
                    <span className="font-mono text-[9px] text-stone-500">
                      {Math.round(stats.best.cpl)} cp · +{pointsForAttempt(stats.best)} puan
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <div className="eyebrow">Oyun evreleri</div>
                <h3 className="mt-0.5 font-display text-base font-semibold text-stone-100">
                  Nerede güçlüsün?
                </h3>
              </div>
              <Gauge className="h-4 w-4 text-stone-600" />
            </div>
            <div className="grid divide-y divide-white/[0.06] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {progress.byPhase.map((item) => (
                <div key={item.phase} className="px-4 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-200">
                      {PHASE_LABELS[item.phase]}
                    </span>
                    <span className="font-mono text-[9px] text-stone-600">
                      {item.attempts} tur · Sv. {item.level.level}
                    </span>
                  </div>
                  {item.attempts ? (
                    <>
                      <div className="mt-3 flex items-baseline justify-between">
                        <span className="font-display text-xl font-semibold text-stone-50">
                          {item.points}
                          <span className="ml-1 text-xs text-stone-500">puan</span>
                        </span>
                        <span className="font-mono text-[9px] text-stone-500">
                          {Math.round(item.cpl)} cp · Top-2 {item.hitRate.toFixed(0)}%
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px]">
                        <span className="text-stone-400">
                          {item.accuracy.toFixed(1)}% doğruluk
                        </span>
                        <span className="font-mono text-[9px] text-stone-600">
                          {Math.round(item.level.progress * 100)}% sonraki seviye
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300"
                          style={{ width: `${item.level.progress * 100}%` }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-[10px] text-stone-600">Bu evrede henüz tur yok.</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <div>
                <div className="eyebrow">Geçmiş</div>
                <h3 className="mt-0.5 font-display text-base font-semibold text-stone-100">
                  Son turlar
                </h3>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-stone-600">
                <CalendarDays className="h-3 w-3" /> en yeni 10
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left">
                <thead>
                  <tr className="border-b border-white/[0.05] font-mono text-[8.5px] uppercase tracking-[0.14em] text-stone-600">
                    <th className="px-4 py-2 font-normal">Tarih</th>
                    <th className="px-4 py-2 font-normal">Evre</th>
                    <th className="px-4 py-2 font-normal">Hamleler</th>
                    <th className="px-4 py-2 text-right font-normal">Doğruluk</th>
                    <th className="px-4 py-2 text-right font-normal">CPL</th>
                    <th className="px-4 py-2 text-right font-normal">Puan</th>
                    <th className="px-4 py-2 text-right font-normal">Top-2</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.slice(0, 10).map((attempt) => (
                    <tr key={attempt.id} className="border-b border-white/[0.04] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[9.5px] text-stone-500">
                        {formatDate(attempt.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-[10px] text-stone-400">
                        {PHASE_LABELS[attempt.phase]}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-display text-xs font-semibold text-stone-200">
                          {attempt.moves.map((move) => move.san).join(' / ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[10px] text-emerald-300/90">
                        {attempt.accuracy.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[10px] text-stone-400">
                        {Math.round(attempt.cpl)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[10px] text-amber-300/90">
                        +{pointsForAttempt(attempt)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={cn(
                            'inline-flex rounded-full border px-1.5 py-0.5 text-[8.5px] font-semibold',
                            attempt.top2
                              ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
                              : 'border-white/10 bg-white/[0.04] text-stone-500',
                          )}
                        >
                          {attempt.top2 ? 'isabet' : 'ıska'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flex flex-col items-start justify-between gap-3 px-1 pt-1 sm:flex-row sm:items-center">
            <p className="max-w-lg text-[10px] leading-5 text-stone-600">
              Puan = 60 × CP kaldıracı × dallanma × derinlik × evre ağırlığı ×
              (doğruluk/100)^1.35. Metrikler seçtiğin adayların PV1’e göre kaybını ölçer;
              veriler localStorage’da tutulur ve başka bir tarayıcıya taşınmaz.
            </p>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Tüm antrenman geçmişi silinsin mi?')) {
                  clearAttempts();
                  setAttempts([]);
                }
              }}
              className="btn-ghost text-[10px] text-stone-600 hover:text-rose-300"
            >
              <Trash2 className="h-3 w-3" /> Geçmişi temizle
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
