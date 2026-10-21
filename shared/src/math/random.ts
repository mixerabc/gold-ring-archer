/**
 * Small deterministic random helpers.
 *
 * Everything that influences a shot (wind gusts, sway, AI variance) is driven by
 * a seeded generator so a shot can be replayed exactly on the server for
 * authoritative validation.
 */

/** Mulberry32: tiny, fast, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit seed (used for daily challenges). */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic value noise in [-1, 1] for a 1D coordinate. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashToUnit(i, seed);
  const b = hashToUnit(i + 1, seed);
  const t = f * f * (3 - 2 * f); // smoothstep
  return (a + (b - a) * t) * 2 - 1;
}

function hashToUnit(i: number, seed: number): number {
  let h = (i ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normal-ish random from a uniform generator (sum of 3 uniforms). */
export function approxGaussian(rand: () => number): number {
  return (rand() + rand() + rand() - 1.5) * 1.1547; // ~unit variance, range -1.73..1.73
}
