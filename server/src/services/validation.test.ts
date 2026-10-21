/**
 * Server-side validation tests: the acceptance criterion "invalid server-side
 * shots are rejected".
 */

import { describe, expect, it } from 'vitest';
import { validateShot } from './validation';
import { DEFAULT_WIND } from '@gold-ring/shared/physics/wind';
import { defaultGear } from '@gold-ring/shared/data/gear';
import { getClassRules } from '@gold-ring/shared/rules/index';

function request(patch: Record<string, unknown> = {}): Record<string, unknown> {
  const gear = defaultGear('recurve');
  const cls = getClassRules('recurve');
  return {
    type: 'shoot',
    archerId: 'test',
    gameId: 'g1',
    bowClass: 'recurve',
    distanceM: 70,
    windSeed: DEFAULT_WIND.seed,
    aim: { x: 0, y: 0 },
    drawFraction: 1,
    holdSeconds: 2,
    releaseQuality: 0.95,
    cantRad: 0,
    torqueRad: 0,
    sightElevationOffsetMm: 0,
    sightWindageOffsetMm: 0,
    sway: { x: 0, y: 0 },
    gear: {
      drawWeightLb: gear.drawWeightLb,
      drawLengthIn: gear.drawLengthIn,
      braceHeightIn: gear.braceHeightIn,
      letOff: cls.bow.letOff,
      arrowMassGr: 300,
      arrowSpine: 500,
      arrowLengthIn: gear.arrowLengthIn,
      efficiency: cls.bow.efficiency,
    },
    wind: DEFAULT_WIND,
    simulatedAt: Date.now(),
    ...patch,
  };
}

describe('server shot validation', () => {
  it('accepts a physically plausible shot and returns the authoritative score', () => {
    const result = validateShot(request());
    expect(result.accepted).toBe(true);
    expect(result.outcome?.score.value).toBeGreaterThanOrEqual(0);
    expect(result.outcome?.score.value).toBeLessThanOrEqual(10);
  });

  it('rejects a claim that does not match the replay', () => {
    const result = validateShot(
      request({ aim: { x: 0.85, y: 0 }, claimedScore: { value: 10, isX: true, label: 'X' } }),
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('replay');
  });

  it('rejects an aim point outside the target area', () => {
    const result = validateShot(request({ aim: { x: 4, y: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('impossible');
  });

  it('rejects a distance that is not a round', () => {
    const result = validateShot(request({ distanceM: 43 }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('impossible');
  });

  it('rejects a draw weight outside the division limits', () => {
    const result = validateShot(
      request({ gear: { ...(request().gear as object), drawWeightLb: 58 } }),
    );
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('impossible');
  });

  it('rejects a malformed payload', () => {
    const result = validateShot({ type: 'shoot' });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  it('rejects negative hold time', () => {
    const result = validateShot(request({ holdSeconds: -1 }));
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('invalid');
  });
});
