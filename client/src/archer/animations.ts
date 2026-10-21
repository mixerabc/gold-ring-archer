/**
 * Animation helpers.
 *
 * Most motion in the game is procedural (the bow limbs, the string, the
 * archer's arms), because it must react to physics every frame. A few
 * one-shot motions (camera shake, menu cards, the medal reveal) use gsap.
 */

import { gsap } from 'gsap';
import { clamp, lerp } from '@shared/math/random';

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function dampVec3(
  current: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  lambda: number,
  dt: number,
): void {
  current.x = damp(current.x, target.x, lambda, dt);
  current.y = damp(current.y, target.y, lambda, dt);
  current.z = damp(current.z, target.z, lambda, dt);
}

/** Critically damped spring, for the third-person camera arm. */
export class Spring {
  value: number;
  velocity = 0;
  private target: number;
  private stiffness: number;
  private damping: number;

  constructor(value = 0, stiffness = 90, damping = 14) {
    this.value = value;
    this.target = value;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  set(target: number): void {
    this.target = target;
  }

  snap(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  update(dt: number): number {
    const dtc = Math.min(dt, 1 / 30);
    const force = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += force * dtc;
    this.value += this.velocity * dtc;
    return this.value;
  }
}

/** A decaying impulse (bow recoil, hand slap, camera kick). */
export class Recoil {
  value = 0;
  private decay: number;

  constructor(decay = 9) {
    this.decay = decay;
  }

  kick(amount: number): void {
    this.value = clamp(this.value + amount, 0, 2);
  }

  update(dt: number): number {
    this.value *= Math.exp(-this.decay * dt);
    if (this.value < 0.0005) this.value = 0;
    return this.value;
  }
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Small screen shake, used on release and on a bad shot. */
export function cameraShake(intensity: number): void {
  const el = document.getElementById('stage');
  if (!el) return;
  gsap.fromTo(
    el,
    { x: 0, y: 0 },
    {
      x: (Math.random() - 0.5) * intensity,
      y: (Math.random() - 0.5) * intensity,
      duration: 0.08,
      repeat: 3,
      yoyo: true,
      ease: 'power2.out',
      onComplete: () => gsap.set(el, { x: 0, y: 0 }),
    },
  );
}

/** Fade/slide a screen element in. */
export function reveal(element: HTMLElement, delay = 0): void {
  gsap.fromTo(
    element,
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.45, delay, ease: 'power3.out' },
  );
}

export function popNumber(element: HTMLElement): void {
  gsap.fromTo(
    element,
    { scale: 0.6, opacity: 0 },
    { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(2.2)' },
  );
}
