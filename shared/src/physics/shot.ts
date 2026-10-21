/**
 * The shot pipeline: turns a player's aim/draw/release into an arrow impact and
 * a score. Shared verbatim by the client (prediction) and the server
 * (authoritative validation), which is what makes cheating detectable.
 *
 * Pipeline
 * --------
 *   1. bow model  -> muzzle speed from draw weight/length, arrow mass, efficiency
 *   2. aim solve  -> elevation/yaw that would put the arrow on the aim point
 *   3. errors     -> sight offsets, cant, grip torque, release quality, sway,
 *                    spine mismatch and fatigue are applied as angular deltas
 *   4. flight     -> 240 Hz integration through the wind field
 *   5. scoring    -> impact on the tilted face, line-cutter rule, X ring
 */

import { G, GRAIN_TO_KG, launchSpeed, powerStrokeM, spineMatchQuality, type BowCurveSpec } from './bow';
import {
  ARROW_REST_FORWARD_M,
  ARROW_REST_HEIGHT_M,
  solveAim,
  simulateFlight,
  worldToFace,
} from './arrowFlight';
import { mulberry32, approxGaussian, clamp, hashSeed } from '../math/random';
import { scoreArrow } from '../rules/scoring';
import { getClassFace, getClassRules, rules } from '../rules/index';
import { DEFAULT_WIND } from './wind';
import type { ArrowScore, FaceConfig, ShotOutcome, ShotRequest, Vec2 } from '../types';

/** Distance from the pivot point to the sight pin, metres (typical recurve). */
export const SIGHT_RADIUS_M = 0.78;
/**
 * Cant coupling: what fraction of the cant angle reaches the arrow as a yaw
 * error. A canted bow does not throw the group sideways by the full cant
 * angle (the sight is still on the gold), only by the part where the arrow
 * leaves a tilted rest plane.
 */
export const CANT_COUPLING = 0.35;
/** Grip-torque coupling: how much of the twist angle becomes arrow yaw. */
export const TORQUE_COUPLING = 0.22;

export interface FaceGeometry {
  face: FaceConfig;
  distanceM: number;
  laneX: number;
  centreHeightM: number;
  faceTiltDeg: number;
}

export function geometryFor(bowClass: ShotRequest['bowClass'], distanceM: number, laneX = 0): FaceGeometry {
  const face = getClassFace(bowClass);
  return {
    face,
    distanceM,
    laneX,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
  };
}

/** World position of a point given in face coordinates (metres from gold centre). */
export function facePointToWorld(point: Vec2, geo: FaceGeometry): { x: number; y: number; z: number } {
  const t = (geo.faceTiltDeg * Math.PI) / 180;
  return {
    x: geo.laneX + point.x,
    y: geo.centreHeightM + point.y * Math.cos(t),
    z: geo.distanceM - point.y * Math.sin(t),
  };
}

/**
 * Angular error introduced by the human factors for a given shot. Exported for
 * the difficulty tests: Arcade shrinks every error, Realistic keeps them full.
 */
export function humanErrorRadians(req: ShotRequest): { yaw: number; pitch: number } {
  const spec: BowCurveSpec = {
    bowClass: req.bowClass,
    drawWeightLb: req.gear.drawWeightLb,
    drawLengthIn: req.gear.drawLengthIn,
    braceHeightIn: req.gear.braceHeightIn,
    letOff: req.gear.letOff,
    peakDrawIn: 21,
  };
  void spec;

  const cls = getClassRules(req.bowClass);
  const holdBudget = cls.limits.releaseAid ? 12 : req.bowClass === 'barebow' ? 5.5 : 7;
  const overHold = Math.max(0, req.holdSeconds - holdBudget);
  const fatigue = clamp(overHold / 6, 0, 1.6); // target panic grows after the budget

  const release = clamp(req.releaseQuality, 0, 1);
  const releaseError = (1 - release) * 0.0042; // radians at full draw

  const spineQ = spineMatchQuality(
    req.gear.arrowSpine,
    req.gear.drawWeightLb,
    req.gear.drawLengthIn,
    req.gear.arrowLengthIn,
  );
  const spineError = (1 - spineQ) * 0.0035;

  const seed = hashSeed(
    `${req.windSeed}|${req.aim.x.toFixed(4)}|${req.aim.y.toFixed(4)}|${req.holdSeconds.toFixed(3)}|${req.releaseQuality.toFixed(3)}`,
  );
  const rand = mulberry32(seed);
  const base = releaseError + spineError + fatigue * 0.0035;
  const yaw = approxGaussian(rand) * base;
  const pitch = approxGaussian(rand) * base * 0.85;
  return { yaw, pitch };
}

