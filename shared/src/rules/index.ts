/**
 * Rules engine for GOLD RING.
 *
 * A single, auditable source of truth: `worldArchery.json` holds every number,
 * colour, time limit and penalty; this module turns it into typed lookups plus
 * the derived geometry the renderer, the physics and the scoring need.
 *
 * AUDIT NOTE FOR MAINTAINERS
 * --------------------------
 * The bundled JSON has `meta.rulebook.verified = false` because none of its
 * values have been checked against an official World Archery rulebook. Verify
 * every value against the current Book 3 (Target Archery) and the current
 * competition-format book, then update `meta.rulebook` (edition, citation,
 * verifiedBy, verifiedOn, verified: true). The UI renders an "unofficial
 * values" badge while that flag is false, and `assertRulesVerified()` throws.
 */

import rawRules from './worldArchery.json';
import type {
  BowClass,
  ClassRules,
  FaceConfig,
  FormatRules,
  RulesConfig,
  TeamFormatRules,
} from '../types';

export const rules: RulesConfig = rawRules as unknown as RulesConfig;

/** Thrown when a competitive flow is started against unverified rule values. */
export class UnverifiedRulesError extends Error {
  constructor() {
    super(
      'GOLD RING: the ruleset is marked unverified. Check every value in ' +
        'shared/src/rules/worldArchery.json against the current World Archery rulebook, ' +
        'then set meta.rulebook.verified = true before running competitive play.',
    );
    this.name = 'UnverifiedRulesError';
  }
}

export function isRulesVerified(): boolean {
  return rules.meta.rulebook.verified === true;
}

export function assertRulesVerified(): void {
  if (!isRulesVerified()) throw new UnverifiedRulesError();
}

export function getClassRules(bowClass: BowClass): ClassRules {
  const cls = rules.classes[bowClass];
  if (!cls) throw new Error(`Unknown bow class: ${bowClass}`);
  return cls;
}

export function getFace(faceId: string): FaceConfig {
  const face = rules.faces[faceId];
  if (!face) throw new Error(`Unknown target face: ${faceId}`);
  return face;
}

export function getClassFace(bowClass: BowClass): FaceConfig {
  return getFace(getClassRules(bowClass).face);
}

export function getFormat(formatId: string): FormatRules {
  const format = rules.formats[formatId];
  if (!format) throw new Error(`Unknown format: ${formatId}`);
  return format;
}

export function getTeamFormat(formatId: string): TeamFormatRules {
  const format = rules.teamFormats[formatId];
  if (!format) throw new Error(`Unknown team format: ${formatId}`);
  return format;
}

/** Default match format for a bow class (set system for recurve/barebow, cumulative for compound). */
export function getDefaultMatchFormat(bowClass: BowClass): FormatRules {
  switch (bowClass) {
    case 'recurve':
      return getFormat('recurveMatch');
    case 'compound':
      return getFormat('compoundMatch');
    case 'barebow':
      return getFormat('barebowMatch');
  }
}

/* ------------------------------------------------------------------ */
/* Derived geometry                                                    */
/* ------------------------------------------------------------------ */

/**
 * Radius of a ring, in metres, measured from the gold centre.
 * Ring 10 is the innermost printed ring; ring `n`'s OUTER radius is
 * n * ringWidth. A face with `minScoringRing = 5` keeps the same geometry as a
 * full 10-ring face (ring 5 is the outermost printed ring).
 */
export function ringRadiusM(face: FaceConfig, ring: number): number {
  const maxRing = face.rings; // 10
  return (maxRing - ring + 1) * (face.ringWidthCm / 100);
}

/** Outer radius of the scoring area (the outermost printed ring). */
export function faceRadiusM(face: FaceConfig): number {
  return face.diameterCm / 200;
}

/** Radius of the inner-10 (X) ring in metres. */
export function xRingRadiusM(face: FaceConfig): number {
  return face.xRingDiameterCm / 200;
}

export function faceColorForRing(face: FaceConfig, ring: number): string {
  for (const color of face.colors) {
    if (color.rings.includes(ring)) return color.hex;
  }
  return '#808080';
}

/** Whether the class is allowed a sight (barebow is not). */
export function hasSight(bowClass: BowClass): boolean {
  return getClassRules(bowClass).limits.sight;
}

export function hasStabiliser(bowClass: BowClass): boolean {
  return getClassRules(bowClass).limits.stabiliser;
}

export function hasClicker(bowClass: BowClass): boolean {
  return getClassRules(bowClass).limits.clicker;
}

/** Timing for one end, in seconds, for the given flow. */
export type TimingFlow = 'ranking' | 'match' | 'team' | 'mixedTeam' | 'shootOff' | 'practice';

export function endDurationSeconds(flow: TimingFlow, arrowsInEnd: number): number {
  const t = rules.timing;
  switch (flow) {
    case 'ranking':
      return t.rankingEndSeconds;
    case 'match':
      // World Archery match play: per-arrow allowance.
      return t.matchArrowSeconds * Math.max(1, arrowsInEnd);
    case 'team':
      return t.teamEndSeconds;
    case 'mixedTeam':
      return t.mixedTeamEndSeconds;
    case 'shootOff':
      return t.shootOffArrowSeconds;
    case 'practice':
      return t.practiceEndSeconds;
  }
}

export function warningSeconds(flow: TimingFlow): number {
  return flow === 'ranking' ? rules.timing.rankingWarningSeconds : rules.timing.matchWarningSeconds;
}

/** Shooting-line offset for lane `index` (0-based), in metres, centred on the field. */
export function laneOffsetM(index: number): number {
  return (index - 0.5) * rules.fieldOfPlay.laneWidthM;
}
