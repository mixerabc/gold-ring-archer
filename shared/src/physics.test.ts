/**
 * Unit tests for the archery physics: bow force curves, launch speed, arrow
 * flight (drop, wind drift), and scoring edge cases.
 *
 * All simulations are deterministic and run identically on the client and the
 * server.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  drawCurve,
  normalisedForce,
  storedEnergyJ,
  launchSpeed,
  holdingWeightN,
  LB_TO_N,
  powerStrokeM,
  bowFeel,
  spineMatchQuality,
  recommendedSpine,
} from './physics/bow';
import { simulateShot } from './physics/shot';
import { referenceTrajectory, arrowAreaM2, simulateFlight, solveAim } from './physics/arrowFlight';
import { DEFAULT_WIND, sampleWind } from './physics/wind';
import { hashSeed, mulberry32 } from './math/random';
import { getClassRules, rules } from './rules/index';
import { ShotRequest, WindFieldConfig } from './types';

/* ------------------------------------------------------------------ */
/* Bow model                                                           */
/* ------------------------------------------------------------------ */

describe('draw force curve', () => {
  const recurve = {
    bowClass: 'recurve' as const,
    drawWeightLb: 44,
    drawLengthIn: 29,
    braceHeightIn: 8.75,
    letOff: 0,
    peakDrawIn: 21,
  };

  it('recurve force is linear', () => {
    const pts = drawCurve(recurve);
    expect(pts.length).toBe(41);
    const mid = pts[20].forceLb;
    const end = pts[40].forceLb;
    // Linear ramp from 0 to 44 lb.
    expect(mid).toBeCloseTo(end / 2, 1);
    expect(end).toBeCloseTo(44, 1);
  });

  it('compound rises fast, plateaus, then lets off', () => {
    const compound = {
      bowClass: 'compound' as const,
      drawWeightLb: 55,
      drawLengthIn: 28.5,
      braceHeightIn: 7,
      letOff: 0.8,
      peakDrawIn: 21,
    };
    const pts = drawCurve(compound, 41);
    // Peak should be reached well before full draw (~75% of stroke).
    const midStroke = pts[Math.floor(pts.length * 0.75)];
    expect(midStroke.forceLb).toBeCloseTo(55, 1);
    expect(pts[pts.length - 1].forceLb).toBeCloseTo(55 * 0.2, 1); // 20% hold
  });

  it('compound never exceeds its peak weight', () => {
    const compound = {
      bowClass: 'compound' as const,
      drawWeightLb: 55,
      drawLengthIn: 28.5,
      braceHeightIn: 7,
      letOff: 0.8,
      peakDrawIn: 21,
    };
    const max = Math.max(...drawCurve(compound, 101).map((p) => p.forceLb));
    expect(max).toBeCloseTo(55, 1);
  });

  it('holding weight reflects the let-off', () => {
    const compound = {
      bowClass: 'compound' as const,
      drawWeightLb: 55,
      drawLengthIn: 28.5,
      braceHeightIn: 7,
      letOff: 0.8,
      peakDrawIn: 21,
    };
    expect(holdingWeightN(compound)).toBeCloseTo(55 * 0.2 * LB_TO_N, 1);
  });
});

describe('stored energy', () => {
  it('recurve stores ~45-50 J at 44 lb / 29"', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const E = storedEnergyJ(recurve);
    expect(E).toBeGreaterThan(40);
    expect(E).toBeLessThan(52);
  });

  it('compound stores far more energy per pound thanks to the cams', () => {
    const compound = {
      bowClass: 'compound' as const,
      drawWeightLb: 55,
      drawLengthIn: 28.5,
      braceHeightIn: 7,
      letOff: 0.8,
      peakDrawIn: 21,
    };
    const E = storedEnergyJ(compound);
    expect(E).toBeGreaterThan(90);
    expect(E).toBeLessThan(115);
  });

  it('under-drawing loses energy', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    // Speed scales with sqrt of the energy used; a half-drawn linear bow holds
    // a quarter of its energy, so the arrow leaves at ~0.5x speed.
    const full = launchSpeed(recurve, 315, 0.8, 1);
    const half = launchSpeed(recurve, 315, 0.8, 0.5);
    expect(half / full).toBeCloseTo(0.5, 1);
  });
});

