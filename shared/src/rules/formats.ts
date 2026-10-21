/**
 * Competition formats: set system, cumulative matches, ranking rounds and the
 * single-arrow shoot-off. Pure functions with no timers, so the client and the
 * authoritative server can run exactly the same code.
 */

import { compareShootOff } from './scoring';
import { getFormat, rules } from './index';
import type { ArrowScore, FormatRules } from '../types';

/* ------------------------------------------------------------------ */
/* Ranking round                                                       */
/* ------------------------------------------------------------------ */

export interface RankingEntry {
  archerId: string;
  name: string;
  total: number;
  xCount: number;
  tenCount: number;
  arrowsShot: number;
  ends: number[];
}

/**
 * Sort ranking entries by total score, then X count, then 10 count
 * (rules.scoring.tieBreakers). Returns a new array; the input is untouched.
 */
export function seedRanking(entries: RankingEntry[]): RankingEntry[] {
  const tieBreakers = rules.scoring.tieBreakers;
  return entries.slice().sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    for (const breaker of tieBreakers) {
      if (breaker === 'xCount' && b.xCount !== a.xCount) return b.xCount - a.xCount;
      if (breaker === 'tenCount' && b.tenCount !== a.tenCount) return b.tenCount - a.tenCount;
    }
    // Deterministic fallback so brackets are reproducible.
    return a.archerId.localeCompare(b.archerId);
  });
}

/** A ranking round is complete when every archer has shot the full arrow count. */
export function isRankingComplete(entries: RankingEntry[], formatId = 'rankingRound'): boolean {
  const format = getFormat(formatId);
  return entries.every((e) => e.arrowsShot >= (format.maxArrows ?? Infinity));
}

/* ------------------------------------------------------------------ */
/* Set system (recurve / barebow matches)                              */
/* ------------------------------------------------------------------ */

export interface SetRecord {
  setNumber: number;
  scores: [number, number];
  points: [number, number];
  xCounts: [number, number];
}

export interface SetSystemState {
  formatId: string;
  arrowsPerSet: number;
  setPointsToWin: number;
  drawPoints: number;
  /** Maximum sets before a shoot-off (5 in the Olympic set system). */
  maxSets: number;
  sets: SetRecord[];
  points: [number, number];
  winner: 0 | 1 | null;
  needsShootOff: boolean;
  finished: boolean;
}

export function createSetSystem(formatId = 'recurveMatch'): SetSystemState {
  const format: FormatRules = getFormat(formatId);
  return {
    formatId,
    arrowsPerSet: format.arrowsPerEnd,
    setPointsToWin: format.setPointsToWin ?? 6,
    drawPoints: format.setPointsDraw ?? 1,
    maxSets: format.ends,
    sets: [],
    points: [0, 0],
    winner: null,
    needsShootOff: false,
    finished: false,
  };
}

/**
 * Register one completed set. Both archers shoot `arrowsPerSet` arrows; the
 * higher set total earns 2 set points, a tie earns `drawPoints` each.
 * First to `setPointsToWin` wins; if the sets run out level, a shoot-off decides.
 */
export function applySet(
  state: SetSystemState,
  scores: [number, number],
  xCounts: [number, number] = [0, 0],
): SetSystemState {
  if (state.finished) return state;

  const points: [number, number] =
    scores[0] > scores[1] ? [2, 0] : scores[0] < scores[1] ? [0, 2] : [state.drawPoints, state.drawPoints];

  const sets = [
    ...state.sets,
    { setNumber: state.sets.length + 1, scores, points, xCounts } as SetRecord,
  ];
  const total: [number, number] = [state.points[0] + points[0], state.points[1] + points[1]];

  let winner: 0 | 1 | null = null;
  if (total[0] >= state.setPointsToWin && total[0] > total[1]) winner = 0;
  else if (total[1] >= state.setPointsToWin && total[1] > total[0]) winner = 1;

  // A maximum of `maxSets` sets is shot (5 x 3 arrows); level after that is a
  // single-arrow shoot-off.
  const setsExhausted = sets.length >= state.maxSets;
  const needsShootOff = winner === null && setsExhausted && total[0] === total[1];

  return {
    ...state,
    sets,
    points: total,
    winner,
    needsShootOff,
    finished: winner !== null || needsShootOff,
  };
}

/* ------------------------------------------------------------------ */
/* Cumulative matches (compound)                                       */
/* ------------------------------------------------------------------ */

export interface CumulativeState {
  formatId: string;
  arrowsPerEnd: number;
  ends: number;
  totals: [number, number];
  xCounts: [number, number];
  endsShot: number;
  winner: 0 | 1 | null;
  needsShootOff: boolean;
  finished: boolean;
}

export function createCumulative(formatId = 'compoundMatch'): CumulativeState {
  const format = getFormat(formatId);
  return {
    formatId,
    arrowsPerEnd: format.arrowsPerEnd,
    ends: format.ends,
    totals: [0, 0],
    xCounts: [0, 0],
    endsShot: 0,
    winner: null,
    needsShootOff: false,
    finished: false,
  };
}

export function applyCumulativeEnd(
  state: CumulativeState,
  scores: [number, number],
  xCounts: [number, number] = [0, 0],
): CumulativeState {
  if (state.finished) return state;
  const totals: [number, number] = [state.totals[0] + scores[0], state.totals[1] + scores[1]];
  const xCountsAcc: [number, number] = [state.xCounts[0] + xCounts[0], state.xCounts[1] + xCounts[1]];
  const endsShot = state.endsShot + 1;

  let winner: 0 | 1 | null = null;
  let needsShootOff = false;
  if (endsShot >= state.ends) {
    if (totals[0] !== totals[1]) winner = totals[0] > totals[1] ? 0 : 1;
    else if (xCountsAcc[0] !== xCountsAcc[1]) winner = xCountsAcc[0] > xCountsAcc[1] ? 0 : 1;
    else needsShootOff = true;
  }

  return {
    ...state,
    totals,
    xCounts: xCountsAcc,
    endsShot,
    winner,
    needsShootOff,
    finished: winner !== null || needsShootOff,
  };
}

/* ------------------------------------------------------------------ */
/* Shoot-off                                                           */
/* ------------------------------------------------------------------ */

export interface ShootOffResult {
  winner: 0 | 1 | null;
  repeat: boolean;
  distancesMm: [number, number];
  reason: string;
}

/**
 * Single-arrow shoot-off: closest to the centre wins. If both arrows are the
 * same value and distance the shoot-off is repeated (rule: `shootOffTieRepeat`).
 */
export function resolveShootOff(a: ArrowScore, b: ArrowScore): ShootOffResult {
  const distancesMm: [number, number] = [a.radius * 1000, b.radius * 1000];
  if (a.value === 0 && b.value === 0) {
    return { winner: null, repeat: true, distancesMm, reason: 'Both arrows missed: shoot again.' };
  }
  const cmp = compareShootOff(a, b);
  if (cmp === 0) {
    return { winner: null, repeat: true, distancesMm, reason: 'Arrows are equidistant: shoot again.' };
  }
  const winner = cmp > 0 ? 0 : 1;
  const reason =
    a.value !== b.value
      ? `Higher value decides the shoot-off (${a.label} v ${b.label}).`
      : `Same value, closer to the centre wins (${distancesMm[0].toFixed(1)} mm v ${distancesMm[1].toFixed(1)} mm).`;
  return { winner, repeat: false, distancesMm, reason };
}
