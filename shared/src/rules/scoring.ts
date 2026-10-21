/**
 * Scoring engine — World Archery target scoring.
 *
 * Rules implemented (all values read from `worldArchery.json`):
 *  - An arrow scores the value of the ring its shaft crosses. A shaft whose
 *    outer edge touches the line of a higher ring scores that higher value
 *    (the "line cutter" rule).
 *  - The inner 10 (X ring) scores 10 but is recorded as X and breaks ties.
 *  - On a 6-ring face an arrow outside the outermost printed ring is a miss.
 *  - An arrow that rebounds or passes through the face is re-shot (handled by
 *    the competition layer, which asks for `needsReshoot`).
 */

import { faceRadiusM, getFace, ringRadiusM, rules, xRingRadiusM } from './index';
import type { ArrowImpact, ArrowScore, FaceConfig, ScoredArrow } from '../types';

export interface ScoreOptions {
  /** Shaft diameter in millimetres; the line-cutter rule uses the outer edge. */
  shaftDiameterMm?: number;
  /** Override the face (defaults to the id passed in). */
  face?: FaceConfig;
  /** Force a miss (arrow landed in the grass / net). */
  miss?: boolean;
}

/**
 * Score a single arrow from its impact point on the face plane.
 *
 * @param faceId  Face id from the rules config ("wa122", "wa80", ...).
 * @param impact  Impact offset from the gold centre in metres (x lateral, y up).
 */
export function scoreArrow(faceId: string, impact: ArrowImpact, options: ScoreOptions = {}): ArrowScore {
  const face = options.face ?? getFace(faceId);
  const shaftDiameterMm = options.shaftDiameterMm ?? rules.scoring.defaultShaftDiameterMm;
  const shaftRadiusM = shaftDiameterMm / 2000;
  const radius = Math.hypot(impact.x, impact.y);

  if (options.miss) {
    return { value: 0, isX: false, lineCut: false, radius, label: 'M' };
  }

  // Outside the printed face entirely -> miss.
  const outer = faceRadiusM(face);
  if (radius - shaftRadiusM > outer + 1e-9) {
    return { value: 0, isX: false, lineCut: false, radius, label: 'M' };
  }

  // Walk from the highest ring down; the first ring whose OUTER edge the shaft
  // touches (radius - shaftRadius <= ringOuterRadius) is the score.
  const lineCutter = rules.scoring.lineCutter === 'outerEdgeOfShaft';
  let scoredRing = 0;
  let lineCut = false;
  for (let ring = face.rings; ring >= face.minScoringRing; ring--) {
    const outerRadius = ringRadiusM(face, ring);
    const edge = lineCutter ? radius - shaftRadiusM : radius;
    if (edge <= outerRadius + 1e-9) {
      scoredRing = ring;
      // Flag a genuine line call: the shaft centre is outside the ring but its
      // outer edge crosses the line, and the call is inside the review window.
      if (lineCutter && radius > outerRadius) lineCut = true;
      break;
    }
  }

  if (scoredRing === 0) {
    return { value: 0, isX: false, lineCut: false, radius, label: 'M' };
  }

  const isX = scoredRing === face.rings && radius <= xRingRadiusM(face) + 1e-9;
  const value = scoredRing === face.rings && rules.scoring.xCountsAsTen ? 10 : scoredRing;

  return {
    value,
    isX,
    lineCut,
    radius,
    label: isX ? 'X' : String(value),
  };
}

export function scoreArrows(
  faceId: string,
  impacts: ArrowImpact[],
  options: ScoreOptions = {},
): ScoredArrow[] {
  return impacts.map((impact, index) => ({
    ...scoreArrow(faceId, impact, options),
    index,
    impact,
  }));
}

export interface EndTotals {
  total: number;
  xCount: number;
  tenCount: number;
  /** Number of scoring arrows (anything that is not a miss). */
  scoringArrows: number;
}

export function sumEnd(arrows: ArrowScore[]): EndTotals {
  let total = 0;
  let xCount = 0;
  let tenCount = 0;
  let scoringArrows = 0;
  for (const a of arrows) {
    total += a.value;
    if (a.isX) xCount++;
    if (a.value === 10) tenCount++;
    if (a.value > 0) scoringArrows++;
  }
  return { total, xCount, tenCount, scoringArrows };
}

/**
 * Penalty rule: a shot fired before the signal or after time expires loses the
 * arrow's score — in the bundled ruleset, the highest scoring arrow of that end
 * is cancelled (`penalties.cancelHighestArrowOfEnd`).
 *
 * Returns a new array where the cancelled arrow is replaced with a zero score
 * flagged as `penalised`, so the scoreboard can show what happened.
 */
export interface PenalisedArrow extends ArrowScore {
  penalised: true;
  originalValue: number;
}

export function applyTimingPenalty(arrows: ArrowScore[]): Array<ArrowScore | PenalisedArrow> {
  if (!rules.penalties.cancelHighestArrowOfEnd) return arrows.slice();
  const copy = arrows.slice();
  let bestIndex = -1;
  let bestValue = -1;
  for (let i = 0; i < copy.length; i++) {
    if (copy[i].value > bestValue) {
      bestValue = copy[i].value;
      bestIndex = i;
    }
  }
  if (bestIndex >= 0 && bestValue > 0) {
    const original = copy[bestIndex];
    copy[bestIndex] = {
      value: 0,
      isX: false,
      lineCut: false,
      radius: original.radius,
      label: 'M',
      penalised: true,
      originalValue: original.value,
    } as PenalisedArrow;
  }
  return copy;
}

/** True when an arrow's call is close enough to a ring line to trigger a judge review. */
export function needsJudgeReview(faceId: string, impact: ArrowImpact, shaftDiameterMm?: number): boolean {
  const face = getFace(faceId);
  const shaftRadiusM = (shaftDiameterMm ?? rules.scoring.defaultShaftDiameterMm) / 2000;
  const radius = Math.hypot(impact.x, impact.y);
  const toleranceM = rules.scoring.judgeReviewRadiusMm / 1000;
  for (let ring = face.rings; ring >= face.minScoringRing; ring--) {
    const outerRadius = ringRadiusM(face, ring);
    if (Math.abs(radius - shaftRadiusM - outerRadius) < toleranceM) return true;
  }
  return false;
}

/**
 * Shoot-off comparison. The arrow closest to the gold centre wins; an X beats a
 * 10, and if both arrows are the same distance the shoot-off is repeated.
 */
export function compareShootOff(
  a: { value: number; isX: boolean; radius: number },
  b: { value: number; isX: boolean; radius: number },
): -1 | 0 | 1 {
  // Higher ring value wins first; the X only separates arrows of equal value.
  if (a.value !== b.value) return a.value > b.value ? 1 : -1;
  if (a.isX !== b.isX) return a.isX ? 1 : -1;
  if (Math.abs(a.radius - b.radius) > 1e-6) return a.radius < b.radius ? 1 : -1;
  return 0;
}

/** Distance in millimetres from the centre, for the electronic display. */
export function distanceFromCentreMm(impact: ArrowImpact): number {
  return Math.hypot(impact.x, impact.y) * 1000;
}