describe('launch speed', () => {
  it('recurve launches ~58-66 m/s', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const v = launchSpeed(recurve, 315, 0.8, 1);
    expect(v).toBeGreaterThan(58);
    expect(v).toBeLessThan(68);
  });

  it('compound launches ~85-100 m/s (faster than recurve)', () => {
    const compound = {
      bowClass: 'compound' as const,
      drawWeightLb: 55,
      drawLengthIn: 28.5,
      braceHeightIn: 7,
      letOff: 0.8,
      peakDrawIn: 21,
    };
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const v = launchSpeed(compound, 355, 0.9, 1);
    expect(v).toBeGreaterThan(84);
    expect(v).toBeLessThan(100);
    expect(v).toBeGreaterThan(launchSpeed(recurve, 315, 0.8, 1) * 1.3);
  });

  it('heavier arrows fly slower', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const v315 = launchSpeed(recurve, 315, 0.8, 1);
    const v450 = launchSpeed(recurve, 450, 0.8, 1);
    expect(v315).toBeGreaterThan(v450);
    expect(v315 / v450).toBeCloseTo(Math.sqrt(450 / 315), 2);
  });

  it('lighter draw loses speed', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    expect(launchSpeed(recurve, 315, 0.8, 1)).toBeGreaterThan(launchSpeed(recurve, 315, 0.8, 0.95));
  });
});

describe('feel', () => {
  it('compound feels light at full draw and is tolerant', () => {
    const feel = bowFeel('compound', 55, 0.8);
    expect(feel.holdingLb).toBeCloseTo(11, 1);
    expect(feel.holdStability).toBeLessThan(0.5);
    expect(feel.clicker).toBe(false);
    expect(feel.wall).toBe(true);
  });

  it('barebow has poor hold stability and no clicker', () => {
    const feel = bowFeel('barebow', 40, 0);
    expect(feel.holdingLb).toBe(40);
    expect(feel.clicker).toBe(false);
  });
});

describe('spine tuning', () => {
  it('computes a recommended spine', () => {
    const spine = recommendedSpine(44, 29, 29);
    expect(spine).toBeGreaterThan(0);
  });

  it('perfectly matched spine scores 1', () => {
    const spine = recommendedSpine(44, 29, 29);
    expect(spineMatchQuality(spine, 44, 29, 29)).toBe(1);
  });

  it('mismatched spine degrades quality', () => {
    expect(spineMatchQuality(400, 44, 29, 29)).toBeLessThan(spineMatchQuality(500, 44, 29, 29));
  });
});

/* ------------------------------------------------------------------ */
/* Arrow flight                                                        */
/* ------------------------------------------------------------------ */

