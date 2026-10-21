'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ChessboardOptions } from 'react-chessboard';
import { ArrowUpDown, Eye, EyeOff, Lock, Sparkles } from 'lucide-react';
import type { PositionRecord } from '@/lib/types';
import {
  createChess,
  formatCp,
  legalTargets,
  phaseLabel,
  sideToMove,
} from '@/lib/chess-utils';
import { cn } from '@/lib/cn';

const Chessboard = dynamic(
  () => import('react-chessboard').then((module) => module.Chessboard),
  {
    ssr: false,
    loading: () => (
      <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-ink-800">
        <span className="text-xs text-stone-500">Tahta hazırlanıyor…</span>
      </div>
    ),
  },
);

export interface BoardCandidate {
  uci: string;
  slot: number;
}

interface TrainerBoardProps {
  position: PositionRecord | null;
  orientation: 'white' | 'black';
  candidates: BoardCandidate[];
  previewFen: string | null;
  previewLastMove: { from: string; to: string } | null;
  revealed: boolean;
  disabled?: boolean;
  onMove: (from: string, to: string) => void;
  onFlip: () => void;
}

export function TrainerBoard({
  position,
  orientation,
  candidates,
  previewFen,
  previewLastMove,
  revealed,
  disabled = false,
  onMove,
  onFlip,
}: TrainerBoardProps) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const fen = previewFen ?? position?.fen ?? '';
  const turn = position ? sideToMove(position.fen) : 'w';
  const interactive = Boolean(position) && !previewFen && !disabled;

  useEffect(() => {
    setSelectedSquare(null);
  }, [position?.id, previewFen]);

  const targets = useMemo(
    () => (selectedSquare && fen ? legalTargets(fen, selectedSquare) : []),
    [selectedSquare, fen],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    const chess = fen ? createChess(fen) : null;

    if (selectedSquare) {
      styles[selectedSquare] = {
        background: 'rgba(96, 165, 250, 0.28)',
        boxShadow: 'inset 0 0 0 2px rgba(147, 197, 253, 0.75)',
      };
      for (const target of targets) {
        const occupied = chess?.get(target as never);
        styles[target] = occupied
          ? {
              background:
                'radial-gradient(circle, transparent 54%, rgba(52, 211, 153, 0.38) 56%, rgba(52, 211, 153, 0.38) 67%, transparent 69%)',
            }
          : {
              background:
                'radial-gradient(circle, rgba(52, 211, 153, 0.8) 0 13%, transparent 14%)',
            };
      }
    }

    if (previewLastMove) {
      for (const square of [previewLastMove.from, previewLastMove.to]) {
        styles[square] = {
          ...styles[square],
          background: 'rgba(250, 204, 21, 0.2)',
          boxShadow: 'inset 0 0 0 2px rgba(250, 204, 21, 0.36)',
        };
      }
    }

    for (const candidate of candidates) {
      const from = candidate.uci.slice(0, 2);
      styles[from] = {
        ...styles[from],
        boxShadow:
          candidate.slot === 0
            ? 'inset 0 0 0 2px rgba(96, 165, 250, 0.65)'
            : 'inset 0 0 0 2px rgba(251, 146, 60, 0.65)',
      };
    }

    return styles;
  }, [candidates, fen, previewLastMove, selectedSquare, targets]);

  const arrows = useMemo(
    () =>
      candidates.map((candidate) => ({
        startSquare: candidate.uci.slice(0, 2),
        endSquare: candidate.uci.slice(2, 4),
        color: candidate.slot === 0 ? 'rgba(96, 165, 250, 0.92)' : 'rgba(251, 146, 60, 0.92)',
      })),
    [candidates],
  );

  const options: ChessboardOptions = useMemo(
    () => ({
      position: fen,
      boardOrientation: orientation,
      arrows,
      allowDragging: interactive,
      allowDrawingArrows: false,
      showNotation: true,
      animationDurationInMs: 140,
      darkSquareStyle: { backgroundColor: '#42594c' },
      lightSquareStyle: { backgroundColor: '#c4cfbd' },
      darkSquareNotationStyle: { color: 'rgba(236, 253, 245, 0.55)', fontSize: '10px' },
      lightSquareNotationStyle: { color: 'rgba(12, 15, 13, 0.55)', fontSize: '10px' },
      boardStyle: { borderRadius: '10px', overflow: 'hidden' },
      squareStyles,
      canDragPiece: ({ piece }) =>
        interactive && piece.pieceType.startsWith(turn === 'w' ? 'w' : 'b'),
      onPieceDrop: ({ sourceSquare, targetSquare }) => {
        if (!interactive || !targetSquare) return false;
        onMove(sourceSquare, targetSquare);
        return false;
      },
      onSquareClick: ({ square, piece }) => {
        if (!interactive) return;
        const isOwnPiece = Boolean(piece && piece.pieceType.startsWith(turn === 'w' ? 'w' : 'b'));

        if (!selectedSquare) {
          if (isOwnPiece) setSelectedSquare(square);
          return;
        }
        if (square === selectedSquare) {
          setSelectedSquare(null);
          return;
        }
        if (isOwnPiece) {
          setSelectedSquare(square);
          return;
        }
        onMove(selectedSquare, square);
        setSelectedSquare(null);
      },
    }),
    [arrows, fen, interactive, onMove, orientation, selectedSquare, squareStyles, turn],
  );

  if (!position) {
    return (
      <div className="panel overflow-hidden">
        <div className="flex h-14 items-center border-b border-white/[0.06] px-4">
          <div className="h-3 w-24 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
        <div className="p-4">
          <div className="aspect-square w-full animate-pulse rounded-xl bg-ink-800" />
        </div>
        <div className="h-12 border-t border-white/[0.06]" />
      </div>
    );
  }

  const side = position.sideToMove === 'w' ? 'Beyaz' : 'Siyah';
  const moverEval = position.sideToMove === 'w' ? position.evalCp : -position.evalCp;

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2.5 sm:px-4">
        <span className="chip border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200">
          <Sparkles className="h-3 w-3" />
          {phaseLabel(position.phase)}
        </span>
        <span className="chip">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              position.sideToMove === 'w' ? 'bg-stone-100' : 'bg-stone-700 ring-1 ring-white/50',
            )}
          />
          Sıra: {side}
        </span>
        {revealed ? (
          <span className="chip border-white/[0.08] font-mono" title="Beyaz perspektifinden değerlendirme">
            <Eye className="h-3 w-3 text-emerald-400" />
            {formatCp(position.evalCp)} <span className="text-[9px] text-stone-500">beyaz</span>
          </span>
        ) : (
          <span className="chip text-stone-500">
            <Lock className="h-3 w-3" />
            Değerlendirme gizli
          </span>
        )}
        <button
          type="button"
          onClick={onFlip}
          className="icon-btn ml-auto h-8 w-8"
          aria-label="Tahtayı çevir"
          title="Tahtayı çevir"
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-2.5 sm:p-3.5">
        <div className="aspect-square w-full overflow-hidden rounded-[10px] board-shadow">
          <Chessboard options={options} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.06] px-3 py-2.5 text-[10px] text-stone-500 sm:px-4">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-sky-400" /> 1. aday
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-5 rounded-full bg-orange-400" /> 2. aday
        </span>
        {previewFen ? (
          <span className="inline-flex items-center gap-1.5 text-amber-300/80">
            <EyeOff className="h-3 w-3" /> Varyant önizlemesi
          </span>
        ) : (
          <span className="ml-auto hidden font-mono sm:inline">
            {position.id} · d{position.depth} · {position.pvs.length} PV
          </span>
        )}
        {revealed && (
          <span className="font-mono text-stone-600" title="Sıranın perspektifinden değerlendirme">
            sıra {moverEval >= 0 ? '+' : ''}
            {(moverEval / 100).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
