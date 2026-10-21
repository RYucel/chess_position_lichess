import { describe, expect, it } from 'vitest';
import {
  buildDualEvaluation,
  classifyMove,
  cpToWinProbability,
  evaluateMove,
  toMoverCp,
  winLossToAccuracy,
} from '../src/lib/accuracy';
import type { PositionRecord } from '../src/lib/types';

const position: PositionRecord = {
  id: 'test-1',
  fen: 'rn1qkb1r/1p3ppp/p2pbn2/4p3/4P3/1NN1B3/PPP2PPP/R2QKB1R w KQkq - 2 8',
  phase: 'middlegame',
  sideToMove: 'w',
  pieces: 30,
  evalCp: 20,
  gapCp: 1,
  depth: 52,
  knodes: 27094095,
  pvs: [
    {
      move: 'd1d2',
      line: 'd1d2 b8d7 f2f3 h7h5 c3d5 e6d5 e4d5 g7g6 e1c1 d7b6',
      depth: 52,
      knodes: 27094095,
      cp: 20,
      mate: null,
    },
    {
      move: 'f2f3',
      line: 'f2f3 h7h5 c3d5 e6d5 e4d5 b8d7 d1d2 g7g6 f1e2 d8c7',
      depth: 52,
      knodes: 27094095,
      cp: 19,
      mate: null,
    },
    {
      move: 'h2h3',
      line: 'h2h3 f8e7 f2f4 b8c6 f4f5 e6b3 a2b3 d6d5 e4d5 c6b4',
      depth: 52,
      knodes: 27094095,
      cp: 18,
      mate: null,
    },
  ],
  source: 'lichess-cloud-eval',
  label: 'Sicilian Najdorf',
};

describe('Lichess win probability and accuracy curves', () => {
  it('is 50% at a dead-equal evaluation', () => {
    expect(cpToWinProbability(0)).toBe(50);
  });

  it('is symmetric around zero', () => {
    for (const cp of [25, 100, 350, 900]) {
      expect(cpToWinProbability(cp) + cpToWinProbability(-cp)).toBeCloseTo(100, 6);
    }
  });

  it('gives ~100% accuracy for no win-probability loss', () => {
    // The Lichess constants land at 99.9999 rather than exactly 100.
    expect(winLossToAccuracy(0)).toBeCloseTo(100, 3);
  });

  it('decreases monotonically and never goes below zero', () => {
    let previous = winLossToAccuracy(0);
    for (const loss of [1, 5, 10, 25, 50, 100]) {
      const current = winLossToAccuracy(loss);
      expect(current).toBeLessThanOrEqual(previous);
      expect(current).toBeGreaterThanOrEqual(0);
      previous = current;
    }
  });
});

describe('move evaluation', () => {
  it('rewards PV1 with a perfect score', () => {
    const result = evaluateMove(position, 'd1d2', { san: 'Qd2' });
    expect(result.rank).toBe(1);
    expect(result.deltaCp).toBe(0);
    expect(result.accuracy).toBeCloseTo(100, 3);
    expect(result.classification).toBe('top1');
    expect(result.inDataset).toBe(true);
  });

  it('scores PV2 just below PV1', () => {
    const result = evaluateMove(position, 'f2f3', { san: 'f3' });
    expect(result.rank).toBe(2);
    expect(result.deltaCp).toBe(1);
    expect(result.accuracy).toBeGreaterThan(99);
    expect(result.accuracy).toBeLessThan(100);
    expect(result.classification).toBe('top2');
  });

  it('measures an off-dataset move from its engine cp value', () => {
    const result = evaluateMove(position, 'a2a3', {
      cpWhite: -60,
      source: 'engine',
      san: 'a3',
    });
    expect(result.rank).toBeNull();
    expect(result.deltaCp).toBe(80);
    expect(result.accuracy).toBeLessThan(100);
    expect(result.inDataset).toBe(false);
  });

  it('flips white-perspective cp for a black mover', () => {
    expect(toMoverCp(120, 'w')).toBe(120);
    expect(toMoverCp(120, 'b')).toBe(-120);
  });
});

describe('dual candidate evaluation', () => {
  it('recognises an unordered Top-2 hit', () => {
    const second = evaluateMove(position, 'f2f3', { san: 'f3' });
    const first = evaluateMove(position, 'd1d2', { san: 'Qd2' });
    const result = buildDualEvaluation([second, first]);
    expect(result.unorderedTop2).toBe(true);
    expect(result.orderedTop2).toBe(false);
    expect(result.top2Overlap).toBe(2);
    expect(result.averageCpl).toBe(0.5);
  });

  it('keeps the standard classification thresholds', () => {
    expect(classifyMove(1, 0, 100)).toBe('top1');
    expect(classifyMove(2, 30, 99)).toBe('top2');
    expect(classifyMove(null, 20, 92)).toBe('solid');
    expect(classifyMove(null, 45, 80)).toBe('suboptimal');
    expect(classifyMove(null, 120, 50)).toBe('inaccuracy');
  });
});