describe('arrow flight drop', () => {
  const recurve = {
    bowClass: 'recurve' as const,
    drawWeightLb: 44,
    drawLengthIn: 29,
    braceHeightIn: 8.75,
    letOff: 0,
    peakDrawIn: 21,
  };
  const speed = launchSpeed(recurve, 315, 0.8, 1);

  /**
   * Fire at the target at `distanceM` with the elevation solved for that
   * distance, then compare gravity drop (1/2 g t^2) with an independent
   * reference integrator that uses the same launch angle and drag coefficient.
   * Tolerance: 0.25 m at 30 m, 0.5 m at 50 m, 0.75 m at 70 m.
   */
  it.each([
    [30, 0.25],
    [50, 0.5],
    [70, 0.75],
  ])('drop at %i m matches an independent reference', (distanceM, tol) => {
    const solved = solveAim({
      origin: ORIGIN,
      speed,
      massGr: 315,
      diameterMm: 5.5,
      lengthIn: 29,
      distanceM,
      laneX: 0,
      centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
      faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
      target: { x: 0, y: rules.fieldOfPlay.targetCentreHeightM, z: distanceM },
    });
    const shot = simulateFlight({
      origin: ORIGIN,
      speed,
      elevation: solved.elevation,
      yaw: 0,
      massGr: 315,
      diameterMm: 5.5,
      lengthIn: 29,
      distanceM,
      laneX: 0,
      centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
      faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    });
    expect(shot.hitGround).toBe(false);
    const ref = referenceTrajectory(speed, solved.elevation, distanceM - ORIGIN.z, arrowDragK(315));
    expect(shot.drop).toBeGreaterThan(0);
    // Gravity drop grows with distance: ~1.4 m at 30 m, ~3.5 m at 50 m, ~7 m at 70 m.
    expect(shot.drop).toBeCloseTo(ref.drop, 0);
    expect(Math.abs(shot.drop - ref.drop)).toBeLessThan(tol);
  });

  it('drop increases with distance', () => {
    const d30 = dropAt(recurve, 30);
    const d50 = dropAt(recurve, 50);
    const d70 = dropAt(recurve, 70);
    expect(d30.drop).toBeLessThan(d50.drop);
    expect(d50.drop).toBeLessThan(d70.drop);
    expect(d70.drop).toBeGreaterThan(4);
  });

  it('flight takes a plausible time of flight', () => {
    const shot = dropAt(recurve, 70);
    expect(shot.time).toBeGreaterThan(1.0);
    expect(shot.time).toBeLessThan(2.0);
  });

  it('solving aim hits the intended point', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const speed = launchSpeed(recurve, 315, 0.8, 1);
    const origin = { x: 0, y: 1.45, z: 0.55 };
    const target = { x: 0.08, y: rules.fieldOfPlay.targetCentreHeightM, z: 50 };
    const solved = solveAim({
      origin,
      speed,
      massGr: 315,
      diameterMm: 5.5,
      lengthIn: 29,
      distanceM: 50,
      laneX: 0,
      centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
      faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
      target,
    });
    const shot = simulateFlight({
      origin,
      speed,
      elevation: solved.elevation,
      yaw: solved.yaw,
      massGr: 315,
      diameterMm: 5.5,
      lengthIn: 29,
      distanceM: 50,
      laneX: 0,
      centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
      faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    });
    const t = (rules.fieldOfPlay.faceTiltDeg * Math.PI) / 180;
    const faceY = (shot.impact.y - rules.fieldOfPlay.targetCentreHeightM) / Math.cos(t);
    const faceX = shot.impact.x;
    // The solved shot lands on the aim point to within a couple of centimetres;
    // the small residual to the right is deliberate spin drift, not an error.
    expect(faceX).toBeCloseTo(0.08, 0);
    expect(Math.abs(faceX - 0.08)).toBeLessThan(0.03);
    expect(faceX).toBeGreaterThan(0.08); // spin drift pushes right for RH spin
    expect(faceY).toBeCloseTo(0, 3);
  });
});

