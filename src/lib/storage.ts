import type { Classification, Phase, TrainerMode } from './types';

export interface AttemptMove {
  uci: string;
  san: string;
  rank: number | null;
  accuracy: number;
  cpLoss: number;
  classification: Classification;
}

export interface AttemptRecord {
  id: string;
  createdAt: string;
  positionId: string;
  phase: Phase;
  mode: TrainerMode;
  top1: boolean;
  top2: boolean;
  top2Overlap: number;
  orderedTop2: boolean;
  cpl: number;
  accuracy: number;
  classification: Classification;
  moves: AttemptMove[];
  bestMoveSan: string;
  evalCp: number;
}

export interface TrainerSettings {
  mode: TrainerMode;
  phase: Phase | 'all';
}

const ATTEMPTS_KEY = 'candidate-master:attempts:v1';
const SETTINGS_KEY = 'candidate-master:settings:v1';
const MAX_ATTEMPTS = 400;

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadAttempts(): AttemptRecord[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AttemptRecord =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as AttemptRecord).id === 'string' &&
        typeof (item as AttemptRecord).createdAt === 'string',
    );
  } catch {
    return [];
  }
}

export function saveAttempt(attempt: AttemptRecord): void {
  if (!isBrowser()) return;
  try {
    const attempts = [attempt, ...loadAttempts()].slice(0, MAX_ATTEMPTS);
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
    window.dispatchEvent(new CustomEvent('candidate-master:attempts-changed'));
  } catch {
    // Storage may be full or disabled. Training should never break because of it.
  }
}

export function clearAttempts(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ATTEMPTS_KEY);
  window.dispatchEvent(new CustomEvent('candidate-master:attempts-changed'));
}

export function loadSettings(): TrainerSettings {
  const fallback: TrainerSettings = { mode: 'dual', phase: 'all' };
  if (!isBrowser()) return fallback;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<TrainerSettings>;
    return {
      mode: parsed.mode === 'single' ? 'single' : 'dual',
      phase:
        parsed.phase === 'opening' || parsed.phase === 'middlegame' || parsed.phase === 'endgame'
          ? parsed.phase
          : 'all',
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: TrainerSettings): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

export function makeAttemptId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
