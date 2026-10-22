import { Chess } from 'chess.js';
import { mean, top2HitRate } from './accuracy';
import type { AttemptRecord } from './storage';
import type { Phase, PositionRecord } from './types';

/**
 * Scoring is deliberately formula-based rather than a flat "correct = 100".
 *
 *   max points = 60
 *              × gap leverage      (how much PV1 beats PV2)
 *              × branching factor  (how many legal choices the position has)
 *              × depth factor      (how deeply Lichess verified the line)
 *              × phase weight      (opening / middlegame / endgame emphasis)
 *
 *   awarded points = max points × (accuracy / 100) ^ 1.35
 *
 * The curve rewards precise moves superlinearly: a near-perfect answer keeps
 * almost all of the position's value, while a careless choice loses much more
 * than a linear accuracy drop would suggest.
 */
export const BASE_POSITION_POINTS = 60;
export const ACCURACY_EXPONENT = 1.35;
export const MAX_GAP_CP = 150;
export const LEVEL_POINT_BASE = 250;

export const PHASE_SCORE_WEIGHTS: Record<Phase, number> = {
  opening: 1,
  middlegame: 1.15,
  endgame: 1.25,
};

export type DifficultyTier = 'sakin' | 'dengeli' | 'keskin' | 'usta';

export interface DifficultyTierInfo {
  key: DifficultyTier;
  label: string;
  tone: string;
}

export interface RoundScore {
  positionId: string;
  phase: Phase;
  accuracy: number;
  points: number;
  maxPoints: number;
  difficulty: number;
  legalMoves: number;
  gapCp: number;
  depth: number;
  phaseWeight: number;
  tier: DifficultyTierInfo;
}

export interface LevelInfo {
  level: number;
  points: number;
  start: number;
  next: number;
  progress: number;
  toNext: number;
}

export interface PhaseProgress {
  phase: Phase;
  attempts: number;
  points: number;
  level: LevelInfo;
  accuracy: number;
  cpl: number;
  hitRate: number;
}

export interface ProgressSummary {
  attempts: number;
  points: number;
  level: LevelInfo;
  byPhase: PhaseProgress[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** PV1-PV2 gap mapped smoothly from 1.0× (0 cp) to 2.0× (150 cp). */
export function gapLeverage(gapCp: number): number {
  const gap = clamp(gapCp, 0, MAX_GAP_CP);
  return 1 + Math.log1p(gap / 10) / Math.log(16);
}

/** More legal moves means more candidate noise; 16 moves = 1.0×, 40+ = 1.5×. */
export function branchingFactor(legalMoves: number): number {
  return 1 + 0.5 * clamp((legalMoves - 16) / 24, 0, 1);
}

/** Deeper source analysis gets a small confidence bonus; 20 plies = 1.0×. */
export function depthFactor(depth: number): number {
  return 1 + 0.2 * clamp((depth - 20) / 20, 0, 1);
}

export function positionPotential(
  gapCp: number,
  legalMoves: number,
  depth: number,
  phase: Phase,
): number {
  const multiplier =
    gapLeverage(gapCp) *
    branchingFactor(legalMoves) *
    depthFactor(depth) *
    PHASE_SCORE_WEIGHTS[phase];
  return Math.round(BASE_POSITION_POINTS * multiplier);
}

export function accuracyQuality(accuracy: number): number {
  return Math.pow(clamp(accuracy, 0, 100) / 100, ACCURACY_EXPONENT);
}

export function pointsForRound(maxPoints: number, accuracy: number): number {
  return Math.max(0, Math.round(maxPoints * accuracyQuality(accuracy)));
}

export function countLegalMoves(fen: string): number {
  try {
    return new Chess(fen).moves().length;
  } catch {
    return 20;
  }
}

export function difficultyTier(maxPoints: number): DifficultyTierInfo {
  if (maxPoints < 80) {
    return {
      key: 'sakin',
      label: 'Sakin',
      tone: 'border-sky-400/25 bg-sky-400/[0.07] text-sky-300',
    };
  }
  if (maxPoints < 120) {
    return {
      key: 'dengeli',
      label: 'Dengeli',
      tone: 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-300',
    };
  }
  if (maxPoints < 170) {
    return {
      key: 'keskin',
      label: 'Keskin',
      tone: 'border-amber-400/25 bg-amber-400/[0.07] text-amber-300',
    };
  }
  return {
    key: 'usta',
    label: 'Usta',
    tone: 'border-rose-400/25 bg-rose-400/[0.07] text-rose-300',
  };
}

export function buildRoundScore(
  position: PositionRecord,
  accuracy: number,
  legalMoves = countLegalMoves(position.fen),
): RoundScore {
  const maxPoints = positionPotential(position.gapCp, legalMoves, position.depth, position.phase);
  const boundedAccuracy = clamp(accuracy, 0, 100);
  return {
    positionId: position.id,
    phase: position.phase,
    accuracy: boundedAccuracy,
    points: pointsForRound(maxPoints, boundedAccuracy),
    maxPoints,
    difficulty: maxPoints / BASE_POSITION_POINTS,
    legalMoves,
    gapCp: position.gapCp,
    depth: position.depth,
    phaseWeight: PHASE_SCORE_WEIGHTS[position.phase],
    tier: difficultyTier(maxPoints),
  };
}

/** Old attempts predate scoring. Estimate a fair baseline from stored accuracy. */
export function pointsForAttempt(attempt: Pick<AttemptRecord, 'phase' | 'accuracy' | 'score'>): number {
  if (typeof attempt.score === 'number' && Number.isFinite(attempt.score)) {
    return Math.max(0, Math.round(attempt.score));
  }
  const baseline = BASE_POSITION_POINTS * PHASE_SCORE_WEIGHTS[attempt.phase];
  return Math.max(0, Math.round(baseline * accuracyQuality(attempt.accuracy)));
}

export function levelFromPoints(points: number): LevelInfo {
  const safePoints = Math.max(0, points);
  const level = Math.floor(Math.sqrt(safePoints / LEVEL_POINT_BASE)) + 1;
  const start = LEVEL_POINT_BASE * (level - 1) ** 2;
  const next = LEVEL_POINT_BASE * level ** 2;
  return {
    level,
    points: safePoints,
    start,
    next,
    progress: next > start ? clamp((safePoints - start) / (next - start), 0, 1) : 0,
    toNext: Math.max(0, next - safePoints),
  };
}

export function summarizeProgress(attempts: AttemptRecord[]): ProgressSummary {
  const phases: Phase[] = ['opening', 'middlegame', 'endgame'];
  const totalPoints = attempts.reduce((sum, attempt) => sum + pointsForAttempt(attempt), 0);

  return {
    attempts: attempts.length,
    points: totalPoints,
    level: levelFromPoints(totalPoints),
    byPhase: phases.map((phase) => {
      const phaseAttempts = attempts.filter((attempt) => attempt.phase === phase);
      const points = phaseAttempts.reduce((sum, attempt) => sum + pointsForAttempt(attempt), 0);
      return {
        phase,
        attempts: phaseAttempts.length,
        points,
        level: levelFromPoints(points),
        accuracy: mean(phaseAttempts.map((attempt) => attempt.accuracy)),
        cpl: mean(phaseAttempts.map((attempt) => attempt.cpl)),
        hitRate: top2HitRate(phaseAttempts),
      };
    }),
  };
}
