/**
 * AI archer model.
 *
 * The client uses this to generate plausible opponent shots (practice, campaign
 * and multiplayer), and the server can use the same code to replay what an AI
 * player should have produced — which lets the server detect impossible scores
 * from a human client (an AI that could not score there is a bot).
 */

import { mulberry32, hashSeed } from '../math/random';
import { simulateShot, humanErrorRadians } from '../physics/shot';
import { DEFAULT_WIND } from '../physics/wind';
import { defaultGear, findArrow, findSight } from '../data/gear';
import { getClassRules, rules } from '../rules/index';
import type { BowClass, Handedness, ShotRequest, WindFieldConfig } from '../types';

export interface AITargetPoint {
  /** Where the AI deliberately aims on the face (metres from gold centre). */
  aim: { x: number; y: number };
  /** 0..1 how consistent the AI is (1 = Olympic-level). */
  consistency: number;
  /** 0..1 whether the AI gets better under pressure (clutch). */
  clutch: number;
  /** Optional deliberate miss (practice scenario). */
  fakeOut?: boolean;
}

export interface AIOptions {
  /** The AI's skill level, 0..1. */
  skill: number;
  /** Optional custom wind; DEFAULT_WIND used when not given. */
  wind?: WindFieldConfig;
  /** Whether the AI is in a tie-break / final (raises clutch effect). */
  pressure: number;
}

/**
 * Pick an aim point a human would choose given the wind and a skill level.
 *
 * Low skill archers are pushed by the wind and aim for the safer, wider part of
 * the face. High skill archers read the flag and aim into the wind.
 */
export function pickAIPoint(
  bowClass: BowClass,
  skill: number,
  wind: { speed: number; x: number; z: number },
): { aim: { x: number; y: number }; consistency: number } {
  const distance = getClassRules(bowClass).distanceM;
  // The wind pushes the arrow by roughly 0.8..1.5 * wind x-component at archery ranges;
  // we compensate partially depending on skill.
  const windX = wind.x; // + = lateral towards the archer's right
  const windDriftM = distance * 0.015 * (1 + 0.5 * (wind.speed / 10)); // crude but usable
  const read = skill * (skill + 0.5) * 0.9;
  const aimX = -windDriftM * read;

  // Vertical bias: lower skill archers tend to aim a little low when tired.
  const fatigueBias = (1 - skill) * 0.04;

  const consistency = clamp(skill * 0.85 + 0.15, 0.15, 0.95);
  return {
    aim: { x: aimX, y: -fatigueBias * (1 - Math.random() * 0.2) },
    consistency,
  };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function generateShot(bowClass: BowClass, req: AITargetPoint, opts: AIOptions): ShotRequest {
  const gear = defaultGear(bowClass);
  const arrow = findArrow(gear.arrowId);
  const sight = findSight(gear.sightId);
  const wind = opts.wind ?? DEFAULT_WIND;

  // Deterministic human errors: the same seed gives the same shot, which lets
  // us replay the result for the scoreboard.
  const seed = hashSeed(
    `ai|${bowClass}|${opts.skill.toFixed(2)}|${opts.pressure.toFixed(2)}|${req.aim.x.toFixed(2)}|${req.aim.y.toFixed(2)}|${wind.seed}`,
  );
  const rand = mulberry32(seed);

  const windX = wind.baseSpeed * 0.3;
  const aim = pickAIPoint(bowClass, opts.skill, { x: windX, z: 0, speed: wind.baseSpeed });
  const human = humanErrorRadians({
    bowClass,
    distanceM: getClassRules(bowClass).distanceM,
    windSeed: wind.seed,
    aim: aim.aim,
    drawFraction: 1,
    holdSeconds: 1.8 + rand() * 1.4,
    releaseQuality: 1,
    cantRad: (rand() - 0.5) * 0.012,
    torqueRad: (rand() - 0.5) * 0.012,
    sightElevationOffsetMm: 0,
    sightWindageOffsetMm: 0,
    sway: { x: 0, y: 0 },
    gear: {
      drawWeightLb: gear.drawWeightLb,
      drawLengthIn: gear.drawLengthIn,
      braceHeightIn: gear.braceHeightIn,
      letOff: bowClass === 'compound' ? 0.8 : 0,
      arrowMassGr: arrow.weightGr,
      arrowSpine: arrow.spine,
      arrowLengthIn: gear.arrowLengthIn,
      efficiency: bowClass === 'compound' ? 0.88 : bowClass === 'barebow' ? 0.78 : 0.8,
    },
    wind,
  } as any);

  const clutch = clamp(opts.pressure * (0.5 + 0.5 * req.clutch), 0, 1);
  // Under pressure the AI becomes a little tighter, but very low skill AI crumbles.
  const effectiveSkill = opts.skill + clutch * (opts.skill < 0.4 ? -0.15 : 0.08);

  // Release quality drops with lower consistency and with a fake-out.
  let releaseQuality = clamp(0.88 + (effectiveSkill - 0.4) * 0.2, 0.72, 0.98);
  if (req.fakeOut) releaseQuality = 0.35;

  // A little sway, modelled as metres on the face (independent of human() yaw/pitch).
  const sway = {
    x: (rand() - 0.5) * 0.12 * (1 - req.consistency * 0.7),
    y: (rand() - 0.5) * 0.12 * (1 - req.consistency * 0.7),
  };

  // Compound draws to the wall; recurve/barebow hold a fraction just under full.
  const drawFraction = getClassRules(bowClass).limits.releaseAid ? 1 : clamp(0.97 + rand() * 0.03, 0.95, 1.0);

  return {
    bowClass,
    distanceM: getClassRules(bowClass).distanceM,
    windSeed: wind.seed,
    aim: { x: aim.aim.x + human.yaw * getClassRules(bowClass).distanceM / 30, y: aim.aim.y + human.pitch * getClassRules(bowClass).distanceM / 30 },
    drawFraction,
    holdSeconds: 1.8 + rand() * 1.4,
    releaseQuality,
    cantRad: (rand() - 0.5) * 0.015,
    torqueRad: (rand() - 0.5) * 0.015,
    sightElevationOffsetMm: 0,
    sightWindageOffsetMm: 0,
    sway,
    gear: {
      drawWeightLb: gear.drawWeightLb,
      drawLengthIn: gear.drawLengthIn,
      braceHeightIn: gear.braceHeightIn,
      letOff: bowClass === 'compound' ? 0.8 : 0,
      arrowMassGr: arrow.weightGr,
      arrowSpine: arrow.spine,
      arrowLengthIn: gear.arrowLengthIn,
      efficiency: bowClass === 'compound' ? 0.88 : bowClass === 'barebow' ? 0.78 : 0.8,
    },
    wind,
  };
}

/**
 * Run the full simulation from a request that has already gone through
 * generateShot, and report the outcome. Used to render the AI's group and the
 * result screen.
 */
export function resolveShot(bowClass: BowClass, req: ShotRequest): ReturnType<typeof simulateShot> {
  return simulateShot(req);
}
