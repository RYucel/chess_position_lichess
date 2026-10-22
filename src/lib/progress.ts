import type { AttemptRecord, TrainerSettings } from './storage';

export const SYNC_VERSION = 1;
export const MAX_SYNC_ATTEMPTS = 500;
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 24;

const USERNAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,23}$/u;

export interface SyncedProfile {
  version: typeof SYNC_VERSION;
  username: string;
  displayName: string;
  updatedAt: string;
  resetAt?: string;
  attempts: AttemptRecord[];
  settings?: TrainerSettings;
}

/** Collapse user-entered whitespace without changing the visible spelling. */
export function cleanDisplayName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/** The cloud key is case-insensitive so tablet and phone resolve to one profile. */
export function normalizeUsername(value: string): string {
  return cleanDisplayName(value).normalize('NFKC').toLocaleLowerCase('tr-TR').normalize('NFKC');
}

export function isValidUsername(value: string): boolean {
  const normalized = normalizeUsername(value);
  return (
    normalized.length >= USERNAME_MIN_LENGTH &&
    normalized.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(normalized)
  );
}

export function isAttemptRecord(value: unknown): value is AttemptRecord {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<AttemptRecord>;
  return (
    typeof attempt.id === 'string' &&
    typeof attempt.createdAt === 'string' &&
    typeof attempt.accuracy === 'number' &&
    Number.isFinite(attempt.accuracy) &&
    typeof attempt.phase === 'string' &&
    Array.isArray(attempt.moves)
  );
}

export function isTrainerSettings(value: unknown): value is TrainerSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<TrainerSettings>;
  return (
    (settings.mode === 'dual' || settings.mode === 'single') &&
    (settings.phase === 'all' ||
      settings.phase === 'opening' ||
      settings.phase === 'middlegame' ||
      settings.phase === 'endgame')
  );
}

/**
 * Union attempts from two devices. A reset marker removes older attempts, so a
 * stale offline device cannot resurrect a history that the user cleared.
 */
export function mergeAttempts(
  local: AttemptRecord[],
  remote: AttemptRecord[],
  resetAt?: string | null,
): AttemptRecord[] {
  const cutoff = resetAt ? Date.parse(resetAt) : Number.NaN;
  const byId = new Map<string, AttemptRecord>();

  for (const attempt of [...remote, ...local]) {
    if (!isAttemptRecord(attempt)) continue;
    const createdAt = Date.parse(attempt.createdAt);
    if (!Number.isFinite(createdAt)) continue;
    if (Number.isFinite(cutoff) && createdAt <= cutoff) continue;

    const previous = byId.get(attempt.id);
    if (!previous) {
      byId.set(attempt.id, attempt);
      continue;
    }
    const previousTime = Date.parse(previous.createdAt);
    if (createdAt >= previousTime) byId.set(attempt.id, attempt);
  }

  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_SYNC_ATTEMPTS);
}
