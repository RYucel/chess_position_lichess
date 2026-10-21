import { Chess } from 'chess.js';
import { normalizeFen } from './chess-utils';

const VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Tables are written from White's point of view, starting at a8 and ending at h1,
// matching chess.js board() row order.
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5,
    10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20,
    -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10,
    0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10,
    5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0,
    -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10,
    -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0,
    0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0,
    0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0,
    0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40,
    -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30,
    -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0,
    10, 30, 20,
  ],
};

function pstValue(piece: string, color: 'w' | 'b', row: number, col: number): number {
  const table = PST[piece];
  if (!table) return 0;
  const index = color === 'w' ? row * 8 + col : (7 - row) * 8 + col;
  return table[index] ?? 0;
}

/**
 * A deliberately conservative fallback when Stockfish cannot load.
 * It is material + piece-square only, so the UI always labels it as an estimate.
 */
export function estimatePosition(fen: string): number {
  const chess = new Chess(normalizeFen(fen));
  let white = 0;
  let black = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  chess.board().forEach((row, rowIndex) => {
    row.forEach((piece, colIndex) => {
      if (!piece) return;
      const value = VALUES[piece.type] ?? 0;
      const positional = pstValue(piece.type, piece.color, rowIndex, colIndex);
      if (piece.color === 'w') {
        white += value + positional;
        if (piece.type === 'b') whiteBishops++;
      } else {
        black += value + positional;
        if (piece.type === 'b') blackBishops++;
      }
    });
  });

  if (whiteBishops >= 2) white += 25;
  if (blackBishops >= 2) black += 25;
  return white - black;
}

export function estimateAfterMove(
  fen: string,
  uci: string,
): { cpWhite: number; mate: number | null } {
  const chess = new Chess(normalizeFen(fen));
  const mover = chess.turn();
  try {
    chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
  } catch {
    return { cpWhite: 0, mate: null };
  }

  if (chess.isCheckmate()) {
    return { cpWhite: mover === 'w' ? 10000 : -10000, mate: mover === 'w' ? 1 : -1 };
  }
  if (chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition()) {
    return { cpWhite: 0, mate: null };
  }
  return { cpWhite: estimatePosition(chess.fen()), mate: null };
}
