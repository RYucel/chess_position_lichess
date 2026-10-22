import type {
  DatasetManifest,
  Phase,
  PhaseDataset,
  PositionDataset,
  PositionRecord,
} from './types';

const DATA_DIR = '/data';
const PHASES: Phase[] = ['opening', 'middlegame', 'endgame'];

let cache: Promise<PositionDataset> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Veri dosyası yüklenemedi: ${url}`);
  return (await response.json()) as T;
}

export async function loadManifest(): Promise<DatasetManifest> {
  const manifest = await fetchJson<DatasetManifest>(`${DATA_DIR}/manifest.json`);
  if (!manifest.files || !manifest.phaseCounts) {
    throw new Error('Pozisyon manifesti geçersiz.');
  }
  return manifest;
}

export async function loadPositions(): Promise<PositionDataset> {
  if (cache) return cache;

  cache = (async () => {
    const manifest = await loadManifest();
    const phaseFiles = await Promise.all(
      PHASES.map((phase) => {
        const file = manifest.files[phase];
        if (!file) throw new Error(`Manifestte ${phase} dosyası yok.`);
        return fetchJson<PhaseDataset>(`${DATA_DIR}/${file}`);
      }),
    );

    const positions: PositionRecord[] = [];
    for (const file of phaseFiles) {
      if (!Array.isArray(file.positions) || !file.positions.length) {
        throw new Error(`${file.phase} pozisyon verisi boş.`);
      }
      if (file.positionCount !== file.positions.length) {
        throw new Error(`${file.phase} pozisyon sayısı dosyayla uyuşmuyor.`);
      }
      positions.push(...file.positions);
    }

    if (!positions.length) throw new Error('Pozisyon veri seti boş.');
    if (positions.length !== manifest.positionCount) {
      throw new Error('Manifest ve evre dosyalarındaki pozisyon sayısı uyuşmuyor.');
    }

    return {
      version: manifest.version,
      generatedAt: manifest.generatedAt,
      month: manifest.month,
      source: manifest.source,
      positionCount: manifest.positionCount,
      phaseCounts: manifest.phaseCounts,
      positions,
    };
  })();

  try {
    return await cache;
  } catch (error) {
    cache = null;
    throw error;
  }
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
