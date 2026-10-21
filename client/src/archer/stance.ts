/**
 * Stance geometry.
 *
 * A right-handed archer stands side-on to the target: the left side of the body
 * faces downrange, the feet straddle the shooting line, and the head turns to
 * look over the left shoulder. Left-handed archers are the mirror image.
 *
 * All positions are in the archer's local space (x = to the archer's right,
 * y = up, z = downrange) before the root is placed on the shooting line.
 */

import type { Handedness } from '@shared/types';

export interface StancePose {
  /** Root yaw, radians. Right-handed archers turn their body ~78 deg. */
  bodyYaw: number;
  /** Foot positions in local space. */
  frontFoot: { x: number; y: number; z: number };
  backFoot: { x: number; y: number; z: number };
  /** Head yaw relative to the torso (turns back towards the target). */
  headYaw: number;
  /** Hip height, metres. */
  hipHeight: number;
  /** Shoulder width, metres. */
  shoulderWidth: number;
  /** Where the drawing hand anchors (right-handed: under the chin). */
  anchor: { x: number; y: number; z: number };
  /** Bow-hand position at full draw. */
  bowHand: { x: number; y: number; z: number };
  /** Sign multiplier for left-handed mirroring (+1 right, -1 left). */
  mirror: 1 | -1;
}

export const STANCE: Omit<StancePose, 'mirror'> = {
  bodyYaw: (78 * Math.PI) / 180,
  frontFoot: { x: 0.17, y: 0, z: 0.12 },
  backFoot: { x: -0.19, y: 0, z: -0.12 },
  headYaw: (-72 * Math.PI) / 180,
  hipHeight: 0.94,
  shoulderWidth: 0.4,
  anchor: { x: -0.02, y: 1.53, z: 0.05 },
  bowHand: { x: 0.13, y: 1.5, z: 0.66 },
};

export function stanceFor(handedness: Handedness): StancePose {
  const mirror = handedness === 'right' ? 1 : -1;
  const flip = (p: { x: number; y: number; z: number }) => ({ x: p.x * mirror, y: p.y, z: p.z });
  return {
    bodyYaw: STANCE.bodyYaw * mirror,
    frontFoot: flip(STANCE.frontFoot),
    backFoot: flip(STANCE.backFoot),
    headYaw: STANCE.headYaw * mirror,
    hipHeight: STANCE.hipHeight,
    shoulderWidth: STANCE.shoulderWidth,
    anchor: flip(STANCE.anchor),
    bowHand: flip(STANCE.bowHand),
    mirror,
  };
}

/**
 * Where the arrow nock sits for a given draw fraction, in archer-local space.
 * At draw 0 the nock is at the bow string's brace position; at draw 1 it is at
 * the anchor. Used by the arrow mesh and the string animation.
 */
export function nockPosition(stance: StancePose, drawFraction: number): { x: number; y: number; z: number } {
  const brace = { x: stance.bowHand.x, y: stance.bowHand.y, z: stance.bowHand.z - 0.18 };
  const t = Math.min(1, Math.max(0, drawFraction));
  return {
    x: brace.x + (stance.anchor.x - brace.x) * t,
    y: brace.y + (stance.anchor.y - brace.y) * t,
    z: brace.z + (stance.anchor.z - brace.z) * t,
  };
}

/** Foot placement hint for the tutorial: distance from the ideal spot, metres. */
export function stanceError(front: { x: number; z: number }, back: { x: number; z: number }, stance: StancePose): number {
  const a = Math.hypot(front.x - stance.frontFoot.x, front.z - stance.frontFoot.z);
  const b = Math.hypot(back.x - stance.backFoot.x, back.z - stance.backFoot.z);
  return (a + b) / 2;
}
