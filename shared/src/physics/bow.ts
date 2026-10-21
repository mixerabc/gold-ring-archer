/**
 * Bow model: draw force curve, stored energy, launch speed and the feel
 * parameters (hold weight, clicker, wall, let-off) used by the gameplay layer.
 *
 * Conventions
 * -----------
 * - `drawLengthIn` is the AMO draw length (nock-to-pivot distance + 1.75 in).
 * - The power stroke is the distance the nock actually travels:
 *       stroke = drawLength - braceHeight - 1.75 in
 *   (the 1.75 in AMO offset puts the nock at draw length minus that offset
 *   from the pivot point).
 * - `drawWeightLb` is the weight measured at the archer's full draw.
 * - Energy is the integral of the force curve over the power stroke, in joules.
 * - Launch speed comes from arrow kinetic energy:
 *       KE = efficiency * storedEnergy,  v = sqrt(2 KE / m)
 *
 * The curves are deliberately simple and monotonic so they can be unit tested
 * against reference values; the visual limb bend is driven by the same
 * normalised force value the physics uses.
 */

import { clamp, lerp } from '../math/random';
import type { BowClass, BowShotParams, DrawCurvePoint } from '../types';

export const LB_TO_N = 4.4482216153;
export const IN_TO_M = 0.0254;
/** One grain in kilograms. */
export const GRAIN_TO_KG = 0.00006479891;
/** Standard gravity, m/s^2. */
export const G = 9.80665;

export interface BowCurveSpec {
  bowClass: BowClass;
  drawWeightLb: number;
  drawLengthIn: number;
  braceHeightIn: number;
  letOff: number;
  /** Draw length (in) at which the compound reaches peak weight. */
  peakDrawIn: number;
}

/** Power stroke length in metres. */
export function powerStrokeM(spec: BowCurveSpec): number {
  const inches = Math.max(0.5, spec.drawLengthIn - spec.braceHeightIn - 1.75);
  return inches * IN_TO_M;
}

/**
 * Normalised draw force (0..1 of peak) at a normalised draw position s in [0,1].
 * Recurve and barebow: perfectly linear (real limbs are near-linear).
 * Compound: fast rise, flat plateau, then the cam rolls over into the let-off
 * valley, ending at (1 - letOff) of peak.
 */
export function normalisedForce(spec: BowCurveSpec, s: number): number {
  const t = clamp(s, 0, 1);
  if (spec.bowClass !== 'compound') return t;

  const peakFraction = clamp(
    (spec.peakDrawIn - spec.braceHeightIn) / Math.max(0.5, spec.drawLengthIn - spec.braceHeightIn),
    0.25,
    0.75,
  );
  const plateauStart = peakFraction;
  const plateauEnd = 0.85;

  if (t <= plateauStart) {
    // Fast cam rise.
    return Math.pow(t / plateauStart, 0.85);
  }
  if (t <= plateauEnd) {
    // Plateau: the cams hold the peak through the working range.
    return 1;
  }
  // Roll-over into the let-off valley.
  const k = (t - plateauEnd) / (1 - plateauEnd);
  return lerp(1, 1 - clamp(spec.letOff, 0, 0.9), k);
}

/** Draw force in newtons at normalised draw position s. */
export function drawForceN(spec: BowCurveSpec, s: number): number {
  return normalisedForce(spec, s) * spec.drawWeightLb * LB_TO_N;
}

/** Holding weight at full draw, newtons (after let-off for compounds). */
export function holdingWeightN(spec: BowCurveSpec): number {
  return drawForceN(spec, 1);
}

/**
 * Cam mechanical advantage for compound bows.
 *
 * A compound's cams trade string force for string travel, so the energy stored
 * in the limbs is higher than (nock force x nock travel). This factor brings the
 * model in line with measured compound performance (55 lb / 28.5" / 355 grain
 * ~ 285 fps) without fudging the efficiency term.
 */
export const COMPOUND_CAM_ENERGY_FACTOR = 1.3;

/** Stored energy in joules: integral of the force curve over the power stroke. */
export function storedEnergyJ(spec: BowCurveSpec): number {
  const stroke = powerStrokeM(spec);
  const steps = 512;
  let area = 0;
  for (let i = 0; i < steps; i++) {
    const s0 = i / steps;
    const s1 = (i + 1) / steps;
    // Trapezoid rule on the normalised curve, then scale by peak force * stroke.
    area += ((normalisedForce(spec, s0) + normalisedForce(spec, s1)) / 2) * (s1 - s0);
  }
  const camFactor = spec.bowClass === 'compound' ? COMPOUND_CAM_ENERGY_FACTOR : 1;
  return area * spec.drawWeightLb * LB_TO_N * stroke * camFactor;
}

/** Sample the draw force curve for plotting (gear tuning screen, tests). */
export function drawCurve(spec: BowCurveSpec, samples = 41): DrawCurvePoint[] {
  const strokeIn = spec.drawLengthIn - spec.braceHeightIn - 1.75;
  const points: DrawCurvePoint[] = [];
  for (let i = 0; i < samples; i++) {
    const s = i / (samples - 1);
    points.push({
      drawIn: spec.braceHeightIn + 1.75 + s * strokeIn,
      forceLb: normalisedForce(spec, s) * spec.drawWeightLb,
    });
  }
  return points;
}

/** Peak draw weight in the curve (compound peaks before full draw). */
export function peakDrawWeightLb(spec: BowCurveSpec): number {
  return spec.drawWeightLb;
}

