import { Chess, type Move, type Square } from 'chess.js';
import type { Phase } from './types';

export function normalizeFen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length === 4) return `${parts.join(' ')} 0 1`;
  if (parts.length === 5) return `${parts.join(' ')} 1`;
  return parts.join(' ');
}

export function createChess(fen: string): Chess {
  return new Chess(normalizeFen(fen));
}

export function uciFromMove(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

export function tryMove(fen: string, uci: string): Move | null {
  const chess = createChess(fen);
  try {
    return chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  } catch {
    return null;
  }
}

export function uciToSan(fen: string, uci: string): string {
  return tryMove(fen, uci)?.san ?? uci;
}

export function lineToSan(fen: string, line: string): string[] {
  const chess = createChess(fen);
  const sans: string[] = [];
  for (const uci of line.trim().split(/\s+/).filter(Boolean)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      sans.push(move.san);
    } catch {
      break;
    }
  }
  return sans;
}

export interface LineFrames {
  frames: string[];
  sans: string[];
  ucis: string[];
}

export function buildLineFrames(fen: string, line: string): LineFrames {
  const chess = createChess(fen);
  const frames = [chess.fen()];
  const sans: string[] = [];
  const ucis: string[] = [];

  for (const uci of line.trim().split(/\s+/).filter(Boolean)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      frames.push(chess.fen());
      sans.push(move.san);
      ucis.push(uciFromMove(move));
    } catch {
      break;
    }
  }

  return { frames, sans, ucis };
}

export function formatCp(cpWhite: number, mate: number | null = null): string {
  if (mate !== null && Number.isFinite(mate) && Math.abs(mate) < 100) {
    return `${mate > 0 ? '+' : '-'}M${Math.abs(mate)}`;
  }
  const pawns = cpWhite / 100;
  if (Math.abs(pawns) < 0.005) return '0.00';
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function formatMoverCp(cpMover: number, mate: number | null = null): string {
  return formatCp(cpMover, mate);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function sideToMove(fen: string): 'w' | 'b' {
  return normalizeFen(fen).split(' ')[1] === 'b' ? 'b' : 'w';
}

export function phaseLabel(phase: Phase): string {
  return phase === 'opening' ? 'Açılış' : phase === 'endgame' ? 'Oyun sonu' : 'Orta oyun';
}

export function countPieces(fen: string): number {
  return (normalizeFen(fen).split(' ')[0].match(/[prnbqkPRNBQK]/g) ?? []).length;
}

export function legalTargets(fen: string, square: string): string[] {
  const chess = createChess(fen);
  try {
    return chess
      .moves({ square: square as Square, verbose: true })
      .map((move) => move.to as string);
  } catch {
    return [];
  }
}

export function isOwnPiece(fen: string, square: string): boolean {
  const chess = createChess(fen);
  const piece = chess.get(square as Square);
  return Boolean(piece && piece.color === chess.turn());
}

export function sanFromUciSafe(fen: string, uci: string): string {
  const san = uciToSan(fen, uci);
  return san === uci ? uci : san;
}

export function materialBalance(fen: string): number {
  const chess = createChess(fen);
  let balance = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = { p: 1, n: 3, b: 3.2, r: 5, q: 9, k: 0 }[piece.type];
      balance += piece.color === 'w' ? value : -value;
    }
  }
  return balance;
}
