'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PreviewState } from '@/lib/types';

interface VariationExplorerProps {
  preview: PreviewState | null;
  onStep: (ply: number) => void;
  onClose: () => void;
}

export function VariationExplorer({ preview, onStep, onClose }: VariationExplorerProps) {
  if (!preview) return null;
  const total = preview.lineSan.length;

  return (
    <div className="panel-inset animate-rise overflow-hidden">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: preview.color }}
        />
        <span className="text-[11px] font-semibold text-stone-200">{preview.label}</span>
        <span className="font-mono text-[9px] text-stone-600">
          {preview.ply} / {total}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="icon-btn h-7 w-7"
            onClick={() => onStep(Math.max(0, preview.ply - 1))}
            disabled={preview.ply === 0}
            aria-label="Önceki hamle"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="icon-btn h-7 w-7"
            onClick={() => onStep(Math.min(total, preview.ply + 1))}
            disabled={preview.ply >= total}
            aria-label="Sonraki hamle"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="icon-btn h-7 w-7"
            onClick={onClose}
            aria-label="Varyant önizlemesini kapat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onStep(0)}
          className={cn(
            'shrink-0 rounded-md border px-2 py-1 font-mono text-[9px] transition',
            preview.ply === 0
              ? 'border-white/20 bg-white/[0.08] text-stone-100'
              : 'border-white/[0.06] text-stone-500 hover:text-stone-200',
          )}
        >
          başlangıç
        </button>
        {preview.lineSan.map((san, index) => (
          <button
            key={`${san}-${index}`}
            type="button"
            onClick={() => onStep(index + 1)}
            className={cn(
              'shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] transition',
              preview.ply === index + 1
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                : 'border-white/[0.06] text-stone-400 hover:border-white/[0.14] hover:text-stone-100',
            )}
          >
            {san}
          </button>
        ))}
      </div>
    </div>
  );
}
