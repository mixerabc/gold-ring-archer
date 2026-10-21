/**
 * Breathing, sway and pressure.
 *
 * The sight pin is never still. This model produces the small drift the player
 * has to time the shot around, in metres on the target face (so a 70 m shot
 * sways more than an 18 m shot, exactly as in real life).
 *
 * Difficulty changes the amplitude, not the shape:
 *   arcade    - 35% sway, no target panic
 *   standard  - 100%
 *   realistic - 130%, faster fatigue, stronger pulse
 */

import { clamp } from '@shared/math/random';
import type { Difficulty } from '@shared/types';

export interface SwayOptions {
  difficulty: Difficulty;
  /** Bow stability from `bowFeel` (compound 0.45, barebow 1.25). */
  stability: number;
  distanceM: number;
  /** 0..1 match pressure. */
  pressure: number;
  breathHeld: boolean;
  /** 0..1. */
  stamina: number;
  /** 0..1.6 tremor from the draw controller. */
  tremor: number;
}

export interface SwaySample {
  /** Metres on the face. */
  x: number;
  y: number;
  /** 0..1 breathing phase (0 = full exhale). */
  breath: number;
  /** Heartbeat phase 0..1. */
  pulse: number;
  /** Current sway radius, metres. */
  amplitude: number;
}

const DIFFICULTY_SCALE: Record<Difficulty, number> = {
  arcade: 0.35,
  standard: 1,
  realistic: 1.3,
};

export class BreathingModel {
  /** Seconds since the arrow was nocked. */
  t = 0;
  private breathPhase = 0;
  private noisePhase = 0;

  reset(): void {
    this.t = 0;
    this.breathPhase = 0.35;
    this.noisePhase = 0;
  }

  /** Breath cycle: 4 s in, 4 s out (a little faster under pressure). */
  get breathRateHz(): number {
    return 0.25;
  }

  sample(dt: number, options: SwayOptions): SwaySample {
    this.t += dt;
    const rate = this.breathRateHz * (1 + options.pressure * 0.35);
    this.breathPhase = (this.breathPhase + dt * rate) % 1;
    this.noisePhase += dt;

    const diff = DIFFICULTY_SCALE[options.difficulty];
    const distanceScale = clamp(options.distanceM / 70, 0.25, 1.15);
    const fatigue = 1 + clamp(options.tremor, 0, 1.6) * 0.85;
    const staminaPenalty = 1 + (1 - options.stamina) * 0.7;
    const pressurePenalty = 1 + options.pressure * 0.45;
    const holdFactor = options.breathHeld ? 0.4 : 1;

    // 8 mm of drift at 70 m for a standard recurve; compound is steadier.
    const amplitude =
      0.008 * diff * options.stability * distanceScale * fatigue * staminaPenalty * pressurePenalty * holdFactor;

    // Vertical: the sight rises and falls with the chest.
    const breath = Math.sin(this.breathPhase * Math.PI * 2);
    const vertical = breath * amplitude * 0.75;

    // Horizontal: a slower, less regular drift plus a fast micro-tremor.
    const slow = Math.sin(this.noisePhase * 0.7 + 1.3) * 0.55 + Math.sin(this.noisePhase * 0.23 + 4.1) * 0.45;
    const micro = Math.sin(this.noisePhase * 7.3) * 0.16 * (1 + options.tremor);
    const horizontal = (slow * 0.6 + micro) * amplitude;

    // Pulse: a 1.2 Hz beat, stronger when tired or under pressure.
    const pulseRate = 1.15 + options.pressure * 0.35;
    const pulse = 0.5 + 0.5 * Math.sin(this.noisePhase * Math.PI * 2 * pulseRate);
    const pulseOffset = (pulse - 0.5) * amplitude * 0.18 * (1 + options.pressure);

    return {
      x: horizontal + pulseOffset,
      y: vertical + pulseOffset * 0.4,
      breath: 0.5 + 0.5 * breath,
      pulse,
      amplitude,
    };
  }
}

/**
 * Match pressure: rises in tight matches, falls after a good arrow.
 * Purely a game-feel number (0..1), shown as a thin bar in the HUD.
 */
export class PressureModel {
  value = 0;

  update(dt: number, options: { matchPlay: boolean; margin: number; arrowsLeft: number }): void {
    if (!options.matchPlay) {
      this.value = Math.max(0, this.value - dt * 0.4);
      return;
    }
    // Close matches and the last arrows of an end raise the pulse.
    const closeness = clamp(1 - Math.abs(options.margin) / 6, 0, 1);
    const endPressure = options.arrowsLeft <= 1 ? 0.35 : options.arrowsLeft <= 2 ? 0.18 : 0;
    const target = clamp(closeness * 0.75 + endPressure, 0, 1);
    this.value += (target - this.value) * Math.min(1, dt * 0.8);
    this.value = clamp(this.value, 0, 1);
  }

  /** A good arrow releases some pressure; a bad one adds to it. */
  react(value: number): void {
    const delta = value >= 9 ? -0.12 : value <= 7 ? 0.1 : 0;
    this.value = clamp(this.value + delta, 0, 1);
  }
}
