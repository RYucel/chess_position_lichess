import { createChess, formatCp, lineToSan, sideToMove } from './chess-utils';
import type { Classification, Phase, TrainerMode } from './types';

export interface CoachPv {
  move: string;
  san: string;
  evalCp: number;
  lineSan: string[];
  lineUci: string[];
}

export interface CoachUserMove {
  san: string;
  rank: number | null;
  cpLoss: number;
  accuracy: number;
  classification: Classification;
}

export interface CoachInput {
  fen: string;
  phase: Phase;
  mode: TrainerMode;
  bestPvs: CoachPv[];
  userMoves: CoachUserMove[];
}

const PHASE_TEXT: Record<Phase, string> = {
  opening: 'açılış çıkışı',
  middlegame: 'orta oyun',
  endgame: 'oyun sonu',
};

function lineThemes(fen: string, lineUci: string[]): string[] {
  const themes = new Set<string>();
  const chess = createChess(fen);
  for (const uci of lineUci.slice(0, 7)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      if (move.flags.includes('k') || move.flags.includes('q')) themes.add('şah güvenliği');
      if (move.captured) themes.add('materyal ve taktik');
      if (move.san.includes('+') || move.san.includes('#')) themes.add('tempo ve şah baskısı');
      if (['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(move.san.replace(/[+#]/g, ''))) {
        themes.add('merkez kontrolü');
      }
      if (move.piece !== 'p' && !move.captured && !move.san.includes('+')) {
        themes.add('taş aktivitesi');
      }
    } catch {
      break;
    }
  }
  return [...themes].slice(0, 3);
}

function trimmedLine(line: string[], length = 7): string {
  if (!line.length) return '';
  const shown = line.slice(0, length).join(' ');
  return line.length > length ? `${shown}…` : shown;
}

export function buildLocalCoachNote(input: CoachInput): string {
  const { fen, phase, mode, bestPvs, userMoves } = input;
  const best = bestPvs[0];
  const second = bestPvs[1];
  const user = userMoves[0];
  const bullets: string[] = [];

  if (!best) return 'Bu pozisyon için yeterli motor verisi bulunamadı.';

  const themes = lineThemes(fen, best.lineUci);
  const side = sideToMove(fen) === 'w' ? 'beyaz' : 'siyah';
  bullets.push(
    `**Referans plan:** ${side} için motorun ilk tercihi **${best.san}**. Ana devam yolu ${trimmedLine(best.lineSan)}. Bu dizide ${themes.length ? themes.join(', ') : 'taş aktivitesi ve koordinasyon'} öne çıkıyor.`,
  );

  if (!user) {
    bullets.push(
      'Henüz bir aday hamle seçilmedi. Tahtada bir hamleyi işaretlediğinde bu not, seçimin ile PV1/PV2 arasındaki farkı somutlaştıracak.',
    );
  } else if (user.rank === 1) {
    bullets.push(
      `**${user.san}** motorun birinci tercihiyle aynı. Doğru hamleyi buldun; şimdi önemli olan devam planını görmek: ${trimmedLine(best.lineSan, 5)}. Bu tür ${PHASE_TEXT[phase]} pozisyonlarında hamle ezberi yerine planın neden işlediğini takip et.`,
    );
  } else if (user.rank === 2) {
    bullets.push(
      `**${user.san}** motorun ikinci tercihi. Kayıp yaklaşık **${user.cpLoss} cp** ve doğruluk **%${user.accuracy.toFixed(1)}**. Bu, pozisyonun hakkını veren elit bir alternatif; yine de PV1'in ${trimmedLine(best.lineSan, 5)} devamındaki fikirlaşma farkını incele.`,
    );
  } else {
    bullets.push(
      `**${user.san}** kayıtlı ilk iki motor tercihinin dışında. Yaklaşık **${user.cpLoss} cp** ve **%${user.accuracy.toFixed(1)}** doğrulukla değerlendirildi. Bu mutlaka “kötü hamle” demek değil; ancak ${trimmedLine(best.lineSan, 5)} devamındaki plana kıyasla pozisyonun sunduğu bir kaynağı daha az kullanıyor.`,
    );
  }

  if (second) {
    bullets.push(
      `**İkinci aday:** **${second.san}** (${formatCp(second.evalCp)}). Devamı ${trimmedLine(second.lineSan, 5)}. PV1 ile PV2'nin ortak noktası, farklı hamle sıralarıyla da olsa aynı konumsal hedefe yönelmeleri; aday seçerken bu ortak fikri aramak faydalı.`,
    );
  }

  if (mode === 'dual') {
    const overlap = userMoves.filter((move) => move.rank === 1 || move.rank === 2).length;
    bullets.push(
      `**Çift aday disiplini:** Top-2 kümesiyle ${overlap}/2 örtüşme var. Amaç iki farklı hamle ezberlemek değil; biri ana plan, diğeri sağlam yedek olan iki adayı gerekçelendirmek. ${overlap === 2 ? 'Bu turda bu dengeyi yakaladın.' : 'İkinci adayı seçerken PV2’nin hangi riski azalttığını sor.'}`,
    );
  } else {
    bullets.push(
      `**Tek hamle disiplini:** Bu modda ölçüt 0–25 cp aralığında kalmak. ${user && user.cpLoss <= 25 ? 'Seçimin bu eşiğin içinde; pozisyonu bozmadın.' : 'Bir sonraki turda önce en güvenli iki adayı not et, sonra birini oyna.'}`,
    );
  }

  return bullets.join('\n\n');
}

export function buildCoachJson(input: CoachInput): string {
  return JSON.stringify(
    {
      fen: input.fen,
      phase: input.phase,
      mode: input.mode,
      side_to_move: sideToMove(input.fen),
      engine_top_lines: input.bestPvs.map((pv, index) => ({
        rank: index + 1,
        move_san: pv.san,
        move_uci: pv.move,
        eval_cp_white: pv.evalCp,
        continuation_san: pv.lineSan.slice(0, 8),
      })),
      user_moves: input.userMoves.map((move) => ({
        move_san: move.san,
        rank: move.rank,
        cp_loss: Math.round(move.cpLoss),
        accuracy: Number(move.accuracy.toFixed(1)),
        classification: move.classification,
      })),
    },
    null,
    2,
  );
}

export function pvToCoachPv(fen: string, pv: { move: string; line: string; cp: number | null; mate: number | null }): CoachPv {
  return {
    move: pv.move,
    san: lineToSan(fen, pv.move)[0] ?? pv.move,
    evalCp: pv.cp ?? 0,
    lineSan: lineToSan(fen, pv.line),
    lineUci: pv.line.split(/\s+/).filter(Boolean),
  };
}