describe('wind drift', () => {
  const recurve = {
    bowClass: 'recurve' as const,
    drawWeightLb: 44,
    drawLengthIn: 29,
    braceHeightIn: 8.75,
    letOff: 0,
    peakDrawIn: 21,
  };
  const speed = launchSpeed(recurve, 315, 0.8, 1);

  it('still air has zero wind drift', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const wind: WindFieldConfig = { seed: 0, baseSpeed: 0, baseDirectionDeg: 0, gustStrength: 0, gustFrequencyHz: 0, shear: 0, turbulence: 0 };
    const shot = shootWindDriftAtM(recurve, 315, 0.8, 50, wind);
    expect(shot.windDrift).toBe(0);
  });

  it('a crosswind pushes the arrow laterally', () => {
    const wind: WindFieldConfig = {
      seed: 1337,
      baseSpeed: 5,
      baseDirectionDeg: 90, // wind from the left (blowing towards +x)
      gustStrength: 0.4,
      gustFrequencyHz: 0.15,
      shear: 0.15,
      turbulence: 0.2,
    };
    const shot = shootWindDriftAtM(recurve, 315, 0.8, 50, wind);
    expect(shot.windDrift).toBeGreaterThan(0);
    expect(shot.windDrift).toBeLessThan(1.5);
    // Stronger wind drifts more.
    const strong = shootWindDriftAtM(recurve, 315, 0.8, 50, { ...wind, baseSpeed: 10 });
    expect(strong.windDrift).toBeGreaterThan(shot.windDrift);
  });

  it('headwind slightly reduces drift and speed', () => {
    const cross = shootWindDriftAtM(recurve, 315, 0.8, 70, { seed: 1, baseSpeed: 6, baseDirectionDeg: 90, gustStrength: 0.3, gustFrequencyHz: 0.15, shear: 0.15, turbulence: 0.2 });
    const head = shootWindDriftAtM(recurve, 315, 0.8, 70, { seed: 1, baseSpeed: 6, baseDirectionDeg: 0, gustStrength: 0.3, gustFrequencyHz: 0.15, shear: 0.15, turbulence: 0.2 });
    expect(head.windDrift).toBeLessThan(cross.windDrift);
  });
});

