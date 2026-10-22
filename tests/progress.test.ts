import { describe, expect, it } from 'vitest';
import {
  MAX_SYNC_ATTEMPTS,
  isTrainerSettings,
  isValidUsername,
  mergeAttempts,
  normalizeUsername,
} from '../src/lib/progress';
import type { AttemptRecord } from '../src/lib/storage';

function makeAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    id: 'attempt-1',
    createdAt: '2026-10-22T10:00:00.000Z',
    positionId: 'position-1',
    phase: 'opening',
    mode: 'dual',
    top1: true,
    top2: true,
    top2Overlap: 1,
    orderedTop2: true,
    cpl: 0,
    accuracy: 100,
    classification: 'top1',
    moves: [],
    bestMoveSan: 'e4',
    evalCp: 20,
    ...overrides,
  };
}

describe('profile username normalization', () => {
  it('trims, collapses whitespace and folds case deterministically', () => {
    expect(normalizeUsername('  Ada   Lovelace  ')).toBe('ada lovelace');
    expect(normalizeUsername('YUSUF')).toBe('yusuf');
  });

  it('handles Turkish uppercase letters without leaving combining marks', () => {
    expect(normalizeUsername('İSMAİL')).toBe('ismail');
    expect(isValidUsername('İSMAİL')).toBe(true);
  });

  it('enforces the username length and character set', () => {
    expect(isValidUsername('a')).toBe(false);
    expect(isValidUsername('ab')).toBe(true);
    expect(isValidUsername('x'.repeat(25))).toBe(false);
    expect(isValidUsername('bad/name')).toBe(false);
    expect(isValidUsername('satranç_42')).toBe(true);
  });
});

describe('attempt merging', () => {
  it('unions attempts from two devices and deduplicates by id', () => {
    const remote = makeAttempt({ id: 'a', createdAt: '2026-10-22T10:00:00.000Z', accuracy: 60 });
    const local = makeAttempt({ id: 'a', createdAt: '2026-10-22T10:00:00.000Z', accuracy: 90 });
    const localOnly = makeAttempt({ id: 'b', createdAt: '2026-10-22T11:00:00.000Z' });

    const merged = mergeAttempts([local, localOnly], [remote]);

    expect(merged.map((attempt) => attempt.id)).toEqual(['b', 'a']);
    expect(merged.find((attempt) => attempt.id === 'a')?.accuracy).toBe(90);
  });

  it('keeps the newest attempt for duplicate ids', () => {
    const older = makeAttempt({ id: 'x', createdAt: '2026-10-22T10:00:00.000Z', accuracy: 20 });
    const newer = makeAttempt({ id: 'x', createdAt: '2026-10-22T12:00:00.000Z', accuracy: 80 });

    const merged = mergeAttempts([older], [newer]);

    expect(merged).toHaveLength(1);
    expect(merged[0].accuracy).toBe(80);
  });

  it('drops stale attempts older than the reset tombstone', () => {
    const resetAt = '2026-10-22T12:00:00.000Z';
    const beforeReset = makeAttempt({ id: 'old', createdAt: '2026-10-22T11:59:59.000Z' });
    const afterReset = makeAttempt({ id: 'new', createdAt: '2026-10-22T12:00:01.000Z' });

    const merged = mergeAttempts([beforeReset, afterReset], [], resetAt);

    expect(merged.map((attempt) => attempt.id)).toEqual(['new']);
  });

  it('does not let an unsynced device resurrect cleared history', () => {
    const resetAt = '2026-10-22T12:00:00.000Z';
    const staleDeviceAttempt = makeAttempt({
      id: 'stale',
      createdAt: '2026-10-22T11:00:00.000Z',
    });

    expect(mergeAttempts([staleDeviceAttempt], [], resetAt)).toEqual([]);
  });

  it('caps the merged history at the sync limit', () => {
    const attempts = Array.from({ length: MAX_SYNC_ATTEMPTS + 12 }, (_, index) =>
      makeAttempt({
        id: `attempt-${index}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      }),
    );

    expect(mergeAttempts(attempts, [])).toHaveLength(MAX_SYNC_ATTEMPTS);
  });
});

describe('trainer settings validation', () => {
  it('accepts the supported modes and phases', () => {
    expect(isTrainerSettings({ mode: 'dual', phase: 'all' })).toBe(true);
    expect(isTrainerSettings({ mode: 'single', phase: 'endgame' })).toBe(true);
  });

  it('rejects malformed settings', () => {
    expect(isTrainerSettings({ mode: 'trio', phase: 'all' })).toBe(false);
    expect(isTrainerSettings({ mode: 'single', phase: 'blitz' })).toBe(false);
    expect(isTrainerSettings(null)).toBe(false);
  });
});