/**
 * Run the complete shot simulation.
 *
 * Deterministic: the same `ShotRequest` always produces the same impact, so the
 * server can re-run it and compare against the score the client reported.
 */
export function simulateShot(req: ShotRequest, geo?: FaceGeometry): ShotOutcome {
  const geometry = geo ?? geometryFor(req.bowClass, req.distanceM);
  const notes: string[] = [];

  const spec: BowCurveSpec = {
    bowClass: req.bowClass,
    drawWeightLb: req.gear.drawWeightLb,
    drawLengthIn: req.gear.drawLengthIn,
    braceHeightIn: req.gear.braceHeightIn,
    letOff: req.gear.letOff,
    peakDrawIn: 21,
  };

  const drawFraction = clamp(req.drawFraction, 0, 1.02);
  const muzzleSpeed = launchSpeed(spec, req.gear.arrowMassGr, req.gear.efficiency, drawFraction);
  // The sight is set for a full draw. Solving the aim with the *nominal* speed
  // (not the actual one) is what makes an under-drawn arrow land low, exactly
  // as it does on the range: the sight cannot know you shortened your draw.
  const nominalSpeed = launchSpeed(spec, req.gear.arrowMassGr, req.gear.efficiency, 1);
  if (drawFraction < 0.97) {
    notes.push(`Under-drawn by ${((1 - drawFraction) * 100).toFixed(0)}%: ${muzzleSpeed.toFixed(1)} m/s.`);
  }
  if (req.bowClass === 'compound' && drawFraction < 0.99) {
    notes.push('Compound not against the wall: the release aid had no stop to pull into.');
  }

  const origin = {
    x: geometry.laneX,
    y: ARROW_REST_HEIGHT_M,
    z: ARROW_REST_FORWARD_M,
  };

  // 1. Aim point including human sway (given in metres on the face).
  const aimPoint: Vec2 = {
    x: req.aim.x + req.sway.x,
    y: req.aim.y + req.sway.y,
  };
  const target = facePointToWorld(aimPoint, geometry);

  // 2. Base solution in still air, using the full-draw sight setting.
  const solved = solveAim({
    origin,
    speed: nominalSpeed,
    massGr: req.gear.arrowMassGr,
    diameterMm: 5.5,
    lengthIn: req.gear.arrowLengthIn,
    distanceM: geometry.distanceM,
    laneX: geometry.laneX,
    centreHeightM: geometry.centreHeightM,
    faceTiltDeg: geometry.faceTiltDeg,
    target,
  });

  // 3. Human + equipment angular errors.
  //
  // These are all ANGLES at the bow, expressed in radians. The distance to the
  // target then turns them into a group shift automatically inside the flight
  // integration — we must not multiply by the distance again here, or a 3 mm
  // grip-torque error becomes 14 cm at 50 m.
  const human = humanErrorRadians(req);
  const sightPitch = (req.sightElevationOffsetMm / 1000) / SIGHT_RADIUS_M;
  const sightYaw = (req.sightWindageOffsetMm / 1000) / SIGHT_RADIUS_M;
  // Canting the bow tilts the sight line: the group shifts in the direction of
  // the cant by roughly the cant angle, and drops a little as the sight pin
  // leaves the vertical.
  const cantYaw = Math.sin(req.cantRad) * CANT_COUPLING;
  const cantPitch = -Math.abs(Math.sin(req.cantRad)) * 0.35;
  // Grip torque twists the bow in the hand: a small angular error at the bow.
  const torqueYaw = Math.sin(req.torqueRad) * TORQUE_COUPLING;

  const elevation = solved.elevation + sightPitch + cantPitch + human.pitch;
  const yaw = solved.yaw + sightYaw + cantYaw + torqueYaw + human.yaw;

  // 4. Flight through the wind field.
  const wind = req.wind ?? DEFAULT_WIND;
  const flight = simulateFlight({
    origin,
    speed: muzzleSpeed,
    elevation,
    yaw,
    massGr: req.gear.arrowMassGr,
    diameterMm: 5.5,
    lengthIn: req.gear.arrowLengthIn,
    distanceM: geometry.distanceM,
    laneX: geometry.laneX,
    centreHeightM: geometry.centreHeightM,
    faceTiltDeg: geometry.faceTiltDeg,
    wind,
    windTime: 0,
    sampleEvery: 6,
  });

  // 5. Score on the tilted face.
  const faceCoords = worldToFace(flight.impact, geometry.laneX, geometry.centreHeightM, geometry.faceTiltDeg);
  const missed = flight.hitGround || flight.impact.y <= 0.02;
  const faceImpact: Vec2 = missed ? { x: faceCoords.x, y: faceCoords.y } : { x: faceCoords.x, y: faceCoords.y };

  const score: ArrowScore = scoreArrow(geometry.face.id, faceImpact, {
    face: geometry.face,
    miss: missed,
  });

  if (missed) notes.push('Arrow landed short: check the sight mark for this distance.');
  if (score.lineCut) notes.push('Line cutter: the shaft edge touched the higher ring.');
  if (score.isX) notes.push('Inner 10 (X).');

  return {
    flight,
    faceImpact,
    score,
    muzzleSpeed,
    notes,
    simulatedAt: Date.now(),
  };
}