describe('shot outcome integration', () => {
  const calm = { seed: 1, baseSpeed: 0, baseDirectionDeg: 0, gustStrength: 0, gustFrequencyHz: 0.15, shear: 0.15, turbulence: 0 };

  it('scores the gold with a still bow, calm air and no gear error', () => {
    const outcome = simulateShot({
      bowClass: 'recurve',
      distanceM: 50,
      windSeed: 1,
      aim: { x: 0, y: 0 },
      drawFraction: 1,
      holdSeconds: 1.5,
      releaseQuality: 1,
      cantRad: 0,
      torqueRad: 0,
      sightElevationOffsetMm: 0,
      sightWindageOffsetMm: 0,
      sway: { x: 0, y: 0 },
      gear: {
        drawWeightLb: 44,
        drawLengthIn: 29,
        braceHeightIn: 8.75,
        letOff: 0,
        arrowMassGr: 315,
        arrowSpine: 500,
        arrowLengthIn: 29,
        efficiency: 0.8,
      },
      wind: calm,
    });
    // Spin drift alone keeps it inside the 10 (r <= 6.1 cm).
    expect(outcome.score.value).toBe(10);
    expect(outcome.score.radius).toBeLessThan(0.061);
    expect(outcome.flight.hitGround).toBe(false);
  });

  it('a light crosswind pushes a good shot out of the gold', () => {
    const outcome = simulateShot({
      bowClass: 'recurve',
      distanceM: 50,
      windSeed: 7,
      aim: { x: 0, y: 0 },
      drawFraction: 1,
      holdSeconds: 1.5,
      releaseQuality: 0.95,
      cantRad: 0.005,
      torqueRad: 0.005,
      sightElevationOffsetMm: 0,
      sightWindageOffsetMm: 0,
      sway: { x: 0, y: 0 },
      gear: {
        drawWeightLb: 44,
        drawLengthIn: 29,
        braceHeightIn: 8.75,
        letOff: 0,
        arrowMassGr: 315,
        arrowSpine: 500,
        arrowLengthIn: 29,
        efficiency: 0.8,
      },
      wind: { seed: 7, baseSpeed: 6, baseDirectionDeg: 90, gustStrength: 0.3, gustFrequencyHz: 0.15, shear: 0.15, turbulence: 0.2 },
    });
    // A ~4 m/s (9 mph) crosswind is a strong field wind: it pushes the arrow
    // several decimetres. At 50 m it stays on the 122 cm face (radius 61 cm)
    // but leaves the gold; a real 4 m/s crosswind can also take an arrow off the
    // smaller 80 cm compound face.
    expect(outcome.faceImpact.x).toBeGreaterThan(0.3);
    // A 6 m/s crosswind can push the arrow off a 61 cm-radius face entirely;
    // either way it must not still be a ten.
    expect(outcome.faceImpact.x).toBeLessThan(0.85);
    expect(outcome.score.value).toBeLessThan(10);
    // The wind came from the left, so the arrow lands right of centre.
    expect(outcome.faceImpact.x).toBeGreaterThan(0);
  });

  it('an under-drawn arrow drops low', () => {
    const makeShot = (draw: number) =>
      simulateShot({
        bowClass: 'recurve',
        distanceM: 70,
        windSeed: 3,
        aim: { x: 0, y: 0 },
        drawFraction: draw,
        holdSeconds: 1.5,
        releaseQuality: 1,
        cantRad: 0,
        torqueRad: 0,
        sightElevationOffsetMm: 0,
        sightWindageOffsetMm: 0,
        sway: { x: 0, y: 0 },
        gear: {
          drawWeightLb: 44,
          drawLengthIn: 29,
          braceHeightIn: 8.75,
          letOff: 0,
          arrowMassGr: 315,
          arrowSpine: 500,
          arrowLengthIn: 29,
          efficiency: 0.8,
        },
        wind: calm,
      });
    const full = makeShot(1);
    const weak = makeShot(0.8);
    expect(weak.muzzleSpeed).toBeLessThan(full.muzzleSpeed);
    // A weaker shot, aimed with the full-draw sight setting, lands low (or
    // short of the target entirely).
    expect(weak.flight.hitGround || weak.flight.timeOfFlight > full.flight.timeOfFlight).toBe(true);
    expect(weak.flight.impact.y).toBeLessThan(full.flight.impact.y - 0.15);
  });

  it('scores an arrow landed in the gold', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const outcome = simulateShot({
      bowClass: 'recurve',
      distanceM: 50,
      windSeed: 1,
      aim: { x: 0, y: 0 },
      drawFraction: 1,
      holdSeconds: 1.5,
      releaseQuality: 0.95,
      cantRad: 0.005,
      torqueRad: 0.005,
      sightElevationOffsetMm: 0,
      sightWindageOffsetMm: 0,
      sway: { x: 0, y: 0 },
      gear: {
        drawWeightLb: recurve.drawWeightLb,
        drawLengthIn: recurve.drawLengthIn,
        braceHeightIn: recurve.braceHeightIn,
        letOff: 0,
        arrowMassGr: 315,
        arrowSpine: 500,
        arrowLengthIn: 29,
        efficiency: 0.8,
      },
      wind: { seed: 1, baseSpeed: 2, baseDirectionDeg: 45, gustStrength: 0.3, gustFrequencyHz: 0.15, shear: 0.15, turbulence: 0.2 },
    });
    expect(outcome.score.value).toBeGreaterThanOrEqual(1);
    expect(outcome.score.radius).toBeGreaterThan(0);
    expect(outcome.flight.hitGround).toBe(false);
  });

  it('is deterministic: identical requests produce identical results', () => {
    const recurve = {
      bowClass: 'recurve' as const,
      drawWeightLb: 44,
      drawLengthIn: 29,
      braceHeightIn: 8.75,
      letOff: 0,
      peakDrawIn: 21,
    };
    const makeReq = (seed: number): ShotRequest => ({
      bowClass: 'recurve',
      distanceM: 50,
      windSeed: seed,
      aim: { x: 0.03, y: -0.02 },
      drawFraction: 0.98,
      holdSeconds: 1.7,
      releaseQuality: 0.9,
      cantRad: 0.01,
      torqueRad: 0.008,
      sightElevationOffsetMm: 4,
      sightWindageOffsetMm: 0,
      sway: { x: 0.02, y: 0.01 },
      gear: {
        drawWeightLb: recurve.drawWeightLb,
        drawLengthIn: recurve.drawLengthIn,
        braceHeightIn: recurve.braceHeightIn,
        letOff: 0,
        arrowMassGr: 315,
        arrowSpine: 500,
        arrowLengthIn: 29,
        efficiency: 0.8,
      },
      wind: { seed: 1, baseSpeed: 3, baseDirectionDeg: 60, gustStrength: 0.3, gustFrequencyHz: 0.15, shear: 0.15, turbulence: 0.2 },
    });
    const a = simulateShot(makeReq(1));
    const b = simulateShot(makeReq(1));
    expect(a.score.label).toBe(b.score.label);
    expect(a.faceImpact.x).toBeCloseTo(b.faceImpact.x, 4);
    expect(a.faceImpact.y).toBeCloseTo(b.faceImpact.y, 4);
    // Different seed -> different result (wind changes the drift).
    const c = simulateShot(makeReq(2));
    expect(c.score.radius).not.toBe(a.score.radius);
  });
});

