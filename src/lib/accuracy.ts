import type {
  Classification,
  DualEvaluation,
  EvalSource,
  MoveEvaluation,
  PositionRecord,
  Pv,
} from './types';

export const CLASSIFICATION_META: Record<
  Classification,
  { label: string; short: string; tone: string; dot: string; description: string }
> = {
  top1: {
    label: 'Top 1 — Kusursuz seçim',
    short: 'Top 1',
    tone: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
    dot: 'bg-emerald-400',
    description: 'Motorun birinci tercihi. Pozisyonun en güçlü fikri.',
  },
  top2: {
    label: 'Top 2 — Elit alternatif',
    short: 'Top 2',
    tone: 'border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200',
    dot: 'bg-emerald-300',
    description: 'Motorun ikinci tercihi; kayıp 30 cp içinde.',
  },
  solid: {
    label: 'Yakın / Sağlam',
    short: 'Sağlam',
    tone: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
    dot: 'bg-sky-400',
    description: 'İlk iki tercih değil ama pozisyonu koruyan sağlam bir hamle.',
  },
  suboptimal: {
    label: 'İdare eder',
    short: 'Suboptimal',
    tone: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    dot: 'bg-amber-400',
    description: 'Oyunu kaybettirmez; yine de inisiyatif veya üstünlük törpülenir.',
  },
  inaccuracy: {
    label: 'Konumsal hata',
    short: 'Hata',
    tone: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
    dot: 'bg-rose-400',
    description: 'Pozisyonun dengesini belirgin biçimde bozan karar.',
  },
};

export const PHASE_LABELS = {
  opening: 'Açılış',
  middlegame: 'Orta oyun',
  endgame: 'Oyun sonu',
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Lichess Win% formula. `cp` is from the perspective of the player being evaluated. */
export function cpToWinProbability(cp: number): number {
  const bounded = clamp(cp, -10000, 10000);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * bounded)) - 1);
}

/** Lichess move-accuracy curve. `deltaWin` is a percentage in [0, 100]. */
export function winLossToAccuracy(deltaWin: number): number {
  const bounded = clamp(deltaWin, 0, 100);
  return clamp(103.1668 * Math.exp(-0.04354 * bounded) - 3.1669, 0, 100);
}

export function mateToCp(mate: number): number {
  return mate > 0 ? 10000 - mate * 10 : -10000 - mate * 10;
}

export function cpFromScore(cp: number | null, mate: number | null): number {
  if (cp !== null && Number.isFinite(cp)) return cp;
  if (mate !== null && Number.isFinite(mate)) return mateToCp(mate);
  return 0;
}

/** Dataset cp values are white-perspective. This flips them to the mover's view. */
export function toMoverCp(cpWhite: number, sideToMove: 'w' | 'b'): number {
  return sideToMove === 'w' ? cpWhite : -cpWhite;
}

export function findPv(position: PositionRecord, uci: string): { pv: Pv; rank: number } | null {
  const index = position.pvs.findIndex((pv) => pv.move === uci);
  return index === -1 ? null : { pv: position.pvs[index], rank: index + 1 };
}

export function classifyMove(
  rank: number | null,
  deltaCp: number,
  accuracy: number,
): Classification {
  if (rank === 1) return 'top1';
  if (rank === 2 && deltaCp <= 30) return 'top2';
  if (deltaCp <= 25 || accuracy >= 90) return 'solid';
  if (deltaCp <= 60) return 'suboptimal';
  return 'inaccuracy';
}

export interface EvaluateMoveOptions {
  cpWhite?: number;
  mate?: number | null;
  source?: EvalSource;
  san?: string;
}

export function evaluateMove(
  position: PositionRecord,
  uci: string,
  options: EvaluateMoveOptions = {},
): MoveEvaluation {
  const found = findPv(position, uci);
  const bestPv = position.pvs[0];
  const bestCpWhite = cpFromScore(bestPv?.cp ?? null, bestPv?.mate ?? null);
  const bestCpMover = toMoverCp(bestCpWhite, position.sideToMove);

  const cpWhite =
    options.cpWhite !== undefined
      ? options.cpWhite
      : cpFromScore(found?.pv.cp ?? null, found?.pv.mate ?? null);
  const mate = options.mate !== undefined ? options.mate : (found?.pv.mate ?? null);
  const cpMover = toMoverCp(cpWhite, position.sideToMove);
  const deltaCp = Math.max(0, bestCpMover - cpMover);

  const winBefore = cpToWinProbability(bestCpMover);
  const winAfter = cpToWinProbability(cpMover);
  const deltaWin = Math.max(0, winBefore - winAfter);
  const accuracy = winLossToAccuracy(deltaWin);
  const rank = found?.rank ?? null;
  const source: EvalSource =
    options.source ?? (found ? 'dataset' : options.cpWhite !== undefined ? 'engine' : 'estimate');

  return {
    uci,
    san: options.san ?? uci,
    rank,
    cpWhite,
    cpMover,
    mate,
    deltaCp,
    winBefore,
    winAfter,
    deltaWin,
    accuracy,
    classification: classifyMove(rank, deltaCp, accuracy),
    source,
    inDataset: Boolean(found),
  };
}

export function buildDualEvaluation(moves: MoveEvaluation[]): DualEvaluation {
  const primary = moves[0];
  const secondary = moves[1] ?? null;
  const orderedTop2 = primary?.rank === 1 && secondary?.rank === 2;
  const unorderedTop2 =
    Boolean(primary && secondary) &&
    new Set([primary.rank, secondary.rank]).size === 2 &&
    [primary.rank, secondary.rank].every((rank) => rank === 1 || rank === 2);
  const top2Overlap = [primary?.rank, secondary?.rank].filter(
    (rank) => rank === 1 || rank === 2,
  ).length;

  return {
    moves,
    primary,
    secondary,
    orderedTop2,
    unorderedTop2,
    top2Overlap,
    averageAccuracy:
      moves.reduce((sum, move) => sum + move.accuracy, 0) / Math.max(1, moves.length),
    averageCpl: moves.reduce((sum, move) => sum + move.deltaCp, 0) / Math.max(1, moves.length),
  };
}

export function top2HitRate(attempts: Array<{ top2: boolean }>): number {
  if (!attempts.length) return 0;
  return (attempts.filter((attempt) => attempt.top2).length / attempts.length) * 100;
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
