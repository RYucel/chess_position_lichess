import { mateToCp } from './accuracy';
import type { EngineLine } from './types';
import { normalizeFen, sideToMove } from './chess-utils';

type Waiter = {
  predicate: (line: string) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const ENGINE_URL = '/engine/stockfish.js';
const INIT_TIMEOUT_MS = 25_000;
const SEARCH_TIMEOUT_MS = 15_000;

class StockfishEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private waiters: Waiter[] = [];
  private active:
    | {
        resolve: (line: EngineLine) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
        best: EngineLine | null;
      }
    | null = null;

  status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  lastError: string | null = null;

  onStatusChange?: (status: StockfishEngine['status']) => void;

  private setStatus(status: StockfishEngine['status']) {
    this.status = status;
    this.onStatusChange?.(status);
  }

  async ensureReady(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    if (typeof window === 'undefined') throw new Error('Stockfish yalnızca tarayıcıda çalışır.');

    this.setStatus('loading');
    this.readyPromise = this.initialize().catch((error: unknown) => {
      this.readyPromise = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      this.setStatus('error');
      this.disposeWorker();
      throw error;
    });
    return this.readyPromise;
  }

  private initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(ENGINE_URL);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => this.handleMessage(String(event.data));
      worker.onerror = (event) => {
        const message = event.message || 'Stockfish worker yüklenemedi.';
        this.failAll(new Error(message));
        this.setStatus('error');
      };

      const timer = setTimeout(() => {
        reject(new Error('Stockfish başlatma zaman aşımına uğradı.'));
      }, INIT_TIMEOUT_MS);

      this.waiters.push({
        predicate: (line) => line.includes('uciok'),
        resolve: () => {
          worker.postMessage('setoption name Threads value 1');
          worker.postMessage('setoption name Hash value 32');
          worker.postMessage('setoption name MultiPV value 1');
          worker.postMessage('isready');
          this.waiters.push({
            predicate: (line) => line.includes('readyok'),
            resolve: () => {
              clearTimeout(timer);
              this.setStatus('ready');
              resolve();
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
            timer: setTimeout(() => reject(new Error('Stockfish hazır yanıtı gelmedi.')), INIT_TIMEOUT_MS),
          });
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
      worker.postMessage('uci');
    });
  }

  private handleMessage(line: string) {
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(line)) {
        clearTimeout(waiter.timer);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        waiter.resolve();
      }
    }

    if (!this.active) return;

    if (line.startsWith('info ') && line.includes('score ')) {
      const depthMatch = line.match(/\bdepth (\d+)/);
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      if (!scoreMatch) return;
      const depth = Number(depthMatch?.[1] ?? 0);
      if (this.active.best && depth < this.active.best.depth) return;

      const kind = scoreMatch[1];
      const raw = Number(scoreMatch[2]);
      const turn = sideToMove(this.activeFen);
      const cpMover = kind === 'cp' ? raw : mateToCp(raw);
      const mateMover = kind === 'mate' ? raw : null;
      const pvMatch = line.match(/\bpv (.+)$/);

      this.active.best = {
        cpMover,
        cpWhite: turn === 'w' ? cpMover : -cpMover,
        mate: mateMover === null ? null : turn === 'w' ? mateMover : -mateMover,
        depth,
        pv: pvMatch?.[1] ?? '',
      };
      return;
    }

    if (line.startsWith('bestmove')) {
      clearTimeout(this.active.timer);
      const active = this.active;
      this.active = null;
      if (active.best) active.resolve(active.best);
      else active.reject(new Error('Motor bu hamle için değerlendirme üretemedi.'));
    }
  }

  private activeFen = '';

  async evaluateMove(fen: string, uci: string, depth = 18): Promise<EngineLine> {
    await this.ensureReady();
    if (!this.worker) throw new Error('Motor başlatılamadı.');

    if (this.active) {
      this.worker.postMessage('stop');
      clearTimeout(this.active.timer);
      this.active.reject(new Error('Yeni analiz istendi.'));
      this.active = null;
    }

    this.activeFen = normalizeFen(fen);
    return new Promise<EngineLine>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.active) return;
        this.worker?.postMessage('stop');
        this.active = null;
        reject(new Error('Motor analizi zaman aşımına uğradı.'));
      }, SEARCH_TIMEOUT_MS);

      this.active = { resolve, reject, timer, best: null };
      this.worker?.postMessage(`position fen ${this.activeFen}`);
      this.worker?.postMessage(`go depth ${depth} searchmoves ${uci}`);
    });
  }

  private failAll(error: Error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.reject(error);
      this.active = null;
    }
  }

  private disposeWorker() {
    this.worker?.terminate();
    this.worker = null;
  }

  dispose() {
    this.failAll(new Error('Motor kapatıldı.'));
    this.disposeWorker();
    this.readyPromise = null;
    this.setStatus('idle');
  }
}

let singleton: StockfishEngine | null = null;

export function getStockfish(): StockfishEngine {
  if (!singleton) singleton = new StockfishEngine();
  return singleton;
}