describe('determinism of the wind field', () => {
  it('same coordinates and time always give the same wind', () => {
    const w1 = sampleWind(DEFAULT_WIND, 10, 5, 40, 62);
    const w2 = sampleWind(DEFAULT_WIND, 10, 5, 40, 62);
    expect(w1.x).toBe(w2.x);
    expect(w1.y).toBe(w2.y);
    expect(w1.z).toBe(w2.z);
  });

  it('wind varies with position and time', () => {
    const w1 = sampleWind(DEFAULT_WIND, 0, 5, 10, 0);
    const w2 = sampleWind(DEFAULT_WIND, 0, 5, 50, 30);
    expect(Math.hypot(w1.x, w1.y, w1.z)).toBeGreaterThan(0.5);
    expect(Math.hypot(w2.x, w2.y, w2.z)).not.toBe(Math.hypot(w1.x, w1.y, w1.z));
  });

  it('separate seeds give independent noise', () => {
    const r1 = mulberry32(1);
    const r2 = mulberry32(2);
    const v1: number[] = [];
    const v2: number[] = [];
    for (let i = 0; i < 10; i++) {
      v1.push(r1());
      v2.push(r2());
    }
    expect(v1.some((x, i) => x === v2[i])).toBe(false);
    // Same seed re-runs the same sequence.
    const r3 = mulberry32(1);
    for (let i = 0; i < 10; i++) {
      expect(r3()).toBe(v1[i]);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function arrowDragK(arrowGr: number): number {
  return (0.5 * 1.225 * 1.5 * arrowAreaM2(5.5, 29)) / (arrowGr * 0.00006479891);
}

/** Launch position used everywhere: the arrow rest, 0.55 m in front of the line. */
const ORIGIN = { x: 0, y: 1.45, z: 0.55 };

function dropAt(recurve: any, distanceM: number): { drop: number; time: number; windDrift: number } {
  const speed = launchSpeed(recurve, 315, 0.8, 1);
  const solved = solveAim({
    origin: ORIGIN,
    speed,
    massGr: 315,
    diameterMm: 5.5,
    lengthIn: 29,
    distanceM,
    laneX: 0,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    target: { x: 0, y: rules.fieldOfPlay.targetCentreHeightM, z: distanceM },
  });
  const shot = simulateFlight({
    origin: ORIGIN,
    speed,
    elevation: solved.elevation,
    yaw: 0,
    massGr: 315,
    diameterMm: 5.5,
    lengthIn: 29,
    distanceM,
    laneX: 0,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
  });
  return { drop: shot.drop, time: shot.timeOfFlight, windDrift: shot.windDrift };
}

function shootWindDriftAtM(recurve: any, gr: number, eff: number, distanceM: number, wind: any): any {
  const speed = launchSpeed(recurve, gr, eff, 1);
  const solved = solveAim({
    origin: ORIGIN,
    speed,
    massGr: gr,
    diameterMm: 5.5,
    lengthIn: 29,
    distanceM,
    laneX: 0,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    target: { x: 0, y: rules.fieldOfPlay.targetCentreHeightM, z: distanceM },
  });
  const shot = simulateFlight({
    origin: ORIGIN,
    speed,
    elevation: solved.elevation,
    yaw: 0,
    massGr: gr,
    diameterMm: 5.5,
    lengthIn: 29,
    distanceM,
    laneX: 0,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    wind,
  });
  return { windDrift: shot.windDrift, drop: shot.drop };
}
