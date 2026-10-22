'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Move } from 'chess.js';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarDays,
  Crosshair,
  Database,
  Dices,
  Layers,
  RotateCw,
  Sigma,
  Target,
  Trophy,
} from 'lucide-react';
import { TrainerBoard, type BoardCandidate } from './TrainerBoard';
import { CandidateSelector, type Candidate } from './CandidateSelector';
import { EvaluationReveal, type CoachState } from './EvaluationReveal';
import { VariationExplorer } from './VariationExplorer';
import { buildDualEvaluation, evaluateMove, findPv } from '@/lib/accuracy';
import {
  buildLineFrames,
  createChess,
  phaseLabel,
  sanFromUciSafe,
  uciFromMove,
} from '@/lib/chess-utils';
import { buildLocalCoachNote, pvToCoachPv } from '@/lib/coach';
import { loadPositions, pickRandomPosition } from '@/lib/positions';
import { buildRoundScore, summarizeProgress, type RoundScore } from '@/lib/scoring';
import { estimateAfterMove } from '@/lib/staticEval';
import { getStockfish } from '@/lib/stockfishWorker';
import {
  loadAttempts,
  loadSettings,
  makeAttemptId,
  saveAttempt,
  saveSettings,
} from '@/lib/storage';
import type {
  DualEvaluation,
  MoveEvaluation,
  Phase,
  PositionDataset,
  PositionRecord,
  PreviewState,
  TrainerMode,
} from '@/lib/types';
import { cn } from '@/lib/cn';

const EMPTY_CANDIDATES: Array<Candidate | null> = [null, null];
const PHASES: Array<{ value: Phase | 'all'; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'opening', label: 'Açılış' },
  { value: 'middlegame', label: 'Orta oyun' },
  { value: 'endgame', label: 'Oyun sonu' },
];

