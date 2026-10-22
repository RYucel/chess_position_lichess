import { describe, expect, it } from 'vitest';
import {
  BASE_POSITION_POINTS,
  PHASE_SCORE_WEIGHTS,
  accuracyQuality,
  branchingFactor,
  buildRoundScore,
  countLegalMoves,
  depthFactor,
  gapLeverage,
  levelFromPoints,
  pointsForAttempt,
  pointsForRound,
  positionPotential,
  summarizeProgress,
} from '../src/lib/scoring';
import type { PositionRecord } from '../src/lib/types';
import type { AttemptRecord } from '../src/lib/storage';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function makePosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: 'score-test',
    fen: START_FEN,
    phase: 'middlegame',
    sideToMove: 'w',
    pieces: 32,
    evalCp: 20,
    gapCp: 50,
    depth: 30,
    knodes: 1000,
    pvs: [],
    source: 'lichess-position-evaluations',
    label: 'Scoring test position',
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: 'attempt-test',
    createdAt: '2026-10-22T00:00:00.000Z',
    positionId: 'score-test',
    phase: 'opening',
    mode: 'single',
    top1: true,
    top2: true,
    top2Overlap: 1,
    orderedTop2: false,
    cpl: 0,
    accuracy: 100,
    classification: 'top1',
    moves: [],
    bestMoveSan: 'e4',
    evalCp: 20,
    ...overrides,
  };
}

describe('difficulty factors', () => {
  it('maps the PV1-PV2 gap smoothly from 1× to 2×', () => {
    expect(gapLeverage(0)).toBeCloseTo(1);
    expect(gapLeverage(150)).toBeCloseTo(2);
    expect(gapLeverage(30)).toBeGreaterThan(gapLeverage(10));
    expect(gapLeverage(150)).toBeGreaterThan(gapLeverage(75));
  });

  it('counts legal moves from the FEN', () => {
    expect(countLegalMoves(START_FEN)).toBe(20);
    expect(countLegalMoves('not-a-fen')).toBe(20);
  });

  it('increases monotonically with legal moves and source depth', () => {
    expect(branchingFactor(16)).toBeCloseTo(1);
    expect(branchingFactor(40)).toBeCloseTo(1.5);
    expect(branchingFactor(30)).toBeGreaterThan(branchingFactor(20));
    expect(depthFactor(20)).toBeCloseTo(1);
    expect(depthFactor(40)).toBeCloseTo(1.2);
    expect(depthFactor(30)).toBeGreaterThan(depthFactor(22));
  });

  it('prices high-gap, high-branching positions above quiet ones', () => {
    const quiet = positionPotential(0, 16, 20, 'opening');
    const sharp = positionPotential(150, 40, 40, 'endgame');
    expect(sharp).toBeGreaterThan(quiet);
    expect(sharp / quiet).toBeGreaterThan(3);
  });

  it('applies phase weights consistently', () => {
    expect(PHASE_SCORE_WEIGHTS.endgame).toBeGreaterThan(PHASE_SCORE_WEIGHTS.middlegame);
    expect(PHASE_SCORE_WEIGHTS.middlegame).toBeGreaterThan(PHASE_SCORE_WEIGHTS.opening);
    expect(positionPotential(50, 30, 30, 'endgame')).toBeGreaterThan(
      positionPotential(50, 30, 30, 'opening'),
    );
  });
});

describe('round scoring', () => {
  it('keeps the full maximum at perfect accuracy and decays superlinearly', () => {
    expect(accuracyQuality(100)).toBeCloseTo(1);
    expect(accuracyQuality(0)).toBe(0);
    expect(pointsForRound(100, 100)).toBe(100);
    expect(pointsForRound(100, 90)).toBeLessThan(100);
    expect(pointsForRound(100, 50)).toBeLessThan(pointsForRound(100, 75));
    expect(pointsForRound(100, 0)).toBe(0);
  });

  it('builds a transparent score breakdown from position inputs', () => {
    const score = buildRoundScore(makePosition({ gapCp: 100, depth: 36 }), 100, 34);
    expect(score.maxPoints).toBe(
      positionPotential(100, 34, 36, 'middlegame'),
    );
    expect(score.points).toBe(score.maxPoints);
    expect(score.difficulty).toBeCloseTo(score.maxPoints / BASE_POSITION_POINTS);
    expect(score.gapCp).toBe(100);
    expect(score.legalMoves).toBe(34);
    expect(score.phaseWeight).toBe(PHASE_SCORE_WEIGHTS.middlegame);
    expect(score.tier.label).toBeTruthy();
  });

  it('gives fewer points for the same accuracy in a quieter position', () => {
    const quiet = buildRoundScore(makePosition({ gapCp: 0 }), 100, 20);
    const sharp = buildRoundScore(makePosition({ gapCp: 150 }), 100, 20);
    expect(sharp.points).toBeGreaterThan(quiet.points);
  });
});

describe('progress and levels', () => {
  it('uses square-root level thresholds', () => {
    expect(levelFromPoints(0).level).toBe(1);
    expect(levelFromPoints(249).level).toBe(1);
    expect(levelFromPoints(250).level).toBe(2);
    expect(levelFromPoints(999).level).toBe(2);
    expect(levelFromPoints(1000).level).toBe(3);
    expect(levelFromPoints(4000).level).toBe(5);
    expect(levelFromPoints(4000).toNext).toBe(2250);
  });

  it('uses stored scores and estimates legacy attempts fairly', () => {
    expect(pointsForAttempt(makeAttempt({ score: 73 }))).toBe(73);
    expect(pointsForAttempt(makeAttempt({ score: undefined, accuracy: 100 }))).toBe(
      Math.round(BASE_POSITION_POINTS * PHASE_SCORE_WEIGHTS.opening),
    );
  });

  it('sums total and per-phase progress', () => {
    const summary = summarizeProgress([
      makeAttempt({ score: 50, phase: 'opening', accuracy: 100 }),
      makeAttempt({ id: 'b', score: 100, phase: 'middlegame', accuracy: 80 }),
      makeAttempt({ id: 'c', score: 25, phase: 'endgame', accuracy: 50 }),
    ]);
    expect(summary.attempts).toBe(3);
    expect(summary.points).toBe(175);
    expect(summary.byPhase.find((item) => item.phase === 'middlegame')?.points).toBe(100);
    expect(summary.byPhase.find((item) => item.phase === 'endgame')?.points).toBe(25);
  });
});
