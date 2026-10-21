'use client';

import { ArrowRight, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TrainerMode } from '@/lib/types';

export interface Candidate {
  uci: string;
  san: string;
}

interface CandidateSelectorProps {
  mode: TrainerMode;
  candidates: Array<Candidate | null>;
  activeSlot: number;
  analyzing: boolean;
  canAnalyze: boolean;
  onActivateSlot: (slot: number) => void;
  onRemove: (slot: number) => void;
  onClear: () => void;
  onAnalyze: () => void;
  notice: string | null;
}

export function CandidateSelector({
  mode,
  candidates,
  activeSlot,
  analyzing,
  canAnalyze,
  onActivateSlot,
  onRemove,
  onClear,
  onAnalyze,
  notice,
}: CandidateSelectorProps) {
  const slots = mode === 'dual' ? [0, 1] : [0];

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {slots.map((slot) => {
          const candidate = candidates[slot];
          const active = activeSlot === slot;
          const isPrimary = slot === 0;
          return (
            <div
              key={slot}
              className={cn(
                'group relative overflow-hidden rounded-xl border transition',
                active
                  ? isPrimary
                    ? 'border-sky-400/45 bg-sky-400/[0.055]'
                    : 'border-orange-400/45 bg-orange-400/[0.055]'
                  : 'border-white/[0.08] bg-black/15 hover:border-white/[0.14]',
              )}
            >
              <button
                type="button"
                onClick={() => onActivateSlot(slot)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left focus:outline-none"
                aria-pressed={active}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold',
                    isPrimary
                      ? 'border-sky-400/30 bg-sky-400/10 text-sky-300'
                      : 'border-orange-400/30 bg-orange-400/10 text-orange-300',
                  )}
                >
                  {candidate ? <Check className="h-4 w-4" /> : slot + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="eyebrow block">
                    {isPrimary ? 'Birincil tercih' : 'Alternatif tercih'}
                  </span>
                  {candidate ? (
                    <span className="mt-0.5 flex items-baseline gap-2">
                      <span className="font-display text-lg font-semibold tracking-tight text-stone-100">
                        {candidate.san}
                      </span>
                      <span className="font-mono text-[10px] text-stone-500">{candidate.uci}</span>
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {active ? 'Tahtada bir hamle seç…' : 'Bu adayı düzenlemek için tıkla'}
                    </span>
                  )}
                </span>
                {candidate && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(slot);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                        onRemove(slot);
                      }
                    }}
                    className="icon-btn h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
                    aria-label={`${slot + 1}. adayı kaldır`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {notice && (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] leading-5 text-amber-200/90">
          {notice}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze || analyzing}
          className="btn-primary flex-1"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Değerlendiriliyor…
            </>
          ) : (
            <>
              Analiz et <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!candidates.some(Boolean) || analyzing}
          className="icon-btn h-10 w-10"
          aria-label="Adayları temizle"
          title="Adayları temizle"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-[10.5px] leading-5 text-stone-600">
        {mode === 'dual'
          ? 'İki aday da aynı pozisyondan seçilir. Sıra önemli değil; ancak birincil tercih Top-1 ile, alternatif Top-2 ile kıyaslanır.'
          : 'Tek hamlede hedef: motorun Top-2 kümesi veya 0–25 cp kayıp. Piyon terfisi otomatik olarak vezire yapılır.'}
      </p>
    </div>
  );
}