export function TrainerShell() {
  const [dataset, setDataset] = useState<PositionDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [position, setPosition] = useState<PositionRecord | null>(null);
  const [phase, setPhase] = useState<Phase | 'all'>('all');
  const [mode, setMode] = useState<TrainerMode>('dual');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [candidates, setCandidates] = useState<Array<Candidate | null>>(EMPTY_CANDIDATES);
  const [activeSlot, setActiveSlot] = useState(0);
  const [analysis, setAnalysis] = useState<DualEvaluation | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [coach, setCoach] = useState<CoachState | null>(null);
  const [roundScore, setRoundScore] = useState<RoundScore | null>(null);
  const [progress, setProgress] = useState(() => summarizeProgress([]));

  useEffect(() => {
    let cancelled = false;
    const settings = loadSettings();
    setMode(settings.mode);
    setPhase(settings.phase);
    setCandidates(settings.mode === 'dual' ? [null, null] : [null]);

    loadPositions()
      .then((data) => {
        if (cancelled) return;
        setDataset(data);
        const first =
          pickRandomPosition(data.positions, settings.phase) ?? data.positions[0] ?? null;
        if (first) {
          setPosition(first);
          setOrientation(first.sideToMove === 'w' ? 'white' : 'black');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Veri yüklenemedi.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const engine = getStockfish();
    engine.onStatusChange = (status) => setEngineStatus(status);
    setEngineStatus(engine.status);
    return () => {
      engine.onStatusChange = undefined;
    };
  }, []);

  useEffect(() => {
    const refresh = () => setProgress(summarizeProgress(loadAttempts()));
    refresh();
    window.addEventListener('candidate-master:attempts-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('candidate-master:attempts-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const applyPosition = (next: PositionRecord) => {
    setPosition(next);
    setOrientation(next.sideToMove === 'w' ? 'white' : 'black');
    setCandidates(mode === 'dual' ? [null, null] : [null]);
    setActiveSlot(0);
    setAnalysis(null);
    setAnalyzing(false);
    setPreview(null);
    setCoach(null);
    setRoundScore(null);
    setNotice(null);
  };

  const newPosition = () => {
    if (!dataset) return;
    const next = pickRandomPosition(dataset.positions, phase, position?.id);
    if (next) applyPosition(next);
  };

  const changePhase = (nextPhase: Phase | 'all') => {
    setPhase(nextPhase);
    saveSettings({ mode, phase: nextPhase });
    setRoundScore(null);
    if (!dataset) return;
    const next = pickRandomPosition(dataset.positions, nextPhase, position?.id);
    if (next) applyPosition(next);
  };

  const changeMode = (nextMode: TrainerMode) => {
    setMode(nextMode);
    saveSettings({ mode: nextMode, phase });
    setCandidates(nextMode === 'dual' ? [null, null] : [null]);
    setActiveSlot(0);
    setAnalysis(null);
    setPreview(null);
    setCoach(null);
    setRoundScore(null);
    setNotice(null);
  };

  const handleAttempt = (from: string, to: string) => {
    if (!position || analysis) return;
    const chess = createChess(position.fen);
    let move: Move | undefined;
    try {
      const matches = chess.moves({ verbose: true }).filter((item) => item.from === from && item.to === to);
      move = matches.find((item) => item.promotion === 'q') ?? matches[0];
    } catch {
      move = undefined;
    }
    if (!move) {
      setNotice('Bu hamle bu pozisyonda oynanamıyor. Kendi taşını seçip yasal bir kareye bırak.');
      return;
    }

    const uci = uciFromMove(move);
    const slotCount = mode === 'dual' ? 2 : 1;
    const slot = Math.min(activeSlot, slotCount - 1);
    const duplicateIndex = candidates.findIndex(
      (candidate, index) => index !== slot && candidate?.uci === uci,
    );
    if (duplicateIndex !== -1) {
      setNotice(
        `Bu hamle zaten ${duplicateIndex + 1}. adayda. İki farklı fikir seçmek için başka bir hamle dene.`,
      );
      setActiveSlot(duplicateIndex);
      return;
    }

    const next = [...candidates];
    next[slot] = { uci, san: move.san };
    setCandidates(next);
    setNotice(null);
    setAnalysis(null);
    setCoach(null);
    setPreview(null);
    setRoundScore(null);

    if (mode === 'dual') {
      const other = slot === 0 ? 1 : 0;
      if (!next[other]) setActiveSlot(other);
    }
  };

  const removeCandidate = (slot: number) => {
    const next = [...candidates];
    next[slot] = null;
    setCandidates(next);
    setActiveSlot(slot);
    setAnalysis(null);
    setCoach(null);
    setPreview(null);
    setRoundScore(null);
    setNotice(null);
  };

  const clearCandidates = () => {
    setCandidates(mode === 'dual' ? [null, null] : [null]);
    setActiveSlot(0);
    setAnalysis(null);
    setCoach(null);
    setPreview(null);
    setRoundScore(null);
    setNotice(null);
  };

  const analyze = async () => {
    if (!position || analyzing) return;
    const selected = candidates.filter((candidate): candidate is Candidate => Boolean(candidate));
    const required = mode === 'dual' ? 2 : 1;
    if (selected.length < required) {
      setNotice(mode === 'dual' ? 'Karşılaştırma için iki aday da seçilmeli.' : 'Önce bir hamle seç.');
      return;
    }

    setAnalyzing(true);
    setNotice(null);
    setPreview(null);
    setCoach(null);
    setRoundScore(null);

    try {
      const evaluations: MoveEvaluation[] = [];
      for (const candidate of selected) {
        const found = findPv(position, candidate.uci);
        if (found) {
          evaluations.push(
            evaluateMove(position, candidate.uci, { san: candidate.san, source: 'dataset' }),
          );
          continue;
        }

        try {
          const line = await getStockfish().evaluateMove(position.fen, candidate.uci, 18);
          evaluations.push(
            evaluateMove(position, candidate.uci, {
              cpWhite: line.cpWhite,
              mate: line.mate,
              source: 'engine',
              san: candidate.san,
            }),
          );
        } catch {
          const estimate = estimateAfterMove(position.fen, candidate.uci);
          evaluations.push(
            evaluateMove(position, candidate.uci, {
              cpWhite: estimate.cpWhite,
              mate: estimate.mate,
              source: 'estimate',
              san: candidate.san,
            }),
          );
        }
      }

      const result = buildDualEvaluation(evaluations);
      setAnalysis(result);
      const scored = buildRoundScore(position, result.averageAccuracy);
      setRoundScore(scored);

      const primary = result.primary;
      saveAttempt({
        id: makeAttemptId(),
        createdAt: new Date().toISOString(),
        positionId: position.id,
        phase: position.phase,
        mode,
        top1: primary.rank === 1,
        top2:
          mode === 'dual'
            ? result.unorderedTop2
            : primary.rank === 1 || primary.rank === 2,
        top2Overlap:
          mode === 'dual' ? result.top2Overlap : primary.rank === 1 || primary.rank === 2 ? 1 : 0,
        orderedTop2: mode === 'dual' ? result.orderedTop2 : false,
        cpl: result.averageCpl,
        accuracy: result.averageAccuracy,
        classification: primary.classification,
        score: scored.points,
        maxScore: scored.maxPoints,
        difficulty: scored.difficulty,
        legalMoves: scored.legalMoves,
        moves: result.moves.map((move) => ({
          uci: move.uci,
          san: move.san,
          rank: move.rank,
          accuracy: move.accuracy,
          cpLoss: move.deltaCp,
          classification: move.classification,
        })),
        bestMoveSan: sanFromUciSafe(position.fen, position.pvs[0].move),
        evalCp: position.evalCp,
      });
    } catch {
      setNotice('Analiz tamamlanamadı. Lütfen adayları koruyup yeniden dene.');
    } finally {
      setAnalyzing(false);
    }
  };

  const showPv = (index: number) => {
    if (!position) return;
    const pv = position.pvs[index];
    if (!pv) return;
    const frames = buildLineFrames(position.fen, pv.line);
    if (!frames.sans.length) return;
    const colors = ['#34d399', '#a3e635', '#94a3b8'];
    setPreview({
      pvIndex: index,
      label: `PV${index + 1} · ${frames.sans[0]}`,
      lineSan: frames.sans,
      lineUci: frames.ucis,
      frames: frames.frames,
      ply: 1,
      color: colors[index] ?? '#94a3b8',
    });
  };

  const showMove = (uci: string) => {
    if (!position) return;
    const frames = buildLineFrames(position.fen, uci);
    if (!frames.sans.length) return;
    const slot = candidates.findIndex((candidate) => candidate?.uci === uci);
    setPreview({
      pvIndex: -1,
      label: `Senin hamlen · ${frames.sans[0]}`,
      lineSan: frames.sans,
      lineUci: frames.ucis,
      frames: frames.frames,
      ply: 1,
      color: slot === 1 ? '#fb923c' : '#60a5fa',
    });
  };

  const askCoach = async () => {
    if (!position || !analysis) return;
    setCoach({ text: '', source: 'local', loading: true });

    try {
      const response = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: position.fen,
          phase: position.phase,
          mode,
          pvs: position.pvs.map((pv) => ({
            move: pv.move,
            line: pv.line,
            cp: pv.cp,
            mate: pv.mate,
          })),
          userMoves: analysis.moves.map((move) => ({
            uci: move.uci,
            cpWhite: move.cpWhite,
          })),
        }),
      });

      if (!response.ok) throw new Error('Coach request failed');
      const payload = (await response.json()) as {
        explanation?: string;
        source?: 'openrouter' | 'deepseek' | 'local';
        model?: string;
      };
      if (!payload.explanation) throw new Error('Empty coach response');
      setCoach({
        text: payload.explanation,
        source: payload.source ?? 'local',
        model: payload.model,
        error: null,
      });
    } catch {
      const local = buildLocalCoachNote({
        fen: position.fen,
        phase: position.phase,
        mode,
        bestPvs: position.pvs.slice(0, 3).map((pv) => pvToCoachPv(position.fen, pv)),
        userMoves: analysis.moves.map((move) => ({
          san: move.san,
          rank: move.rank,
          cpLoss: move.deltaCp,
          accuracy: move.accuracy,
          classification: move.classification,
        })),
      });
      setCoach({
        text: local,
        source: 'local',
        error: 'AI servisine ulaşılamadı; yerel koç notu gösteriliyor.',
      });
    }
  };

  const retry = () => {
    setAnalysis(null);
    setCoach(null);
    setPreview(null);
    setRoundScore(null);
    setNotice(null);
    setActiveSlot(0);
  };

  const previewLastMove = useMemo(() => {
    if (!preview || preview.ply === 0) return null;
    const uci = preview.lineUci[preview.ply - 1];
    if (!uci) return null;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  }, [preview]);

  const boardCandidates: BoardCandidate[] = useMemo(
    () =>
      preview
        ? []
        : candidates.flatMap((candidate, slot) =>
            candidate ? [{ uci: candidate.uci, slot }] : [],
          ),
    [candidates, preview],
  );

  const selectedCandidates = candidates.filter(
    (candidate): candidate is Candidate => Boolean(candidate),
  );
  const canAnalyze = mode === 'dual' ? selectedCandidates.length === 2 : selectedCandidates.length === 1;
  const phaseCounts = dataset?.phaseCounts;
  const sourceLabel = analysis
    ? analysis.moves.some((move) => move.source === 'estimate')
      ? 'Kısmen yaklaşık değerlendirme'
      : analysis.moves.some((move) => move.source === 'engine')
        ? 'Stockfish canlı analiz'
        : 'Lichess derin veri seti'
    : null;
  return (
    <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 sm:pt-9 lg:px-8">
      <section className="mb-6 flex flex-col gap-5 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="eyebrow flex items-center gap-2">
            <span className="h-px w-7 bg-emerald-400/60" />
            Konumsal karar antrenmanı
          </div>
          <h1 className="mt-3 text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.035em] text-stone-50 sm:text-5xl">
            Doğru hamleyi değil,
            <br className="hidden sm:block" /> <span className="text-emerald-300">doğru iki adayı</span> ara.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-400">
            Tuzak avı yok. Doğal, dengeli pozisyonlarda en güçlü iki fikri bul; seçimin
            centipawn kaybı, doğruluk ve zorluk ağırlıklı puanla ölçülsün.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="chip border-white/[0.08]">
            <Database className="h-3 w-3 text-emerald-300" />
            {dataset ? `${dataset.positionCount} doğal pozisyon` : 'Veri yükleniyor'}
          </span>
          {dataset?.month && (
            <span className="chip border-white/[0.08]">
              <CalendarDays className="h-3 w-3 text-violet-300" />
              {dataset.month} seti
            </span>
          )}
          <span className="chip border-white/[0.08]">
            <Layers className="h-3 w-3 text-sky-300" />
            MultiPV 3–4
          </span>
          <span className="chip border-white/[0.08]">
            <Trophy className="h-3 w-3 text-amber-300" />
            Seviye {progress.level.level} · {progress.points} puan
          </span>
          <span className="chip border-white/[0.08]">
            <Target className="h-3 w-3 text-orange-300" />
            {progress.attempts} kayıtlı tur
          </span>
        </div>
      </section>

      {loadError ? (
        <div className="panel p-8 text-center">
          <AlertTriangle className="mx-auto h-6 w-6 text-amber-300" />
          <h2 className="mt-3 font-display text-lg font-semibold">Veri seti yüklenemedi</h2>
          <p className="mt-1 text-xs text-stone-500">{loadError}</p>
          <button type="button" className="btn-secondary mt-4" onClick={() => window.location.reload()}>
            <RotateCw className="h-3.5 w-3.5" /> Tekrar dene
          </button>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,560px)_minmax(0,480px)] xl:justify-center xl:gap-5">
          <div className="mx-auto w-full max-w-[560px] space-y-3 xl:sticky xl:top-[84px]">
            <TrainerBoard
              position={position}
              orientation={orientation}
              candidates={boardCandidates}
              previewFen={preview ? preview.frames[preview.ply] : null}
              previewLastMove={previewLastMove}
              revealed={Boolean(analysis)}
              disabled={Boolean(analysis)}
              onMove={handleAttempt}
              onFlip={() => setOrientation((value) => (value === 'white' ? 'black' : 'white'))}
            />

            <VariationExplorer
              preview={preview}
              onStep={(ply) =>
                setPreview((current) =>
                  current
                    ? { ...current, ply: Math.max(0, Math.min(current.lineSan.length, ply)) }
                    : current,
                )
              }
              onClose={() => setPreview(null)}
            />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[10px] text-stone-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Kayıtlı PV varsa anında, yoksa Stockfish 19 ile
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ArrowLeftRight className="h-3 w-3" />
                Tıkla–tıkla veya sürükle–bırak
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
                <div className="flex rounded-lg border border-white/[0.08] bg-black/20 p-0.5">
                  {(['dual', 'single'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => changeMode(value)}
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-[10.5px] font-semibold transition',
                        mode === value
                          ? 'bg-white/[0.09] text-stone-100 shadow-sm'
                          : 'text-stone-500 hover:text-stone-300',
                      )}
                    >
                      {value === 'dual' ? 'Çift aday' : 'Tek hamle'}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={newPosition}
                    disabled={!dataset}
                    className="btn-ghost px-2 py-1.5 text-[10.5px]"
                  >
                    <Dices className="h-3.5 w-3.5" /> Yeni pozisyon
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
                {PHASES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => changePhase(item.value)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[10px] font-medium transition',
                      phase === item.value
                        ? 'border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200'
                        : 'border-white/[0.07] text-stone-500 hover:border-white/[0.14] hover:text-stone-300',
                    )}
                  >
                    {item.label}
                    {dataset && item.value !== 'all' && (
                      <span className="ml-1.5 font-mono text-[9px] text-stone-600">
                        {phaseCounts?.[item.value] ?? 0}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="p-4 sm:p-5">
                <div className="mb-4 rounded-xl border border-white/[0.07] bg-[linear-gradient(135deg,rgba(52,211,153,0.06),rgba(251,146,60,0.035))] px-3.5 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300">
                      <Crosshair className="h-3.5 w-3.5" />
                    </span>
                    <div>
                      <div className="text-[11px] font-semibold text-stone-200">
                        {mode === 'dual'
                          ? 'Burada kazanmak zorunda değilsin.'
                          : 'Tek hamlede pozisyonu koru.'}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-5 text-stone-400">
                        {mode === 'dual'
                          ? 'Pozisyonun hakkını veren en güçlü iki adayı belirle. Biri ana plan, diğeri sağlam yedek olsun.'
                          : 'Motorun ilk iki tercihinden birini bul veya 0–25 cp kayıp aralığında kal.'}
                      </p>
                    </div>
                  </div>
                </div>

                {!position && !loadError ? (
                  <div className="space-y-3">
                    <div className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
                    <div className="h-16 animate-pulse rounded-xl bg-white/[0.035]" />
                    <div className="h-10 animate-pulse rounded-xl bg-emerald-400/[0.06]" />
                  </div>
                ) : analysis ? (
                  <EvaluationReveal
                    position={position!}
                    analysis={analysis}
                    mode={mode}
                    coach={coach}
                    roundScore={roundScore}
                    onAskCoach={askCoach}
                    onPreviewPv={showPv}
                    onPreviewMove={showMove}
                    onRetry={retry}
                    onNext={newPosition}
                  />
                ) : (
                  <CandidateSelector
                    mode={mode}
                    candidates={candidates}
                    activeSlot={activeSlot}
                    analyzing={analyzing}
                    canAnalyze={canAnalyze}
                    onActivateSlot={setActiveSlot}
                    onRemove={removeCandidate}
                    onClear={clearCandidates}
                    onAnalyze={analyze}
                    notice={notice}
                  />
                )}

                {position && (
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[0.06] pt-3 text-[9.5px] text-stone-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          engineStatus === 'ready'
                            ? 'bg-emerald-400'
                            : engineStatus === 'loading'
                              ? 'bg-amber-400 animate-pulseSoft'
                              : engineStatus === 'error'
                                ? 'bg-rose-400'
                                : 'bg-stone-600',
                        )}
                      />
                      {engineStatus === 'ready'
                        ? 'Stockfish 19 hazır'
                        : engineStatus === 'loading'
                          ? 'Stockfish 19 yükleniyor'
                          : engineStatus === 'error'
                            ? 'Stockfish çevrimdışı'
                            : 'Stockfish talep üzerine'}
                    </span>
                    {sourceLabel && <span>{sourceLabel}</span>}
                    <span className="ml-auto">
                      {phaseLabel(position.phase)} · {position.pvs.length} PV · d{position.depth}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="panel grid grid-cols-3 divide-x divide-white/[0.06] overflow-hidden text-center">
              <div className="px-3 py-3">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-stone-600">
                  Doğal filtre
                </div>
                <div className="mt-1 font-display text-sm font-semibold text-stone-200">Mate yok</div>
              </div>
              <div className="px-3 py-3">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-stone-600">
                  PV1–PV2 farkı
                </div>
                <div className="mt-1 font-display text-sm font-semibold text-stone-200">≤ 150 cp</div>
              </div>
              <div className="px-3 py-3">
                <div className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-stone-600">
                  Değerlendirme
                </div>
                <div className="mt-1 font-display text-sm font-semibold text-stone-200">±3.00</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <section id="method" className="mt-14 scroll-mt-24 border-t border-white/[0.06] pt-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="eyebrow">Yöntem</div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-stone-100">
              Neden bulmaca değil, karar antrenmanı?
            </h2>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-stone-400">
              Taktik bulmacalar tek bir zorunlu kazanç yolu üretir. CandidateMaster ise
              gerçek oyundan gelen sakin pozisyonlarda iki güçlü fikri karşılaştırmayı öğretir.
            </p>
          </div>
          <a
            href="https://huggingface.co/datasets/Lichess/chess-position-evaluations"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary w-fit text-xs"
          >
            <Database className="h-3.5 w-3.5" /> Veri setini incele
          </a>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            {
              icon: Database,
              title: 'Doğal pozisyon havuzu',
              body: 'Lichess değerlendirmelerinden depth ≥ 22, en az 3 aday ve mate içermeyen pozisyonlar seçilir. PV1–PV2 farkı 150 cp’yi aşarsa pozisyon “tek hamlelik taktik” sayılıp elenir.',
              color: 'text-emerald-300 border-emerald-400/20 bg-emerald-400/[0.06]',
            },
            {
              icon: Crosshair,
              title: 'İki aday disiplini',
              body: 'Birincil tercih PV1 ile, alternatif tercih PV2 ile kıyaslanır. Amaç tek “mucize” hamle ezberi değil; ana planı ve ona yakın sağlam yedeği birlikte görmektir.',
              color: 'text-sky-300 border-sky-400/20 bg-sky-400/[0.06]',
            },
            {
              icon: Sigma,
              title: 'Göreli kalite ölçümü',
              body: 'Kaba cp farkı yerine Lichess Win% ve Accuracy eğrileri kullanılır. Böylece +4.00’den +3.90’a düşmek ile +0.20’den −0.30’a düşmek aynı kefeye konmaz.',
              color: 'text-orange-300 border-orange-400/20 bg-orange-400/[0.06]',
            },
          ].map((card) => (
            <div key={card.title} className="panel-inset p-4">
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg border', card.color)}>
                <card.icon className="h-4 w-4" />
              </span>
              <h3 className="mt-3 font-display text-sm font-semibold text-stone-100">{card.title}</h3>
              <p className="mt-1.5 text-[11px] leading-5 text-stone-400">{card.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 panel-inset flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
          <div className="eyebrow shrink-0">Formül</div>
          <code className="overflow-x-auto whitespace-nowrap font-mono text-[10px] text-stone-400">
            Win% = 50 + 50 × (2 / (1 + e<sup>−0.00368208 × cp</sup>) − 1)
          </code>
          <span className="hidden h-4 w-px bg-white/10 sm:block" />
          <code className="overflow-x-auto whitespace-nowrap font-mono text-[10px] text-stone-400">
            Accuracy = 103.1668 × e<sup>−0.04354 × ΔWin%</sup> − 3.1669
          </code>
        </div>
      </section>

      <footer className="mt-12 flex flex-col gap-2 border-t border-white/[0.06] pt-5 text-[10px] text-stone-600 sm:flex-row sm:items-center sm:justify-between">
        <span>
          CandidateMaster · Eğitim amaçlı konumsal karar aracı. Değerlendirmeler beyaz
          perspektifindedir.
        </span>
        <span className="font-mono">Lichess verisi · Stockfish 19 Lite · MiniMax koç</span>
      </footer>
    </main>
  );
}
