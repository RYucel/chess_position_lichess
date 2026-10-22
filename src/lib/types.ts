export type Phase = 'opening' | 'middlegame' | 'endgame';
export type TrainerMode = 'dual' | 'single';
export type EvalSource = 'dataset' | 'engine' | 'estimate';

export type Classification =
  | 'top1'
  | 'top2'
  | 'solid'
  | 'suboptimal'
  | 'inaccuracy';

export interface Pv {
  move: string;
  line: string;
  depth: number;
  knodes: number;
  cp: number | null;
  mate: number | null;
}

export interface PositionRecord {
  id: string;
  fen: string;
  phase: Phase;
  sideToMove: 'w' | 'b';
  pieces: number;
  evalCp: number;
  gapCp: number;
  depth: number;
  knodes: number;
  pvs: Pv[];
  source: 'lichess-cloud-eval' | 'lichess-position-evaluations';
  label: string;
}

export interface PositionDataset {
  version: number;
  generatedAt: string;
  month?: string;
  source: string;
  positionCount: number;
  phaseCounts: Partial<Record<Phase, number>>;
  positions: PositionRecord[];
}

export interface DatasetManifest {
  version: number;
  generatedAt: string;
  month: string;
  source: string;
  positionCount: number;
  phaseCounts: Partial<Record<Phase, number>>;
  files: Record<Phase, string>;
  refresh?: {
    month: string;
    shardStart: number;
    scanLimit: number;
    seed: number;
    total: number;
  };
}

export interface PhaseDataset {
  version: number;
  generatedAt: string;
  phase: Phase;
  positionCount: number;
  positions: PositionRecord[];
}

export interface MoveEvaluation {
  uci: string;
  san: string;
  rank: number | null;
  cpWhite: number;
  cpMover: number;
  mate: number | null;
  deltaCp: number;
  winBefore: number;
  winAfter: number;
  deltaWin: number;
  accuracy: number;
  classification: Classification;
  source: EvalSource;
  inDataset: boolean;
}

export interface DualEvaluation {
  moves: MoveEvaluation[];
  primary: MoveEvaluation;
  secondary: MoveEvaluation | null;
  orderedTop2: boolean;
  unorderedTop2: boolean;
  top2Overlap: number;
  averageAccuracy: number;
  averageCpl: number;
}

export interface EngineLine {
  cpWhite: number;
  cpMover: number;
  mate: number | null;
  depth: number;
  pv: string;
}

export interface PreviewState {
  pvIndex: number;
  label: string;
  lineSan: string[];
  lineUci: string[];
  frames: string[];
  ply: number;
  color: string;
}
