import type { Phase, PositionDataset, PositionRecord } from './types';

let cache: PositionDataset | null = null;

export async function loadPositions(): Promise<PositionDataset> {
  if (cache) return cache;
  const response = await fetch('/data/curated_positions.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Küratörlü pozisyon verisi yüklenemedi.');
  const data = (await response.json()) as PositionDataset;
  if (!Array.isArray(data.positions) || !data.positions.length) {
    throw new Error('Pozisyon veri seti boş.');
  }
  cache = data;
  return data;
}

export function filterByPhase(
  positions: PositionRecord[],
  phase: Phase | 'all',
): PositionRecord[] {
  return phase === 'all' ? positions : positions.filter((position) => position.phase === phase);
}

export function pickRandomPosition(
  positions: PositionRecord[],
  phase: Phase | 'all',
  excludeId?: string,
): PositionRecord | null {
  const pool = filterByPhase(positions, phase);
  if (!pool.length) return null;
  const candidates = pool.length > 1 ? pool.filter((position) => position.id !== excludeId) : pool;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return candidates[random[0] % candidates.length] ?? pool[0];
}
