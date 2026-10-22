import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type {
  DatasetManifest,
  Phase,
  PhaseDataset,
  PositionDataset,
} from '../src/lib/types';

const dataDir = fileURLToPath(new URL('../public/data', import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(dataDir, 'manifest.json'), 'utf8'),
) as DatasetManifest;
const phases: Phase[] = ['opening', 'middlegame', 'endgame'];
const phaseFiles = phases.map((phase) => {
  const file = manifest.files[phase];
  return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as PhaseDataset;
});
const dataset: PositionDataset = {
  version: manifest.version,
  generatedAt: manifest.generatedAt,
  month: manifest.month,
  source: manifest.source,
  positionCount: manifest.positionCount,
  phaseCounts: manifest.phaseCounts,
  positions: phaseFiles.flatMap((file) => file.positions),
};

describe('curated position dataset', () => {
  it('matches its declared counts and split files', () => {
    expect(dataset.positions).toHaveLength(dataset.positionCount);
    expect(dataset.positionCount).toBeGreaterThanOrEqual(5000);
    expect(manifest.positionCount).toBe(dataset.positions.length);

    for (const file of phaseFiles) {
      expect(file.positions).toHaveLength(file.positionCount);
      expect(file.positions.every((position) => position.phase === file.phase)).toBe(true);
      expect(file.positionCount).toBe(manifest.phaseCounts[file.phase]);
    }

    const counted = dataset.positions.reduce<Record<string, number>>((acc, position) => {
      acc[position.phase] = (acc[position.phase] ?? 0) + 1;
      return acc;
    }, {});
    expect(counted).toEqual(dataset.phaseCounts);
  });

  it('contains enough middlegame decisions for the trainer', () => {
    expect(dataset.phaseCounts.middlegame ?? 0).toBeGreaterThanOrEqual(1500);
    expect(dataset.phaseCounts.opening ?? 0).toBeGreaterThanOrEqual(1500);
    expect(dataset.phaseCounts.endgame ?? 0).toBeGreaterThanOrEqual(1500);
  });

  it('applies the documented dataset filters', () => {
    for (const position of dataset.positions) {
      expect(position.depth, position.id).toBeGreaterThanOrEqual(22);
      expect(Math.abs(position.evalCp), position.id).toBeLessThanOrEqual(300);
      expect(position.gapCp, position.id).toBeGreaterThanOrEqual(0);
      expect(position.gapCp, position.id).toBeLessThanOrEqual(150);
      expect(position.pvs.length, position.id).toBeGreaterThanOrEqual(3);
      expect(position.fen.split(' '), position.id).toHaveLength(6);
      expect(position.fen.split(' ')[1], position.id).toBe(position.sideToMove);
      for (const pv of position.pvs) {
        expect(pv.mate, `${position.id} ${pv.move}`).toBeNull();
        expect(pv.cp, `${position.id} ${pv.move}`).not.toBeNull();
      }

      // PVs are ordered from the mover's perspective, and gapCp is PV1-PV2.
      const sign = position.sideToMove === 'w' ? 1 : -1;
      for (let index = 1; index < position.pvs.length; index += 1) {
        expect(
          sign * position.pvs[index].cp!,
          `${position.id} PV${index + 1} ordering`,
        ).toBeLessThanOrEqual(sign * position.pvs[index - 1].cp!);
      }
      expect(position.pvs[0].cp, position.id).toBe(position.evalCp);
      expect(
        Math.abs(sign * (position.pvs[0].cp! - position.pvs[1].cp!)),
        `${position.id} gapCp`,
      ).toBe(position.gapCp);
    }
  });

  it('replays every PV legally from its FEN', () => {
    for (const position of dataset.positions) {
      const chess = new Chess(position.fen);
      expect(chess.turn(), position.id).toBe(position.sideToMove);

      for (const pv of position.pvs) {
        const replay = new Chess(position.fen);
        const moves = pv.line.split(/\s+/).filter(Boolean);
        expect(moves[0], `${position.id} ${pv.move}`).toBe(pv.move);
        for (const move of moves) {
          expect(() => replay.move(move), `${position.id} ${pv.move} → ${move}`).not.toThrow();
        }
      }
    }
  }, 180_000);

  it('uses unique ids and FENs', () => {
    expect(new Set(dataset.positions.map((position) => position.id)).size).toBe(
      dataset.positions.length,
    );
    expect(new Set(dataset.positions.map((position) => position.fen)).size).toBe(
      dataset.positions.length,
    );
    // Same board state with different move counters is still a duplicate.
    const states = dataset.positions.map((position) =>
      position.fen.split(' ').slice(0, 4).join(' '),
    );
    expect(new Set(states).size).toBe(dataset.positions.length);
  });
});
