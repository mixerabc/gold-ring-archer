/**
 * Deterministic 3D wind field.
 *
 * The SAME field drives:
 *   - the arrow physics (drag relative to the air mass, lateral drift),
 *   - the grass shader uniforms,
 *   - the flag cloth simulation,
 *   - the on-screen wind indicator and the digital scoreboard.
 *
 * That is what makes "what you see is what you shoot" true: the flag at 40 m is
 * sampling the same function the arrow is flying through.
 *
 * The field is built from three layers:
 *   1. a base vector (speed + direction) that varies slowly along the range,
 *   2. gusts: low-frequency noise in time and space,
 *   3. shear: wind speed grows with height above the ground (power law).
 */

import { clamp, noise1 } from '../math/random';
import type { Vec3, WindFieldConfig, WindSample } from '../types';

export const DEFAULT_WIND: WindFieldConfig = {
  seed: 1337,
  baseSpeed: 3.2,
  baseDirectionDeg: 62,
  gustStrength: 0.45,
  gustFrequencyHz: 0.18,
  shear: 0.16,
  turbulence: 0.28,
};

/**
 * Sample the wind at a point in the world and a time.
 *
 * @param x lateral position (m)
 * @param y height above ground (m)
 * @param z distance downrange (m)
 * @param t seconds since the end started
 */
export function sampleWind(config: WindFieldConfig, x: number, y: number, z: number, t: number): WindSample {
  const seed = config.seed | 0;
  const dirRad = (config.baseDirectionDeg * Math.PI) / 180;

  // 1. Base direction wanders a few degrees along the range.
  const directionWander = noise1(z * 0.02 + 11.3, seed) * 0.22 + noise1(t * 0.05 + 3.7, seed ^ 0x9e37) * 0.12;
  const angle = dirRad + directionWander;

  // 2. Gusts: a travelling wave along the range plus a slow temporal envelope.
  const gustWave = noise1(z * 0.045 - t * config.gustFrequencyHz * 6 + 5.1, seed ^ 0x51ed);
  const gustEnvelope = 0.5 + 0.5 * noise1(t * config.gustFrequencyHz + 1.9, seed ^ 0x2f19);
  const gust = config.gustStrength * gustWave * gustEnvelope;

  // 3. Turbulence: small, high frequency, height dependent.
  const turb =
    config.turbulence *
    (noise1(z * 0.35 + t * 1.7, seed ^ 0x77aa) * 0.6 + noise1(t * 2.3 + x * 0.5, seed ^ 0x1234) * 0.4);

  // 4. Shear: wind speed increases with height above the ground.
  const height = Math.max(0.15, y);
  const shearFactor = Math.pow(height / 10, config.shear);

  const speed = Math.max(0, config.baseSpeed * (1 + gust + turb * 0.35) * shearFactor);
  const lateralSpeed = Math.sin(angle) * speed;
  const downrangeSpeed = Math.cos(angle) * speed;

  // A small vertical component from turbulence (updrafts over the field).
  const vertical = config.baseSpeed * config.turbulence * 0.12 * noise1(z * 0.2 + t * 1.1, seed ^ 0xabcd);

  return {
    x: lateralSpeed,
    y: vertical,
    z: downrangeSpeed,
    speed: Math.hypot(lateralSpeed, downrangeSpeed, vertical),
  };
}

/** Wind sampled at 10 m, used for the scoreboard and the HUD. */
export function windAtTenMetres(config: WindFieldConfig, z: number, t: number): WindSample {
  return sampleWind(config, 0, 10, z, t);
}

/**
 * Convert a wind vector into a human "clock" direction (1-12 o'clock as seen by
 * the archer looking downrange) and a head/tail/cross label.
 */
export function describeWind(wind: Vec3): { clock: number; label: string; speed: number } {
  const speed = Math.hypot(wind.x, wind.z);
  // Angle of the wind TOWARDS which it blows, measured from downrange.
  let angleDeg = (Math.atan2(wind.x, wind.z) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  // A wind blowing towards the target (0 deg) is a tailwind and is shown as
  // "12 o'clock" on the archer's clock (coming from behind).
  const clock = Math.round(((angleDeg + 180) % 360) / 30) % 12 || 12;

  let label: string;
  const head = wind.z; // positive = towards the target = tailwind
  const cross = Math.abs(wind.x);
  if (cross > Math.abs(head) * 1.4) {
    label = wind.x > 0 ? 'Crosswind R→L' : 'Crosswind L→R';
  } else if (head > 0) {
    label = 'Tailwind';
  } else {
    label = 'Headwind';
  }
  return { clock, label, speed };
}

/** Wind strength class used to pick audio/visual intensity. */
export function windSeverity(speed: number): 'calm' | 'light' | 'moderate' | 'strong' {
  if (speed < 1.5) return 'calm';
  if (speed < 4) return 'light';
  if (speed < 7) return 'moderate';
  return 'strong';
}

/** Clamp a user-supplied wind configuration into physically sane bounds. */
export function sanitizeWind(config: Partial<WindFieldConfig>): WindFieldConfig {
  return {
    seed: (config.seed ?? DEFAULT_WIND.seed) | 0,
    baseSpeed: clamp(config.baseSpeed ?? DEFAULT_WIND.baseSpeed, 0, 18),
    baseDirectionDeg: ((config.baseDirectionDeg ?? DEFAULT_WIND.baseDirectionDeg) % 360 + 360) % 360,
    gustStrength: clamp(config.gustStrength ?? DEFAULT_WIND.gustStrength, 0, 1.5),
    gustFrequencyHz: clamp(config.gustFrequencyHz ?? DEFAULT_WIND.gustFrequencyHz, 0.01, 2),
    shear: clamp(config.shear ?? DEFAULT_WIND.shear, 0, 0.6),
    turbulence: clamp(config.turbulence ?? DEFAULT_WIND.turbulence, 0, 1),
  };
}
