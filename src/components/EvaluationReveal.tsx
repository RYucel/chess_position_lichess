'use client';

import type { ReactNode } from 'react';
import {
  ArrowRight,
  Brain,
  ChevronRight,
  CircleHelp,
  Gauge,
  Loader2,
  RefreshCcw,
  Sparkles,
  Target,
  TrendingDown,
  Trophy,
} from 'lucide-react';
import { CLASSIFICATION_META, PHASE_LABELS } from '@/lib/accuracy';
import { formatCp, lineToSan } from '@/lib/chess-utils';
import { cn } from '@/lib/cn';
import type { RoundScore } from '@/lib/scoring';
import type { DualEvaluation, MoveEvaluation, PositionRecord, TrainerMode } from '@/lib/types';

export interface CoachState {
  text: string;
  source: 'openrouter' | 'deepseek' | 'local';
  model?: string;
  loading?: boolean;
  error?: string | null;
}

interface EvaluationRevealProps {
  position: PositionRecord;
  analysis: DualEvaluation;
  mode: TrainerMode;
  coach: CoachState | null;
  roundScore: RoundScore | null;
  onAskCoach: () => void;
  onPreviewPv: (index: number) => void;
  onPreviewMove: (uci: string) => void;
  onRetry: () => void;
  onNext: () => void;
}

const SOURCE_LABEL: Record<MoveEvaluation['source'], string> = {
  dataset: 'veri seti',
  engine: 'Stockfish canlı',
  estimate: 'yaklaşık',
};

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function CoachText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flush = () => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="ml-4 list-disc space-y-2 marker:text-emerald-400/70">
        {listItems.map((item, index) => (
          <li key={index}>
            <InlineMarkdown text={item} />
          </li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flush();
      return;
    }
    const bullet = line.match(/^(?:[-•*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    flush();
    blocks.push(
      <p key={`p-${blocks.length}`}>
        <InlineMarkdown text={line} />
      </p>,
    );
  });
  flush();

  return <div className="prose-coach space-y-3">{blocks}</div>;
}

function ScoreRing({ value }: { value: number }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100);
  return (
    <div className="relative h-[118px] w-[118px] shrink-0">
      <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90">
        <circle cx="56" cy="56" r={radius} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <circle
          cx="56"
          cy="56"
          r={radius}
          fill="none"
          stroke="url(#accuracyGradient)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
        <defs>
          <linearGradient id="accuracyGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#6ee7b7" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[30px] font-semibold leading-none tracking-tight text-stone-50">
          {value.toFixed(0)}
          <span className="text-base text-stone-500">%</span>
        </span>
        <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.15em] text-stone-500">
          doğruluk
        </span>
      </div>
    </div>
  );
}

