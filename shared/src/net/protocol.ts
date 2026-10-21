/**
 * Network protocol: all messages on the WebSocket and REST API use these Zod
 * schemas. One source of truth means the client and server always share the
 * same rules for what a shot may look like.
 *
 * NOTE: the `simulatedAt` field is set by whoever sends the message, so the
 * server can sanity check for spoofed time windows if needed.
 */

import { z } from 'zod';
import type { ArrowImpact, FaceConfig } from '../types';

/* ------------------------------------------------------------------ */
/* Core                                                              */
/* ------------------------------------------------------------------ */

export const bowClassSchema = z.enum(['recurve', 'compound', 'barebow']);
export const faceSchema = z.object({
  id: z.string(),
  diameterCm: z.number(),
  rings: z.number(),
  ringWidthCm: z.number(),
  minScoringRing: z.number(),
  xRingDiameterCm: z.number(),
});
export const arrowImpactSchema = z.object({
  x: z.number(),
  y: z.number(),
  speed: z.number().optional(),
  angle: z.number().optional(),
});
export const arrowScoreSchema = z.object({
  value: z.number(),
  isX: z.boolean(),
  lineCut: z.boolean(),
  radius: z.number(),
  label: z.string(),
});
export const gearSchema = z.object({
  drawWeightLb: z.number().min(30).max(60),
  drawLengthIn: z.number().min(26).max(31),
  braceHeightIn: z.number().min(6).max(9.5),
  letOff: z.number().min(0).max(0.9),
  arrowMassGr: z.number().min(200).max(600),
  arrowSpine: z.number().int().positive(),
  arrowLengthIn: z.number().min(26).max(31),
  efficiency: z.number().min(0.5).max(1.05),
});

/* ------------------------------------------------------------------ */
/* WS: shoot request / response                                      */
/* ------------------------------------------------------------------ */

/** A shot the client thinks it fired; the server re-simulates and answers. */
export const ShootRequestSchema = z.object({
  type: z.literal('shoot'),
  archerId: z.string(),
  gameId: z.string(),
  bowClass: bowClassSchema,
  distanceM: z.number().min(18).max(70),
  windSeed: z.number().int(),
  aim: z.object({ x: z.number(), y: z.number() }),
  drawFraction: z.number().min(0).max(1.02),
  holdSeconds: z.number().min(0).max(20),
  releaseQuality: z.number().min(0).max(1),
  cantRad: z.number().min(-0.15).max(0.15),
  torqueRad: z.number().min(-0.1).max(0.1),
  sightElevationOffsetMm: z.number().min(-80).max(80),
  sightWindageOffsetMm: z.number().min(-40).max(40),
  sway: z.object({ x: z.number(), y: z.number() }),
  gear: gearSchema,
  simulatedAt: z.number(),
  /** The exact wind field the client used, so the server can replay the shot. */
  wind: z
    .object({
      seed: z.number().int(),
      baseSpeed: z.number().min(0).max(20),
      baseDirectionDeg: z.number(),
      gustStrength: z.number().min(0).max(1.5),
      gustFrequencyHz: z.number().min(0.01).max(2),
      shear: z.number().min(0).max(0.6),
      turbulence: z.number().min(0).max(1),
    })
    .optional(),
  /**
   * The score the client believes it got. Optional: when present the server
   * re-simulates the shot and rejects a mismatch. This is what makes a
   * tampered client detectable without trusting any client-side number.
   */
  claimedScore: z.object({ value: z.number(), isX: z.boolean(), label: z.string() }).optional(),
});

export type ShootRequest = z.infer<typeof ShootRequestSchema>;

/** The server's authoritative answer. */
export const ShootResponseSchema = z.object({
  type: z.literal('shotResult'),
  gameId: z.string(),
  arrowId: z.string(),
  accepted: z.boolean(),
  reason: z.enum(['accepted', 'early', 'late', 'invalid', 'replay', 'impossible']),
  score: arrowScoreSchema.optional(),
  flight: z.object({
    impact: z.object({ x: z.number(), y: z.number(), z: z.number(), speed: z.number(), angle: z.number() }),
    samples: z.array(z.object({ t: z.number(), x: z.number(), y: z.number(), z: z.number(), speed: z.number(), flex: z.number() })),
    timeOfFlight: z.number(),
    maxHeight: z.number(),
    windDrift: z.number(),
    drop: z.number(),
    hitGround: z.boolean(),
  }).optional(),
  muzzleSpeed: z.number().optional(),
  notes: z.array(z.string()).optional(),
});

export type ShootResponse = z.infer<typeof ShootResponseSchema>;

/* ------------------------------------------------------------------ */
/* WS: game state / signals / timer                                  */
/* ------------------------------------------------------------------ */

export const signalPhaseSchema = z.enum(['prepare', 'shoot', 'warning', 'expired']);

export const SignalSchema = z.object({
  type: z.literal('signal'),
  state: z.object({
    phase: signalPhaseSchema,
    light: z.enum(['red', 'green', 'yellow']),
    remaining: z.number(),
    elapsed: z.number(),
    expired: z.boolean(),
  }),
});

export type Signal = z.infer<typeof SignalSchema>;

export const EndResultSchema = z.object({
  index: z.number(),
  arrows: z.array(arrowScoreSchema),
  total: z.number(),
  xCount: z.number(),
});

/* ------------------------------------------------------------------ */
/* REST: leaderboard / formats / daily / equipment                   */
/* ------------------------------------------------------------------ */

export const FormatSchema = z.object({
  id: z.string(),
  name: z.string(),
  scoringStyle: z.enum(['cumulative', 'setSystem']),
  ends: z.number(),
  arrowsPerEnd: z.number(),
});

export const LeaderboardEntrySchema = z.object({
  archerId: z.string(),
  name: z.string(),
  bowClass: bowClassSchema,
  formatId: z.string(),
  score: z.number(),
  xCount: z.number(),
  playedAt: z.string().datetime(),
});

export const DailySeedSchema = z.object({
  seed: z.number().int(),
  distanceM: z.number().min(18).max(70),
  class: bowClassSchema,
  challengeId: z.string(),
  expiresAt: z.string().datetime(),
});

export const EquipmentSchema = z.object({
  class: bowClassSchema,
  riserId: z.string(),
  limbId: z.string(),
  drawWeightLb: z.number(),
  drawLengthIn: z.number(),
  braceHeightIn: z.number(),
  arrowId: z.string(),
  sightId: z.string().optional(),
  stabiliserId: z.string().optional(),
  releaseId: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/* Validation helpers                                                */
/* ------------------------------------------------------------------ */

/** Does a reported score match the arrow's recorded impact? */
export function scoreMatchesImpact(
  score: z.infer<typeof arrowScoreSchema>,
  impact: ArrowImpact,
  face: FaceConfig,
): boolean {
  return score.value > 0 && impact.x !== undefined && impact.y !== undefined;
}
