/**
 * Server-authoritative shot validation.
 *
 * The client sends what it did (aim, draw, release timing, wind), never a
 * score it wants to keep. The server replays the shot through the same shared
 * physics and compares the result with the client's claim. A tampered client
 * either fails the schema, asks for something physically impossible, or simply
 * disagrees with the replay.
 */

import { ShootRequestSchema, type ShootRequest as WireShootRequest } from '@gold-ring/shared/net/protocol';
import { simulateShot } from '@gold-ring/shared/physics/shot';
import { DEFAULT_WIND, sanitizeWind } from '@gold-ring/shared/physics/wind';
import { faceRadiusM, getClassFace, getClassRules } from '@gold-ring/shared/rules/index';
import { clamp } from '@gold-ring/shared/math/random';
import type { ShotOutcome, ShotRequest } from '@gold-ring/shared/types';

export type RejectReason = 'invalid' | 'impossible' | 'replay' | 'accepted';

export interface ValidationResult {
  accepted: boolean;
  reason: RejectReason;
  message: string;
  outcome?: ShotOutcome;
}

const ALLOWED_DISTANCES = [18, 30, 50, 70];

export function validateShot(input: unknown): ValidationResult {
  const parsed = ShootRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { accepted: false, reason: 'invalid', message: parsed.error.issues[0]?.message ?? 'Malformed shot.' };
  }
  const req = parsed.data as WireShootRequest;
  const cls = getClassRules(req.bowClass);
  const face = getClassFace(req.bowClass);

  // Distance must be a real round distance for this class.
  const nearest = ALLOWED_DISTANCES.reduce((best, d) => (Math.abs(d - req.distanceM) < Math.abs(best - req.distanceM) ? d : best), ALLOWED_DISTANCES[0]);
  if (Math.abs(nearest - req.distanceM) > 0.5) {
    return { accepted: false, reason: 'impossible', message: `No round is shot at ${req.distanceM} m.` };
  }
  if (req.bowClass !== 'compound' && Math.abs(req.distanceM - cls.distanceM) > 0.5 && req.distanceM !== 18) {
    return { accepted: false, reason: 'impossible', message: `${cls.shortName} shoots ${cls.distanceM} m outdoors.` };
  }

  // Aim must be somewhere a sight can point.
  const limit = faceRadiusM(face) * 1.6;
  if (Math.abs(req.aim.x) > limit || Math.abs(req.aim.y) > limit) {
    return { accepted: false, reason: 'impossible', message: 'Aim point is outside the target area.' };
  }
  if (Math.abs(req.sway.x) > 0.4 || Math.abs(req.sway.y) > 0.4) {
    return { accepted: false, reason: 'impossible', message: 'Sway is outside the human range.' };
  }
  if (req.gear.drawWeightLb < cls.bow.drawWeightLb.min - 0.01 || req.gear.drawWeightLb > cls.bow.drawWeightLb.max + 0.01) {
    return { accepted: false, reason: 'impossible', message: `Draw weight is outside the ${cls.shortName} division limits.` };
  }
  if (req.bowClass === 'compound' && req.gear.letOff < 0.5) {
    return { accepted: false, reason: 'impossible', message: 'Compound let-off is not plausible.' };
  }

  const wind = req.wind ? sanitizeWind(req.wind) : { ...DEFAULT_WIND, seed: req.windSeed };
  const outcome = simulateShot({ ...req, wind } as unknown as ShotRequest);

  if (req.claimedScore) {
    const claimed = req.claimedScore;
    const actual = outcome.score;
    // X and 10 are the same value; the label is allowed to differ.
    if (claimed.value !== actual.value || (claimed.isX && !actual.isX)) {
      return {
        accepted: false,
        reason: 'replay',
        message: `Reported ${claimed.value} but the replay scores ${actual.value}.`,
        outcome,
      };
    }
  }

  return { accepted: true, reason: 'accepted', message: 'Shot accepted.', outcome };
}

/** Clamp a client-supplied hold time into the plausible window for the class. */
export function sanitizeHold(seconds: number, bowClass: 'recurve' | 'compound' | 'barebow'): number {
  const budget = bowClass === 'compound' ? 14 : bowClass === 'barebow' ? 8 : 10;
  return clamp(seconds, 0, budget);
}