function MoveQualityRow({
  move,
  index,
  onPreviewMove,
}: {
  move: MoveEvaluation;
  index: number;
  onPreviewMove: (uci: string) => void;
}) {
  const meta = CLASSIFICATION_META[move.classification];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2.5">
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold',
          index === 0
            ? 'border-sky-400/25 bg-sky-400/10 text-sky-300'
            : 'border-orange-400/25 bg-orange-400/10 text-orange-300',
        )}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-semibold tracking-tight text-stone-100">
            {move.san}
          </span>
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', meta.tone)}>
            <span className={cn('h-1 w-1 rounded-full', meta.dot)} />
            {meta.short}
          </span>
          {move.source === 'estimate' && (
            <span className="text-[9px] uppercase tracking-wide text-amber-400/70">tahmin</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[9.5px] text-stone-500">
          <span>{move.rank ? `PV${move.rank}` : 'PV dışı'}</span>
          <span className={move.deltaCp > 60 ? 'text-rose-300/80' : move.deltaCp > 25 ? 'text-amber-300/80' : 'text-emerald-300/80'}>
            −{Math.round(move.deltaCp)} cp
          </span>
          <span>{move.accuracy.toFixed(1)}%</span>
          <span>{SOURCE_LABEL[move.source]}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onPreviewMove(move.uci)}
        className="icon-btn h-7 w-7 shrink-0"
        title="Bu hamleyi tahtada göster"
        aria-label={`${move.san} hamlesini tahtada göster`}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function EvaluationReveal({
  position,
  analysis,
  mode,
  coach,
  roundScore,
  onAskCoach,
  onPreviewPv,
  onPreviewMove,
  onRetry,
  onNext,
}: EvaluationRevealProps) {
  const primaryMeta = CLASSIFICATION_META[analysis.primary.classification];
  const top2Hit =
    mode === 'dual'
      ? analysis.unorderedTop2
      : analysis.primary.rank === 1 || analysis.primary.rank === 2;

  return (
    <div className="animate-rise space-y-4">
      <div className="panel-inset overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <ScoreRing value={analysis.averageAccuracy} />
          <div className="min-w-0 flex-1">
            <div className="eyebrow">Tur değerlendirmesi</div>
            <h3 className="mt-1 font-display text-xl font-semibold tracking-tight text-stone-50">
              {top2Hit ? 'Adayların pozisyonu taşıyor.' : 'Pozisyon daha iyi bir plan istiyor.'}
            </h3>
            <p className="mt-1 text-xs leading-5 text-stone-400">
              {mode === 'dual'
                ? analysis.unorderedTop2
                  ? 'Top-2 kümesini sırasız olarak tam yakaladın.'
                  : `Top-2 kümesiyle ${analysis.top2Overlap}/2 örtüşme var.`
                : analysis.primary.rank
                  ? `Seçimin motorun PV${analysis.primary.rank} hamlesi.`
                  : 'Seçimin kayıtlı ana varyantların dışında; canlı motor değerlendirmesi kullanıldı.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="chip border-white/[0.08]">
                <TrendingDown className="h-3 w-3 text-orange-300" />
                ort. {Math.round(analysis.averageCpl)} cp kayıp
              </span>
              <span className="chip border-white/[0.08]">
                <Gauge className="h-3 w-3 text-sky-300" />
                ΔWin {analysis.primary.deltaWin.toFixed(1)}%
              </span>
              <span className={cn('chip', primaryMeta.tone)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', primaryMeta.dot)} />
                {primaryMeta.short}
              </span>
              <span className="chip border-white/[0.08] text-stone-500">
                {PHASE_LABELS[position.phase]}
              </span>
              {roundScore && (
                <span className={cn('chip', roundScore.tier.tone)}>
                  <Trophy className="h-3 w-3" />
                  +{roundScore.points} puan
                </span>
              )}
            </div>
          </div>
        </div>

        {mode === 'dual' && (
          <div className="grid grid-cols-2 border-t border-white/[0.06] text-center">
            <div className="border-r border-white/[0.06] px-3 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-stone-500">
                Sırasız Top-2
              </div>
              <div className="mt-1 font-display text-sm font-semibold text-stone-100">
                {analysis.top2Overlap}/2 eşleşme
              </div>
            </div>
            <div className="px-3 py-3">
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-stone-500">
                Birebir sıra
              </div>
              <div
                className={cn(
                  'mt-1 font-display text-sm font-semibold',
                  analysis.orderedTop2 ? 'text-emerald-300' : 'text-stone-400',
                )}
              >
                {analysis.orderedTop2 ? 'PV1 → PV2' : 'Eşleşmedi'}
              </div>
            </div>
          </div>
        )}
      </div>

      {roundScore && (
        <div className="panel-inset overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.06] sm:grid-cols-4 sm:divide-y-0">
            <div className="px-3 py-3">
              <div className="eyebrow">Kazanılan puan</div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-display text-xl font-semibold text-emerald-300">
                  +{roundScore.points}
                </span>
                <span className="font-mono text-[9px] text-stone-500">puan</span>
              </div>
            </div>
            <div className="px-3 py-3">
              <div className="eyebrow">Maksimum</div>
              <div className="mt-1 font-display text-xl font-semibold text-stone-100">
                {roundScore.maxPoints}
                <span className="ml-1 font-mono text-[9px] font-normal text-stone-500">puan</span>
              </div>
            </div>
            <div className="px-3 py-3">
              <div className="eyebrow">Zorluk</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className={cn('chip px-2 py-0.5 text-[9px]', roundScore.tier.tone)}>
                  {roundScore.tier.label}
                </span>
                <span className="font-mono text-[10px] text-stone-400">
                  ×{roundScore.difficulty.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="px-3 py-3">
              <div className="eyebrow">Pozisyon girdisi</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[9.5px] text-stone-500">
                <span>PV1–PV2 {roundScore.gapCp} cp</span>
                <span>{roundScore.legalMoves} yasal hamle</span>
                <span>d{roundScore.depth}</span>
              </div>
            </div>
          </div>
          <p className="border-t border-white/[0.06] px-3 py-2 font-mono text-[8.5px] leading-4 text-stone-600">
            60 × CP kaldıracı × dallanma × derinlik × evre ağırlığı ({roundScore.phaseWeight.toFixed(2)}) × (doğruluk/100)^1.35
          </p>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow">Senin adayların</h3>
          <span className="text-[10px] text-stone-600">Beyaz perspektifi · cp</span>
        </div>
        <div className="space-y-2">
          {analysis.moves.map((move, index) => (
            <MoveQualityRow
              key={move.uci}
              move={move}
              index={index}
              onPreviewMove={onPreviewMove}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="eyebrow">Motorun ana varyantları</h3>
          <span className="inline-flex items-center gap-1 text-[10px] text-stone-600">
            <Target className="h-3 w-3" /> tıkla ve tahtada izle
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/[0.07]">
          {position.pvs.slice(0, 3).map((pv, index) => {
            const sans = lineToSan(position.fen, pv.line);
            return (
              <button
                key={`${pv.move}-${index}`}
                type="button"
                onClick={() => onPreviewPv(index)}
                className="group flex w-full items-start gap-3 border-b border-white/[0.06] px-3 py-3 text-left transition last:border-b-0 hover:bg-white/[0.035]"
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border font-mono text-[9px] font-bold',
                    index === 0
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      : index === 1
                        ? 'border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200'
                        : 'border-white/10 bg-white/[0.04] text-stone-400',
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-display text-sm font-semibold text-stone-100">
                      {sans[0] ?? pv.move}
                    </span>
                    <span className="font-mono text-[10px] text-stone-500">{formatCp(pv.cp ?? 0)}</span>
                    <span className="font-mono text-[9px] text-stone-600">d{pv.depth}</span>
                  </span>
                  <span className="mt-1 block truncate font-mono text-[10px] text-stone-500 group-hover:text-stone-400">
                    {sans.slice(1, 8).join(' ') || pv.line}
                  </span>
                </span>
                <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-stone-600 transition group-hover:translate-x-0.5 group-hover:text-stone-300" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel-inset overflow-hidden">
        <div className="flex items-start gap-3 border-b border-white/[0.06] px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-violet-400/25 bg-violet-400/10 text-violet-300">
            <Brain className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-sm font-semibold text-stone-100">AI Koç</h3>
              {coach && !coach.loading && (
                <span className="chip px-2 py-0.5 text-[9px]">
                  {coach.source === 'local' ? 'yerel not' : coach.model ?? coach.source}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              Hamlenin neden alternatiflerden ayrıldığını insan dilinde oku.
            </p>
          </div>
        </div>
        <div className="px-4 py-3.5">
          {!coach && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-xs leading-5 text-stone-400">
                Motor sayıları doğruyu söyler; planı ise koç anlatır. Bu turun PV1/PV2
                karşılaştırmasını açıklatalım.
              </p>
              <button type="button" onClick={onAskCoach} className="btn-secondary px-3 py-2 text-xs">
                <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                Neden bu hamle daha iyi?
              </button>
            </div>
          )}
          {coach?.loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-stone-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />
                Koç pozisyonu okuyor…
              </div>
              <div className="h-2 w-11/12 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-2 w-4/5 animate-pulse rounded bg-white/[0.05]" />
              <div className="h-2 w-2/3 animate-pulse rounded bg-white/[0.04]" />
            </div>
          )}
          {coach && !coach.loading && coach.text && <CoachText text={coach.text} />}
          {coach?.error && (
            <p className="mt-2 flex items-center gap-1.5 text-[10px] text-rose-300/80">
              <CircleHelp className="h-3 w-3" /> {coach.error}
            </p>
          )}
          {coach && !coach.loading && coach.source === 'local' && (
            <p className="mt-3 flex items-start gap-1.5 border-t border-white/[0.06] pt-2.5 text-[9.5px] leading-4 text-stone-600">
              <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" />
              Yapay zekâ anahtarı tanımlı olmadığında aynı verilerden üretilen yerel koç notu
              gösterilir. Tahmin değil, seçilen PV’lere dayalı şablon bir açıklamadır.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRetry} className="btn-secondary flex-1 text-xs">
          <RefreshCcw className="h-3.5 w-3.5" /> Adayları değiştir
        </button>
        <button type="button" onClick={onNext} className="btn-primary flex-1 text-xs">
          Sonraki pozisyon <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