/**
 * Sight mark for a distance: the pin offset (mm) needed to hit the gold.
 *
 * @param speed muzzle speed (m/s)
 * @param distanceM distance (m)
 * @param sightRadiusM pivot-to-pin distance (m)
 */
export function sightMarkMm(speed: number, distanceM: number, sightRadiusM = SIGHT_RADIUS_M): number {
  const origin = { x: 0, y: ARROW_REST_HEIGHT_M, z: ARROW_REST_FORWARD_M };
  const target = { x: 0, y: rules.fieldOfPlay.targetCentreHeightM, z: distanceM };
  const solved = solveAim({
    origin,
    speed,
    massGr: 300,
    diameterMm: 5.5,
    lengthIn: 29,
    distanceM,
    laneX: 0,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    target,
  });
  // Sight marks are quoted relative to a 20 m zero (the usual first mark).
  const flat = solveAim({
    origin,
    speed,
    massGr: 300,
    diameterMm: 5.5,
    lengthIn: 29,
    distanceM: 20,
    laneX: 0,
    centreHeightM: rules.fieldOfPlay.targetCentreHeightM,
    faceTiltDeg: rules.fieldOfPlay.faceTiltDeg,
    target: { x: 0, y: rules.fieldOfPlay.targetCentreHeightM, z: 20 },
  });
  return Math.tan(solved.elevation - flat.elevation) * sightRadiusM * 1000;
}

/** Energy figures for the gear tuning screen. */
export function bowEnergyReport(spec: BowCurveSpec, arrowMassGr: number, efficiency: number): {
  storedJ: number;
  kineticJ: number;
  speed: number;
  strokeM: number;
  grainPerPound: number;
} {
  const speed = launchSpeed(spec, arrowMassGr, efficiency, 1);
  const massKg = arrowMassGr * GRAIN_TO_KG;
  const kineticJ = 0.5 * massKg * speed * speed;
  const stroke = powerStrokeM(spec);
  // Stored energy, recomputed here to avoid a second import cycle.
  const steps = 512;
  let area = 0;
  const nf = (s: number): number => {
    if (spec.bowClass !== 'compound') return clamp(s, 0, 1);
    const peakFraction = clamp(
      (spec.peakDrawIn - spec.braceHeightIn) / Math.max(0.5, spec.drawLengthIn - spec.braceHeightIn),
      0.25,
      0.75,
    );
    const t = clamp(s, 0, 1);
    if (t <= peakFraction) return Math.pow(t / peakFraction, 0.85);
    if (t <= 0.8) return 1;
    return 1 - clamp(spec.letOff, 0, 0.9) * ((t - 0.8) / 0.2);
  };
  for (let i = 0; i < steps; i++) {
    const s0 = i / steps;
    const s1 = (i + 1) / steps;
    area += ((nf(s0) + nf(s1)) / 2) * (s1 - s0);
  }
  const storedJ = area * spec.drawWeightLb * 4.4482216153 * stroke;
  return {
    storedJ,
    kineticJ,
    speed,
    strokeM: stroke,
    grainPerPound: arrowMassGr / Math.max(1, spec.drawWeightLb),
  };
}

export { G };