/**
 * Arrow launch speed, m/s.
 *
 * @param spec      bow geometry and weight
 * @param arrowMassGr arrow total mass in grains
 * @param efficiency 0..1 energy transfer efficiency
 * @param drawFraction 0..1.02 how far the bow was drawn (under-draw loses energy)
 */
export function launchSpeed(spec: BowCurveSpec, arrowMassGr: number, efficiency: number, drawFraction = 1): number {
  // Energy scales with the fraction of the stroke actually used: E(s) = ∫0^s F ds.
  const used = clamp(drawFraction, 0, 1.02);
  const stroke = powerStrokeM(spec);
  const steps = 256;
  let area = 0;
  const sMax = Math.min(used, 1);
  for (let i = 0; i < steps; i++) {
    const s0 = (i / steps) * sMax;
    const s1 = ((i + 1) / steps) * sMax;
    area += ((normalisedForce(spec, s0) + normalisedForce(spec, s1)) / 2) * (s1 - s0);
  }
  const energyJ = area * spec.drawWeightLb * LB_TO_N * stroke * (spec.bowClass === 'compound' ? COMPOUND_CAM_ENERGY_FACTOR : 1);
  const massKg = Math.max(1e-4, arrowMassGr * GRAIN_TO_KG);
  const kinetic = Math.max(0, energyJ * clamp(efficiency, 0.3, 1.05));
  return Math.sqrt((2 * kinetic) / massKg);
}

/** Build a curve spec from a shot request's gear block. */
export function specFromShot(params: BowShotParams): BowCurveSpec {
  return {
    bowClass: params.bowClass,
    drawWeightLb: params.drawWeightLb,
    drawLengthIn: params.drawLengthIn,
    braceHeightIn: params.braceHeightIn,
    letOff: params.letOff,
    peakDrawIn: params.peakDrawIn,
  };
}

/**
 * Feel parameters that differ between bow classes. These drive the UI, the
 * camera shake, the audio and the release quality model.
 */
export interface BowFeel {
  /** Weight on the fingers at full draw, lb. */
  holdingLb: number;
  /** How much the sight picture shakes at full draw (relative). */
  holdStability: number;
  /** Seconds of comfortable hold before fatigue degrades the shot. */
  holdBudgetS: number;
  /** Multiplier applied to release-timing error (compound is cleaner). */
  releaseSensitivity: number;
  /** Extra arrow speed lost for each 0.01 of draw shortfall. */
  underDrawPenalty: number;
  /** Does this bow have a clicker that must be reached? */
  clicker: boolean;
  /** Does the bow have a hard wall at full draw? */
  wall: boolean;
  /** Visual limb vibration amplitude after the shot (0..1). */
  vibration: number;
}

export function bowFeel(bowClass: BowClass, drawWeightLb: number, letOff: number): BowFeel {
  const holdingLb = bowClass === 'compound' ? drawWeightLb * (1 - letOff) : drawWeightLb;
  switch (bowClass) {
    case 'compound':
      return {
        holdingLb,
        holdStability: 0.45,
        holdBudgetS: 12,
        releaseSensitivity: 0.55,
        underDrawPenalty: 0.02,
        clicker: false,
        wall: true,
        vibration: 0.35,
      };
    case 'barebow':
      return {
        holdingLb,
        holdStability: 1.25,
        holdBudgetS: 5.5,
        releaseSensitivity: 1.25,
        underDrawPenalty: 0.03,
        clicker: false,
        wall: false,
        vibration: 0.9,
      };
    case 'recurve':
    default:
      return {
        holdingLb,
        holdStability: 1,
        holdBudgetS: 7,
        releaseSensitivity: 1,
        underDrawPenalty: 0.025,
        clicker: true,
        wall: false,
        vibration: 0.75,
      };
  }
}

/**
 * Arrow spine matching. A shaft that is too stiff or too soft for the bow's
 * draw weight and length oscillates more, which shows up as visible paradox and
 * a wider group. Returns a 0..1 quality multiplier (1 = perfectly tuned).
 */
export function spineMatchQuality(
  spine: number,
  drawWeightLb: number,
  drawLengthIn: number,
  arrowLengthIn: number,
): number {
  // Empirical "dynamic spine" target: heavier draw and longer power stroke want
  // a stiffer (numerically lower) spine.
  const idealSpine = 780 - drawWeightLb * 7.2 - (drawLengthIn - 28) * 18 + (arrowLengthIn - 28) * 26;
  const delta = Math.abs(spine - idealSpine);
  // Within one spine unit of the ideal is a perfect match.
  if (delta <= 1) return 1;
  return clamp(1 - (delta - 1) / 260, 0, 1);
}

/** Recommended spine for a setup, used by the gear tuning helper. */
export function recommendedSpine(drawWeightLb: number, drawLengthIn: number, arrowLengthIn: number): number {
  return Math.round(780 - drawWeightLb * 7.2 - (drawLengthIn - 28) * 18 + (arrowLengthIn - 28) * 26);
}

/**
 * Sight-mark geometry: how much a 1 mm move of the sight pin shifts the group at
 * a given distance. Typical recurve sight radius (pivot to pin) is ~0.75 m.
 */
export function sightShiftMmPerClick(sightRadiusM: number, distanceM: number, clickMm = 1): number {
  const angle = (clickMm / 1000) / Math.max(0.1, sightRadiusM);
  return Math.tan(angle) * distanceM * 1000;
}
